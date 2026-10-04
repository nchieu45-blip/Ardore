-- No historical availability or booking rows are rewritten.
create table public.coaching_availability_state (
  creator_id uuid primary key references public.creator_profiles(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0 and revision <= 9007199254740991)
);
alter table public.coaching_availability_state enable row level security;
revoke all on public.coaching_availability_state from public, anon, authenticated;
grant select on public.coaching_availability_state to authenticated;
grant all on public.coaching_availability_state to service_role;
create policy "Owner reads availability revision" on public.coaching_availability_state
for select to authenticated using (exists (
  select 1 from public.creator_profiles c where c.id = creator_id and c.user_id = (select auth.uid())
));

-- Same Europe/Berlin wall-clock windows as coaching-slots.ts, including date exceptions.
create function private.coach_availability_windows(p_date date, p_slots jsonb, p_overrides jsonb)
returns int4multirange language sql immutable security invoker set search_path = '' as $$
  with weekly as (
    select coalesce(range_agg(int4range(
      (extract(epoch from (s->>'start_time')::time) / 60)::integer,
      (extract(epoch from (s->>'end_time')::time) / 60)::integer, '[)')), '{}'::int4multirange) as windows
    from jsonb_array_elements(p_slots) s where (s->>'day_of_week')::integer = extract(dow from p_date)::integer
  ), blocked as (
    select coalesce(range_agg(int4range(
      coalesce((extract(epoch from (s->>'start_time')::time) / 60)::integer, 0),
      coalesce((extract(epoch from (s->>'end_time')::time) / 60)::integer, 1440), '[)')), '{}'::int4multirange) as windows
    from jsonb_array_elements(p_overrides) s where s->>'date' = p_date::text and s->>'type' = 'unavailable'
  ), extra as (
    select coalesce(range_agg(int4range(
      (extract(epoch from (s->>'start_time')::time) / 60)::integer,
      (extract(epoch from (s->>'end_time')::time) / 60)::integer, '[)')), '{}'::int4multirange) as windows
    from jsonb_array_elements(p_overrides) s where s->>'date' = p_date::text and s->>'type' = 'available'
      and s->>'start_time' is not null and s->>'end_time' is not null
  ) select (weekly.windows - blocked.windows) + extra.windows from weekly, blocked, extra;
$$;
revoke all on function private.coach_availability_windows(date,jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.coach_availability_windows(date,jsonb,jsonb) to service_role;

create function private.validate_coach_availability(p_slots jsonb, p_overrides jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare s jsonb; day_date date;
begin
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_typeof(p_overrides) is distinct from 'array' then
    raise exception 'Invalid availability arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > 1000 or jsonb_array_length(p_overrides) > 1000 then
    raise exception 'Too many intervals' using errcode = '22023';
  end if;
  for s in select value from jsonb_array_elements(p_slots) loop
    if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'day_of_week') is distinct from 'number'
      or coalesce(s->>'day_of_week','') !~ '^[0-6]$'
      or coalesce(s->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(s->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or s->>'start_time' >= s->>'end_time' then
      raise exception 'Invalid weekly interval' using errcode = '22023';
    end if;
  end loop;
  for s in select value from jsonb_array_elements(p_overrides) loop
    if jsonb_typeof(s) is distinct from 'object' or coalesce(s->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(s->>'type','') not in ('available','unavailable')
      or not (s ? 'start_time' and s ? 'end_time') then
      raise exception 'Invalid date exception' using errcode = '22023';
    end if;
    day_date := (s->>'date')::date;
    if day_date::text <> s->>'date' then raise exception 'Invalid date' using errcode = '22023'; end if;
    if s->>'start_time' is null and s->>'end_time' is null then
      if s->>'type' <> 'unavailable' then raise exception 'Extra availability requires times' using errcode = '22023'; end if;
    elsif coalesce(s->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(s->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or s->>'start_time' >= s->>'end_time' then
      raise exception 'Invalid date interval' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_slots) with ordinality a(s,i)
    join jsonb_array_elements(p_slots) with ordinality b(s,i) on a.i < b.i
    where a.s->>'day_of_week' = b.s->>'day_of_week'
      and a.s->>'start_time' < b.s->>'end_time' and b.s->>'start_time' < a.s->>'end_time'
  ) or exists (
    select 1 from jsonb_array_elements(p_overrides) with ordinality a(s,i)
    join jsonb_array_elements(p_overrides) with ordinality b(s,i) on a.i < b.i
    where a.s->>'date' = b.s->>'date' and (
      a.s->>'start_time' is null or b.s->>'start_time' is null or
      (a.s->>'start_time' < b.s->>'end_time' and b.s->>'start_time' < a.s->>'end_time'))
  ) then raise exception 'Overlapping or contradictory intervals' using errcode = '22023'; end if;
  -- Extra available intervals cannot duplicate an existing weekly window.
  if exists (
    select 1 from jsonb_array_elements(p_overrides) o
    where o->>'type' = 'available' and private.coach_availability_windows((o->>'date')::date, p_slots,
      (select coalesce(jsonb_agg(v), '[]'::jsonb) from jsonb_array_elements(p_overrides) v where v->>'type' = 'unavailable'))
    && int4multirange(int4range((extract(epoch from (o->>'start_time')::time)/60)::integer,
                              (extract(epoch from (o->>'end_time')::time)/60)::integer, '[)'))
  ) then raise exception 'Extra interval overlaps recurring availability' using errcode = '22023'; end if;
end;
$$;
revoke all on function private.validate_coach_availability(jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.validate_coach_availability(jsonb,jsonb) to service_role;

-- One SELECT snapshot: readers cannot combine a new revision with old intervals.
create function public.get_coach_availability(p_creator_id uuid, p_coach_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision', coalesce((select revision from public.coaching_availability_state where creator_id = p_creator_id), 0),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('day_of_week', day_of_week,
      'start_time', left(start_time::text,5), 'end_time', left(end_time::text,5)) order by day_of_week,start_time)
      from public.availability_slots where creator_id = p_creator_id), '[]'::jsonb),
    'dateOverrides', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'type', type,
      'start_time', left(start_time::text,5), 'end_time', left(end_time::text,5)) order by date,type,start_time)
      from public.date_overrides where creator_id = p_creator_id), '[]'::jsonb),
    'offer', (select jsonb_build_object('is_enabled',is_enabled,'price_cents',price_cents,'duration_minutes',duration_minutes,
      'description',description,'buffer_minutes',buffer_minutes,'min_notice_hours',min_notice_hours,
      'max_horizon_days',max_horizon_days,'cancellation_policy_hours',cancellation_policy_hours)
      from public.coaching_offers where creator_id = p_creator_id)
  ) where exists (select 1 from public.creator_profiles where id = p_creator_id and user_id = p_coach_user_id);
