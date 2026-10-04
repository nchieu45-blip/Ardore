-- Expected revision conflicts are business conflicts, not retriable serialization errors.
create or replace function public.replace_coach_availability(p_creator_id uuid, p_coach_user_id uuid,
  p_slots jsonb, p_date_overrides jsonb, p_expected_revision bigint, p_offer jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; b record; minute_start integer;
begin
  if not exists (select 1 from public.creator_profiles where id = p_creator_id and user_id = p_coach_user_id) then
    raise exception 'Not the coach owner' using errcode = '42501';
  end if;
  perform private.validate_coach_availability(p_slots,p_date_overrides);
  perform pg_advisory_xact_lock(hashtextextended('coach-availability:' || p_creator_id::text, 0));
  insert into public.coaching_availability_state(creator_id) values(p_creator_id) on conflict do nothing;
  select revision into current_revision from public.coaching_availability_state where creator_id = p_creator_id for update;
  if p_expected_revision is null or p_expected_revision <> current_revision then
    raise exception 'Availability changed; reload before saving' using errcode = 'PT409';
  end if;
  -- No booking rows are locked/updated here. Booking writes share the coach lock.
  for b in select scheduled_at,duration_minutes from public.bookings
    where creator_id = p_creator_id and status in ('confirmed','pending_payment')
      and scheduled_at + make_interval(mins => duration_minutes) > now()
  loop
    minute_start := (extract(hour from b.scheduled_at at time zone 'Europe/Berlin') * 60
      + extract(minute from b.scheduled_at at time zone 'Europe/Berlin'))::integer;
    if not (private.coach_availability_windows((b.scheduled_at at time zone 'Europe/Berlin')::date, p_slots,p_date_overrides)
      @> int4range(minute_start, minute_start+b.duration_minutes, '[)')) then
      raise exception 'Existing booking must remain available' using errcode = '23P01';
    end if;
  end loop;
  delete from public.availability_slots where creator_id = p_creator_id;
  delete from public.date_overrides where creator_id = p_creator_id;
  insert into public.availability_slots(creator_id,day_of_week,start_time,end_time)
    select p_creator_id,(s->>'day_of_week')::integer,(s->>'start_time')::time,(s->>'end_time')::time from jsonb_array_elements(p_slots) s;
  insert into public.date_overrides(creator_id,date,type,start_time,end_time)
    select p_creator_id,(s->>'date')::date,s->>'type',(s->>'start_time')::time,(s->>'end_time')::time from jsonb_array_elements(p_date_overrides) s;
  -- The UI saves offer + availability together. Any failure here also rolls back every interval above.
  if p_offer is not null then
    insert into public.coaching_offers(creator_id,is_enabled,price_cents,duration_minutes,description,buffer_minutes,
      min_notice_hours,max_horizon_days,cancellation_policy_hours,updated_at)
    values(p_creator_id,(p_offer->>'is_enabled')::boolean,(p_offer->>'price_cents')::integer,
      (p_offer->>'duration_minutes')::integer,p_offer->>'description',(p_offer->>'buffer_minutes')::integer,
      (p_offer->>'min_notice_hours')::integer,(p_offer->>'max_horizon_days')::integer,(p_offer->>'cancellation_policy_hours')::integer,now())
    on conflict(creator_id) do update set is_enabled=excluded.is_enabled,price_cents=excluded.price_cents,
      duration_minutes=excluded.duration_minutes,description=excluded.description,buffer_minutes=excluded.buffer_minutes,
      min_notice_hours=excluded.min_notice_hours,max_horizon_days=excluded.max_horizon_days,
      cancellation_policy_hours=excluded.cancellation_policy_hours,updated_at=excluded.updated_at;
  end if;
  update public.coaching_availability_state set revision = current_revision+1 where creator_id = p_creator_id;
  return public.get_coach_availability(p_creator_id,p_coach_user_id);
end;
$$;