$$;
revoke all on function public.get_coach_availability(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_coach_availability(uuid,uuid) to service_role;

create function public.replace_coach_availability(p_creator_id uuid, p_coach_user_id uuid,
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
    raise exception 'Availability changed; reload before saving' using errcode = '40001';
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
revoke all on function public.replace_coach_availability(uuid,uuid,jsonb,jsonb,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.replace_coach_availability(uuid,uuid,jsonb,jsonb,bigint,jsonb) to service_role;

-- Prevent bypassing the transaction with client-controlled raw deletes/inserts.
revoke insert,update,delete,truncate,references,trigger on public.availability_slots,public.date_overrides from public,anon,authenticated;
do $$ declare tbl text; cols text;
begin
  foreach tbl in array array['availability_slots','date_overrides'] loop
    select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns where table_schema='public' and table_name=tbl;
    execute format('revoke insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',cols,cols,cols,tbl);
  end loop;
end $$;

-- Serialize booking creation/rescheduling with availability replacement. Legacy
-- bookings retain their lifecycle; status-only late-success recovery is not denied.
create function private.guard_booking_availability()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare snapshot jsonb; minute_start integer; check_window boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach-availability:' || new.creator_id::text, 0));
  if tg_op = 'INSERT' then check_window := true;
  else check_window := new.scheduled_at is distinct from old.scheduled_at
    or new.duration_minutes is distinct from old.duration_minutes or new.creator_id is distinct from old.creator_id; end if;
  if check_window and new.status in ('pending_payment','confirmed')
    and exists (select 1 from public.coaching_availability_state where creator_id = new.creator_id) then
    select public.get_coach_availability(new.creator_id,c.user_id) into snapshot from public.creator_profiles c where c.id=new.creator_id;
    minute_start := (extract(hour from new.scheduled_at at time zone 'Europe/Berlin')*60
      + extract(minute from new.scheduled_at at time zone 'Europe/Berlin'))::integer;
    if not (private.coach_availability_windows((new.scheduled_at at time zone 'Europe/Berlin')::date,
      snapshot->'slots',snapshot->'dateOverrides') @> int4range(minute_start,minute_start+new.duration_minutes,'[)')) then
      raise exception 'Slot no longer available' using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_booking_availability() from public,anon,authenticated;
grant execute on function private.guard_booking_availability() to service_role;
create trigger bookings_availability_guard before insert or update of scheduled_at,duration_minutes,buffer_minutes,status,creator_id
on public.bookings for each row execute function private.guard_booking_availability();
