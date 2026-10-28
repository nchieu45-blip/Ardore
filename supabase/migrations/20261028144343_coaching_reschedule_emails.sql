-- A revision distinguishes A -> B -> A -> B while retries of B remain no-ops.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.bookings ADD COLUMN schedule_revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.coaching_email_deliveries DROP CONSTRAINT coaching_email_deliveries_event_kind_check;
ALTER TABLE public.coaching_email_deliveries ADD CONSTRAINT coaching_email_deliveries_event_kind_check CHECK (event_kind IN ('cancellation','refund','reschedule'));
CREATE FUNCTION private.queue_individual_reschedule() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE coach uuid; coach_name text; recipient record;
BEGIN
 IF NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at THEN RETURN NEW; END IF;
 IF OLD.status <> 'confirmed' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
 NEW.schedule_revision := OLD.schedule_revision + 1;
 SELECT user_id,display_name INTO coach,coach_name FROM public.creator_profiles WHERE id=NEW.creator_id;
 FOR recipient IN SELECT NEW.buyer_id AS id,'customer'::text AS role WHERE NEW.buyer_id IS NOT NULL
 UNION ALL SELECT coach,'coach' WHERE coach IS NOT NULL AND coach IS DISTINCT FROM NEW.buyer_id LOOP
 INSERT INTO public.coaching_email_deliveries(booking_kind,booking_id,event_kind,event_version,recipient_id,recipient_role,details)
 VALUES('individual',NEW.id,'reschedule',NEW.schedule_revision,recipient.id,recipient.role,
 jsonb_build_object('title','1:1-Coaching','scheduled_at',NEW.scheduled_at,'old_scheduled_at',OLD.scheduled_at,'coach_name',coach_name,'customer_id',NEW.buyer_id,'amount_cents',0,'total_refunded_cents',0))
 ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.queue_individual_reschedule() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.queue_individual_reschedule() TO service_role;
CREATE TRIGGER queue_individual_reschedule BEFORE UPDATE OF scheduled_at ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.queue_individual_reschedule();

-- Stable occurrence/payment identities remain immutable; only effective time changes.
CREATE TABLE public.group_occurrence_schedules (
 video_class_id uuid NOT NULL REFERENCES public.video_classes(id) ON DELETE RESTRICT,
 occurrence_start timestamptz NOT NULL,
 scheduled_at timestamptz NOT NULL CHECK (isfinite(scheduled_at)),
 revision integer NOT NULL CHECK (revision>0),
 PRIMARY KEY(video_class_id,occurrence_start),
 FOREIGN KEY(video_class_id,occurrence_start) REFERENCES public.video_class_occurrences(video_class_id,starts_at) ON DELETE RESTRICT
);
ALTER TABLE public.group_occurrence_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_occurrence_schedules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.group_occurrence_schedules TO anon,authenticated;
GRANT ALL ON public.group_occurrence_schedules TO service_role;
CREATE POLICY group_schedule_read ON public.group_occurrence_schedules FOR SELECT TO anon,authenticated
USING (
 EXISTS(SELECT 1 FROM public.video_classes v JOIN public.creator_profiles c ON c.id=v.creator_id
 WHERE v.id=group_occurrence_schedules.video_class_id AND (c.is_published OR c.user_id=(SELECT auth.uid())))
 OR EXISTS(SELECT 1 FROM public.video_class_bookings b WHERE b.video_class_id=group_occurrence_schedules.video_class_id
 AND b.occurrence_start=group_occurrence_schedules.occurrence_start AND b.user_id=(SELECT auth.uid()))
);

CREATE TABLE public.group_reschedule_requests (
 id uuid PRIMARY KEY, video_class_id uuid NOT NULL REFERENCES public.video_classes(id),
 occurrence_start timestamptz NOT NULL, old_start timestamptz NOT NULL, new_start timestamptz NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, revision integer NOT NULL,
 UNIQUE(video_class_id,occurrence_start,revision)
);
ALTER TABLE public.group_reschedule_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_reschedule_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.group_reschedule_requests TO service_role;
CREATE INDEX group_reschedule_actor_idx ON public.group_reschedule_requests(actor_id);
CREATE FUNCTION public.effective_group_start(p_class_id uuid,p_occurrence timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT scheduled_at FROM public.group_occurrence_schedules WHERE video_class_id=p_class_id AND occurrence_start=p_occurrence),p_occurrence);
$$;
REVOKE ALL ON FUNCTION public.effective_group_start(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.effective_group_start(uuid,timestamptz) TO service_role;

CREATE FUNCTION public.reschedule_group_occurrence(p_class_id uuid,p_occurrence timestamptz,p_expected_start timestamptz,
 p_new_start timestamptz,p_actor_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.video_classes%ROWTYPE; o public.video_class_occurrences%ROWTYPE;
 coach uuid; coach_name text; old_start timestamptz; rev integer; prior public.group_reschedule_requests%ROWTYPE; recipient record;
BEGIN
 IF p_request_id IS NULL OR p_actor_id IS NULL OR p_occurrence IS NULL OR p_new_start IS NULL OR p_expected_start IS NULL
  OR NOT isfinite(p_occurrence) OR NOT isfinite(p_new_start) OR NOT isfinite(p_expected_start) THEN RETURN jsonb_build_object('error','invalid'); END IF;
 SELECT * INTO v FROM public.video_classes WHERE id=p_class_id FOR UPDATE;
 SELECT user_id,display_name INTO coach,coach_name FROM public.creator_profiles WHERE id=v.creator_id;
 IF v.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF coach IS DISTINCT FROM p_actor_id THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.creator_id::text,29317));
 SELECT * INTO o FROM public.video_class_occurrences WHERE video_class_id=v.id AND starts_at=p_occurrence;
 IF o.video_class_id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
 old_start:=public.effective_group_start(v.id,p_occurrence);
 SELECT * INTO prior FROM public.group_reschedule_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF (prior.video_class_id,prior.occurrence_start,prior.old_start,prior.new_start,prior.actor_id)
   IS DISTINCT FROM (p_class_id,p_occurrence,p_expected_start,p_new_start,p_actor_id) THEN RETURN jsonb_build_object('error','request_conflict'); END IF;
  IF old_start IS DISTINCT FROM p_new_start THEN RETURN jsonb_build_object('error','stale'); END IF;
  RETURN jsonb_build_object('ok',true,'eventId',prior.id,'scheduledAt',old_start,'revision',prior.revision,'unchanged',true);
 END IF;
 IF old_start IS DISTINCT FROM p_expected_start THEN RETURN jsonb_build_object('error','stale'); END IF;
 IF p_new_start=old_start THEN RETURN jsonb_build_object('ok',true,'scheduledAt',old_start,'unchanged',true); END IF;
 -- No moving started sessions, open checkouts, or joining windows. Existing tokens expire before a move.
 IF old_start<=clock_timestamp()+interval '15 minutes' OR p_new_start<=clock_timestamp()+interval '15 minutes'
  OR p_new_start>clock_timestamp()+interval '90 days' THEN RETURN jsonb_build_object('error','time'); END IF;
 IF EXISTS(SELECT 1 FROM public.group_reminder_deliveries WHERE video_class_id=v.id AND occurrence_start=p_occurrence AND state='processing' AND lease_until>clock_timestamp()) THEN RETURN jsonb_build_object('error','busy'); END IF;
 IF EXISTS(SELECT 1 FROM public.group_booking_reservations WHERE video_class_id=v.id AND occurrence_start=p_occurrence
  AND status IN ('creating','open','processing','refund_pending','payment_review')) THEN RETURN jsonb_build_object('error','payment_pending'); END IF;
 IF EXISTS(SELECT 1 FROM public.bookings b WHERE b.creator_id=v.creator_id AND b.status IN ('confirmed','pending_payment')
  AND tstzrange(b.scheduled_at,b.scheduled_at+make_interval(mins=>b.duration_minutes+coalesce(b.buffer_minutes,0)),'[)')
   && tstzrange(p_new_start,p_new_start+make_interval(mins=>o.duration_minutes),'[)'))
 OR EXISTS(SELECT 1 FROM public.video_class_occurrences other JOIN public.video_classes c ON c.id=other.video_class_id
  WHERE c.creator_id=v.creator_id AND (other.video_class_id,other.starts_at) IS DISTINCT FROM (v.id,p_occurrence)
   AND tstzrange(public.effective_group_start(other.video_class_id,other.starts_at),public.effective_group_start(other.video_class_id,other.starts_at)+make_interval(mins=>other.duration_minutes),'[)')
    && tstzrange(p_new_start,p_new_start+make_interval(mins=>o.duration_minutes),'[)'))

 OR EXISTS(SELECT 1 FROM public.video_classes c CROSS JOIN generate_series(-1,1) AS days(delta)
 CROSS JOIN LATERAL (SELECT CASE WHEN c.schedule_type='once' THEN c.starts_at ELSE
 ((date_trunc('day',p_new_start AT TIME ZONE 'Europe/Berlin')+make_interval(days=>days.delta))::date + left(c.recurring_time,5)::time) AT TIME ZONE 'Europe/Berlin' END AS candidate) AS slots
 WHERE c.creator_id=v.creator_id AND c.active AND slots.candidate IS NOT NULL
 AND (c.schedule_type='once' OR extract(dow FROM slots.candidate AT TIME ZONE 'Europe/Berlin')::integer=c.recurring_weekday)
 AND (c.id,slots.candidate) IS DISTINCT FROM (v.id,p_occurrence)
 AND NOT EXISTS(SELECT 1 FROM public.group_occurrence_schedules moved WHERE moved.video_class_id=c.id AND moved.occurrence_start=slots.candidate)
 AND tstzrange(slots.candidate,slots.candidate+make_interval(mins=>c.duration_minutes),'[)')
 && tstzrange(p_new_start,p_new_start+make_interval(mins=>o.duration_minutes),'[)'))
 THEN RETURN jsonb_build_object('error','conflict'); END IF;
 SELECT coalesce(max(revision),0)+1 INTO rev FROM public.group_occurrence_schedules WHERE video_class_id=v.id AND occurrence_start=p_occurrence;
 INSERT INTO public.group_occurrence_schedules VALUES(v.id,p_occurrence,p_new_start,rev)
 ON CONFLICT(video_class_id,occurrence_start) DO UPDATE SET scheduled_at=excluded.scheduled_at,revision=excluded.revision;
 INSERT INTO public.group_reschedule_requests VALUES(p_request_id,v.id,p_occurrence,old_start,p_new_start,p_actor_id,rev);
 -- Exactly one coach mail per occurrence change, plus each confirmed participant.
 FOR recipient IN
 SELECT b.user_id AS id,'customer'::text AS role FROM public.video_class_bookings b
 JOIN public.group_booking_reservations r ON r.id=b.reservation_id AND r.booking_id=b.id
 WHERE b.video_class_id=v.id AND b.occurrence_start=p_occurrence AND b.status='confirmed' AND r.status='confirmed'
  AND b.refund_status='not_requested' AND r.refund_status='not_requested' AND b.user_id<>coach
 UNION SELECT coach,'coach'
 LOOP
 INSERT INTO public.coaching_email_deliveries(booking_kind,booking_id,event_kind,event_version,recipient_id,recipient_role,details)
 VALUES('group',p_request_id,'reschedule',rev,recipient.id,recipient.role,jsonb_build_object('title',o.class_title,
 'scheduled_at',p_new_start,'old_scheduled_at',old_start,'coach_name',coach_name,'customer_id',CASE WHEN recipient.role='customer' THEN recipient.id ELSE NULL END,
 'amount_cents',0,'total_refunded_cents',0)) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'eventId',p_request_id,'scheduledAt',p_new_start,'revision',rev,'unchanged',false);
END; $$;
REVOKE ALL ON FUNCTION public.reschedule_group_occurrence(uuid,timestamptz,timestamptz,timestamptz,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_group_occurrence(uuid,timestamptz,timestamptz,timestamptz,uuid,uuid) TO service_role;

-- Calendar serialization protects a concurrent 1:1 insert/update against group moves.
CREATE FUNCTION private.guard_individual_group_conflict() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status NOT IN ('confirmed','pending_payment') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.creator_id::text,29317));
 IF EXISTS(SELECT 1 FROM public.video_class_occurrences o JOIN public.video_classes v ON v.id=o.video_class_id
 WHERE v.creator_id=NEW.creator_id AND tstzrange(public.effective_group_start(o.video_class_id,o.starts_at),
 public.effective_group_start(o.video_class_id,o.starts_at)+make_interval(mins=>o.duration_minutes),'[)')
 && tstzrange(NEW.scheduled_at,NEW.scheduled_at+make_interval(mins=>NEW.duration_minutes+coalesce(NEW.buffer_minutes,0)),'[)'))
 THEN RAISE EXCEPTION 'Coach calendar conflict' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.guard_individual_group_conflict() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.guard_individual_group_conflict() TO service_role;
CREATE TRIGGER guard_individual_group_conflict BEFORE INSERT OR UPDATE OF scheduled_at,status ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION private.guard_individual_group_conflict();
CREATE OR REPLACE FUNCTION public.valid_group_class_occurrence(p_class_id uuid,p_occurrence_start timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; wall timestamp; effective timestamptz;
BEGIN
 effective:=public.effective_group_start(p_class_id,p_occurrence_start);
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id;
 IF vc.id IS NULL OR p_occurrence_start IS NULL OR NOT isfinite(p_occurrence_start) OR NOT vc.active
  OR NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE id=vc.creator_id AND is_published)
  OR vc.duration_minutes NOT BETWEEN 5 AND 480 OR effective>now()+interval '90 days'
  OR effective+make_interval(mins=>vc.duration_minutes)<=now() THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.group_occurrence_schedules WHERE video_class_id=p_class_id AND occurrence_start=p_occurrence_start) THEN RETURN true; END IF;
 IF vc.schedule_type='once' THEN RETURN vc.starts_at IS NOT DISTINCT FROM p_occurrence_start; END IF;
 IF vc.schedule_type<>'recurring' OR vc.recurring_weekday IS NULL OR vc.recurring_time IS NULL
  OR vc.recurring_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00(\.0{1,6})?)?$' THEN RETURN false; END IF;
 wall:=p_occurrence_start AT TIME ZONE 'Europe/Berlin';
 RETURN extract(dow FROM wall)::integer=vc.recurring_weekday AND to_char(wall,'HH24:MI')=left(vc.recurring_time,5)
  AND date_trunc('minute',wall)=wall
  AND ((p_occurrence_start-interval '1 hour') AT TIME ZONE 'Europe/Berlin')<>wall
  AND ((p_occurrence_start+interval '1 hour') AT TIME ZONE 'Europe/Berlin')<>wall;
END; $$;
CREATE OR REPLACE FUNCTION public.group_class_availability(p_class_id uuid,p_occurrence_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; reserved integer; confirmed integer; capacity integer;
BEGIN
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id;
 IF vc.id IS NULL OR NOT vc.active OR NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE id=vc.creator_id AND is_published) THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF NOT public.valid_group_class_occurrence(p_class_id,p_occurrence_start) OR public.effective_group_start(p_class_id,p_occurrence_start)<=now() THEN RETURN jsonb_build_object('error','invalid_occurrence'); END IF;
 capacity:=greatest(0,least(coalesce(vc.max_participants,199),199));
 SELECT count(*) INTO confirmed FROM public.video_class_bookings WHERE video_class_id=vc.id AND status='confirmed'
   AND (occurrence_start=p_occurrence_start OR (occurrence_start IS NULL AND vc.schedule_type='once' AND vc.starts_at=p_occurrence_start));
 SELECT count(*) INTO reserved FROM public.group_booking_reservations WHERE video_class_id=vc.id AND occurrence_start=p_occurrence_start AND status IN ('creating','open','processing');
 RETURN jsonb_build_object('occurrenceStart',p_occurrence_start,'capacity',capacity,'remaining',greatest(0,capacity-confirmed-reserved),'isFull',confirmed+reserved>=capacity);
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_group_class_booking(p_class_id uuid,p_buyer_id uuid,p_request_id uuid,p_occurrence_start timestamptz,p_livemode boolean DEFAULT NULL,p_account_id text DEFAULT NULL,p_expected_price_cents integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; r public.group_booking_reservations%ROWTYPE; occ jsonb; slots jsonb; sid uuid; price integer; rid uuid:=gen_random_uuid(); bid uuid;
BEGIN
 IF p_buyer_id IS NULL OR p_request_id IS NULL THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id FOR UPDATE;
 IF vc.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
 SELECT * INTO r FROM public.group_booking_reservations WHERE buyer_id=p_buyer_id AND request_id=p_request_id FOR UPDATE;
 IF r.id IS NOT NULL THEN
   IF r.video_class_id<>vc.id OR r.occurrence_start IS DISTINCT FROM p_occurrence_start THEN RETURN jsonb_build_object('error','request_conflict'); END IF;
   RETURN jsonb_build_object('reservation',to_jsonb(r),'created',false);
 END IF;
 IF NOT vc.active OR NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE id=vc.creator_id AND is_published AND user_id<>p_buyer_id)
   OR p_occurrence_start IS NULL OR public.effective_group_start(p_class_id,p_occurrence_start)<=now() THEN RETURN jsonb_build_object('error','not_available'); END IF;
 IF NOT public.valid_group_class_occurrence(vc.id,p_occurrence_start) THEN RETURN jsonb_build_object('error','invalid_occurrence'); END IF;
 SELECT * INTO r FROM public.group_booking_reservations WHERE buyer_id=p_buyer_id AND video_class_id=vc.id AND occurrence_start=p_occurrence_start
   AND status IN ('creating','open','processing','confirmed') FOR UPDATE;
 IF r.id IS NOT NULL THEN RETURN jsonb_build_object('reservation',to_jsonb(r),'created',false); END IF;
 IF EXISTS(SELECT 1 FROM public.video_class_bookings WHERE video_class_id=vc.id AND user_id=p_buyer_id AND status='confirmed'
   AND (occurrence_start=p_occurrence_start OR (occurrence_start IS NULL AND vc.schedule_type='once'))) THEN RETURN jsonb_build_object('error','already_booked'); END IF;
 slots:=public.group_class_availability(vc.id,p_occurrence_start);
 IF slots ? 'error' THEN RETURN slots; END IF;
 IF (slots->>'isFull')::boolean THEN RETURN jsonb_build_object('error','full'); END IF;
 IF p_expected_price_cents IS DISTINCT FROM vc.price_cents THEN RETURN jsonb_build_object('error','price_changed'); END IF;
 price:=vc.price_cents;
 IF vc.included_in_subscription THEN
   SELECT s.id INTO sid FROM public.subscriptions s JOIN public.subscription_tiers t ON t.id=s.tier_id AND t.creator_id=s.creator_id
   WHERE s.buyer_id=p_buyer_id AND s.creator_id=vc.creator_id AND s.status='active' AND s.current_period_end>now()
    AND (s.stripe_livemode IS TRUE OR (s.stripe_livemode IS NULL AND s.stripe_subscription_id LIKE 'free\_%' ESCAPE '\'))
   ORDER BY s.current_period_end DESC LIMIT 1;
   IF sid IS NOT NULL THEN price:=0; END IF;
 END IF;
 IF price IS NULL OR price<0 OR (price>0 AND (price<50 OR p_livemode IS NULL OR p_account_id IS NULL OR p_account_id !~ '^acct_[A-Za-z0-9]+$')) THEN RETURN jsonb_build_object('error','invalid_offer'); END IF;
 -- Freeze a canonical agreement only after the request has passed all checks.
 occ:=public.ensure_group_class_occurrence(vc.id,p_occurrence_start);
 IF occ ? 'error' THEN RETURN occ; END IF;
 INSERT INTO public.group_booking_reservations(id,request_id,buyer_id,creator_id,video_class_id,occurrence_start,duration_minutes,class_title,creator_slug,price_cents,subscription_id,stripe_livemode,account_id,checkout_idempotency_key,checkout_expires_at,status,refund_idempotency_key)
 VALUES(rid,p_request_id,p_buyer_id,vc.creator_id,vc.id,p_occurrence_start,(occ->>'duration_minutes')::integer,occ->>'class_title',
  (SELECT slug FROM public.creator_profiles WHERE id=vc.creator_id),price,sid,CASE WHEN price>0 THEN p_livemode ELSE NULL END,
  CASE WHEN price>0 THEN p_account_id ELSE NULL END,'ardore-group-checkout-'||rid||'-v1',now()+interval '35 minutes',
  CASE WHEN price=0 THEN 'confirmed' ELSE 'creating' END,'ardore-group-refund-'||rid||'-v1') RETURNING * INTO r;
 IF price=0 THEN
   INSERT INTO public.video_class_bookings(video_class_id,user_id,subscription_id,price_paid_cents,status,occurrence_start,duration_minutes,class_title,reservation_id,payment_status)
   VALUES(vc.id,p_buyer_id,sid,0,'confirmed',p_occurrence_start,r.duration_minutes,r.class_title,r.id,'not_required') RETURNING id INTO bid;
   UPDATE public.group_booking_reservations SET booking_id=bid WHERE id=r.id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('reservation',to_jsonb(r),'created',true);
END; $$;
CREATE OR REPLACE FUNCTION public.cancel_group_class_booking(p_booking_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.video_class_bookings%ROWTYPE; r public.group_booking_reservations%ROWTYPE; coach uuid;
BEGIN
 SELECT * INTO b FROM public.video_class_bookings WHERE id=p_booking_id;
 IF b.id IS NULL OR b.reservation_id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
 SELECT user_id INTO coach FROM public.creator_profiles WHERE id=(SELECT creator_id FROM public.video_classes WHERE id=b.video_class_id);
 IF p_actor_id IS NULL OR p_actor_id NOT IN (b.user_id,coach) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
 -- Same class -> reservation -> booking lock order as fulfillment.
 PERFORM id FROM public.video_classes WHERE id=b.video_class_id FOR UPDATE;
 SELECT * INTO r FROM public.group_booking_reservations WHERE id=b.reservation_id FOR UPDATE;
 SELECT * INTO b FROM public.video_class_bookings WHERE id=p_booking_id FOR UPDATE;
 IF b.status='cancelled' THEN RETURN jsonb_build_object('reservation',to_jsonb(r),'already_cancelled',true); END IF;
 IF public.effective_group_start(r.video_class_id,r.occurrence_start)<=now() AND p_actor_id IS DISTINCT FROM coach THEN RETURN jsonb_build_object('error','already_started'); END IF;
 IF public.effective_group_start(r.video_class_id,r.occurrence_start)+make_interval(mins=>r.duration_minutes)<=now() THEN RETURN jsonb_build_object('error','already_ended'); END IF;
 UPDATE public.video_class_bookings SET status='cancelled',refund_status=CASE WHEN price_paid_cents>0 THEN 'pending' ELSE 'not_requested' END WHERE id=b.id;
 UPDATE public.group_booking_reservations SET status=CASE WHEN price_cents>0 THEN 'refund_pending' ELSE 'cancelled' END,
  refund_status=CASE WHEN price_cents>0 THEN 'pending' ELSE 'not_requested' END,
  refund_requested_at=CASE WHEN price_cents>0 THEN coalesce(refund_requested_at,now()) ELSE NULL END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('reservation',to_jsonb(r));
END; $$;
CREATE OR REPLACE VIEW public.group_booking_status WITH(security_invoker=true) AS
SELECT r.id,r.video_class_id,r.creator_id,r.occurrence_start,r.duration_minutes,r.class_title,r.creator_slug,r.price_cents,r.status,r.booking_id,r.refund_status,r.amount_refunded_cents,r.stripe_livemode,r.created_at,
 coalesce(s.scheduled_at,r.occurrence_start) AS scheduled_at
FROM public.group_booking_reservations r LEFT JOIN public.group_occurrence_schedules s USING(video_class_id,occurrence_start);

CREATE OR REPLACE VIEW public.group_reminder_recipients WITH (security_invoker = true) AS
WITH attendees AS NOT MATERIALIZED (
  SELECT o.video_class_id, o.starts_at AS occurrence_start, b.user_id,
    c.user_id AS coach_id, o.class_title, o.duration_minutes, c.display_name AS coach_name, public.effective_group_start(o.video_class_id,o.starts_at) AS scheduled_at
  FROM public.video_class_occurrences o
  JOIN public.video_classes v ON v.id = o.video_class_id
  JOIN public.creator_profiles c ON c.id = v.creator_id
  JOIN public.video_class_bookings b ON b.video_class_id = o.video_class_id AND b.occurrence_start = o.starts_at
  JOIN public.group_booking_reservations r ON r.id = b.reservation_id AND r.booking_id = b.id
    AND r.video_class_id = o.video_class_id AND r.occurrence_start = o.starts_at
    AND r.buyer_id = b.user_id AND r.creator_id = v.creator_id
  WHERE public.effective_group_start(o.video_class_id,o.starts_at) > now() AND public.effective_group_start(o.video_class_id,o.starts_at) <= now() + interval '24 hours'
    AND b.status = 'confirmed' AND r.status = 'confirmed'
    AND b.refund_status = 'not_requested' AND r.refund_status = 'not_requested'
    AND b.amount_refunded_cents = 0 AND r.amount_refunded_cents = 0
    AND ((b.price_paid_cents = 0 AND r.price_cents = 0 AND b.payment_status = 'not_required')
      OR (b.price_paid_cents > 0 AND b.price_paid_cents = r.price_cents
        AND b.payment_status = 'paid' AND b.stripe_livemode IS TRUE AND r.stripe_livemode IS TRUE))
)
SELECT video_class_id, occurrence_start, user_id AS recipient_id, 'participant'::text AS recipient_role,
  class_title, duration_minutes, coach_name, scheduled_at FROM attendees WHERE user_id <> coach_id
UNION
SELECT video_class_id, occurrence_start, coach_id, 'coach'::text,
  class_title, duration_minutes, coach_name, scheduled_at FROM attendees;

ALTER TABLE public.group_reminder_deliveries ADD COLUMN schedule_revision integer NOT NULL DEFAULT 0;
DO $$ DECLARE c text; BEGIN SELECT conname INTO STRICT c FROM pg_constraint WHERE conrelid='public.group_reminder_deliveries'::regclass AND contype='u' AND cardinality(conkey)=3; EXECUTE format('ALTER TABLE public.group_reminder_deliveries DROP CONSTRAINT %I',c); END $$;
ALTER TABLE public.group_reminder_deliveries ADD UNIQUE(video_class_id,occurrence_start,recipient_id,schedule_revision);
CREATE OR REPLACE FUNCTION public.group_reminder_is_eligible(p_class_id uuid,p_occurrence timestamptz,p_recipient_id uuid,p_role text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.group_reminder_recipients r WHERE r.video_class_id=p_class_id AND r.occurrence_start=p_occurrence
 AND r.recipient_id=p_recipient_id AND r.recipient_role=p_role AND r.scheduled_at>clock_timestamp() AND r.scheduled_at<=clock_timestamp()+interval '24 hours')
 AND NOT EXISTS(SELECT 1 FROM public.notification_preferences WHERE user_id=p_recipient_id AND email_session_reminder IS FALSE);
$$;
CREATE OR REPLACE FUNCTION public.claim_group_reminder(p_class_id uuid, p_occurrence timestamptz, p_recipient_id uuid,
  p_role text, p_payload jsonb, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.group_reminder_deliveries%ROWTYPE; observed timestamptz; rev integer;
BEGIN
  IF p_class_id IS NULL OR p_recipient_id IS NULL OR p_token IS NULL OR p_occurrence IS NULL
    OR NOT isfinite(p_occurrence) OR p_role IS NULL OR p_role NOT IN ('participant', 'coach')
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR jsonb_typeof(p_payload->'from') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'from')) = 0
    OR jsonb_typeof(p_payload->'to') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'to')) = 0
    OR jsonb_typeof(p_payload->'subject') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'subject')) = 0
    OR jsonb_typeof(p_payload->'html') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'text') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'Invalid group reminder input' USING ERRCODE = '23514'; END IF;
  IF NOT public.group_reminder_is_eligible(p_class_id, p_occurrence, p_recipient_id, p_role) THEN
    RETURN jsonb_build_object('state', 'ineligible');
  END IF;
  SELECT coalesce((SELECT revision FROM public.group_occurrence_schedules WHERE video_class_id=p_class_id AND occurrence_start=p_occurrence),0) INTO rev;
  INSERT INTO public.group_reminder_deliveries(video_class_id, occurrence_start, recipient_id, recipient_role, payload,schedule_revision)
    VALUES (p_class_id, p_occurrence, p_recipient_id, p_role, p_payload,rev)
    ON CONFLICT (video_class_id, occurrence_start, recipient_id,schedule_revision) DO NOTHING;
  SELECT * INTO STRICT d FROM public.group_reminder_deliveries
    WHERE video_class_id = p_class_id AND occurrence_start = p_occurrence AND recipient_id = p_recipient_id AND schedule_revision=rev FOR UPDATE;
  observed := clock_timestamp();
  IF d.recipient_role IS DISTINCT FROM p_role THEN RETURN jsonb_build_object('state', 'ineligible'); END IF;
  IF d.state IN ('sent', 'held') THEN RETURN jsonb_build_object('state', d.state); END IF;
  IF d.state = 'processing' AND d.lease_until > observed THEN RETURN jsonb_build_object('state', 'busy'); END IF;
  IF NOT public.group_reminder_is_eligible(p_class_id, p_occurrence, p_recipient_id, p_role) THEN
    RETURN jsonb_build_object('state', 'ineligible');
  END IF;
  -- Resend retains idempotency keys for 24h. Do not risk resending an ambiguous
  -- provider outcome after that window; require operator reconciliation instead.
  IF d.first_attempt_at <= observed - interval '23 hours' THEN
    UPDATE public.group_reminder_deliveries SET state = 'held', lease_token = NULL, lease_until = NULL WHERE id = d.id;
    RETURN jsonb_build_object('state', 'held');
  END IF;
  UPDATE public.group_reminder_deliveries SET state = 'processing', lease_token = p_token,
    lease_until = observed + interval '5 minutes', first_attempt_at = coalesce(first_attempt_at, observed) WHERE id = d.id;
  RETURN jsonb_build_object('state', 'claimed', 'id', d.id, 'payload', d.payload);
END;
$$;
CREATE FUNCTION public.claim_current_group_reminder(p_class_id uuid,p_occurrence timestamptz,p_recipient_id uuid,p_role text,p_payload jsonb,p_token uuid,p_expected_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM id FROM public.video_classes WHERE id=p_class_id FOR UPDATE;
 IF public.effective_group_start(p_class_id,p_occurrence) IS DISTINCT FROM p_expected_start THEN RETURN jsonb_build_object('state','ineligible'); END IF;
 RETURN public.claim_group_reminder(p_class_id,p_occurrence,p_recipient_id,p_role,p_payload,p_token);
END; $$;
REVOKE ALL ON FUNCTION public.claim_current_group_reminder(uuid,timestamptz,uuid,text,jsonb,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_current_group_reminder(uuid,timestamptz,uuid,text,jsonb,uuid,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION private.queue_coaching_emails() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE customer uuid; coach uuid; coach_name text; title text; scheduled timestamptz;
 kind text; details jsonb; refund_delta integer; recipient record; event record;
BEGIN
 IF NOT (NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
   AND NEW.amount_refunded_cents <= OLD.amount_refunded_cents THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='bookings' THEN
  kind := 'individual'; customer := NEW.buyer_id; scheduled := NEW.scheduled_at; title := '1:1-Coaching';
  SELECT c.user_id,c.display_name INTO coach,coach_name FROM public.creator_profiles c WHERE c.id=NEW.creator_id;
 ELSE
  kind := 'group'; customer := NEW.user_id; scheduled := public.effective_group_start(NEW.video_class_id,NEW.occurrence_start); title := coalesce(NEW.class_title,'Gruppencoaching');
  SELECT c.user_id,c.display_name INTO coach,coach_name FROM public.video_classes v
   JOIN public.creator_profiles c ON c.id=v.creator_id WHERE v.id=NEW.video_class_id;
 END IF;
 -- Legacy group registrations have no trustworthy occurrence snapshot.
 IF scheduled IS NULL THEN RETURN NEW; END IF;
 refund_delta := NEW.amount_refunded_cents - OLD.amount_refunded_cents;
 details := jsonb_build_object('title',title,'scheduled_at',scheduled,'coach_name',coalesce(coach_name,'Dein Coach'),
  'customer_id',customer,'coach_id',coach,'amount_cents',refund_delta,
  'total_refunded_cents',NEW.amount_refunded_cents);
 FOR event IN
  SELECT 'cancellation'::text AS kind,0 AS version WHERE NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
  UNION ALL SELECT 'refund',NEW.amount_refunded_cents WHERE refund_delta>0
    AND NEW.payment_status IN ('refunded','partially_refunded')
 LOOP
  FOR recipient IN SELECT customer AS id,'customer'::text AS role WHERE customer IS NOT NULL
   UNION ALL SELECT coach,'coach' WHERE coach IS NOT NULL AND coach IS DISTINCT FROM customer
  LOOP
   INSERT INTO public.coaching_email_deliveries(booking_kind,booking_id,event_kind,event_version,recipient_id,recipient_role,details)
    VALUES(kind,NEW.id,event.kind,event.version,recipient.id,recipient.role,details)
    ON CONFLICT (booking_kind,booking_id,event_kind,event_version,recipient_id) DO NOTHING;
  END LOOP;
 END LOOP;
 RETURN NEW;
END; $$;

-- Serialize newly frozen group occurrences with 1:1 mutations and group moves.
CREATE FUNCTION private.guard_new_group_calendar() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE creator uuid;
BEGIN
 SELECT creator_id INTO creator FROM public.video_classes WHERE id=NEW.video_class_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(creator::text,29317));
 IF EXISTS(SELECT 1 FROM public.bookings b WHERE b.creator_id=creator AND b.status IN ('confirmed','pending_payment')
 AND tstzrange(b.scheduled_at,b.scheduled_at+make_interval(mins=>b.duration_minutes+coalesce(b.buffer_minutes,0)),'[)')
 && tstzrange(NEW.starts_at,NEW.starts_at+make_interval(mins=>NEW.duration_minutes),'[)'))
 OR EXISTS(SELECT 1 FROM public.video_class_occurrences o JOIN public.video_classes v ON v.id=o.video_class_id
 WHERE v.creator_id=creator AND tstzrange(public.effective_group_start(o.video_class_id,o.starts_at),
 public.effective_group_start(o.video_class_id,o.starts_at)+make_interval(mins=>o.duration_minutes),'[)')
 && tstzrange(NEW.starts_at,NEW.starts_at+make_interval(mins=>NEW.duration_minutes),'[)'))
 THEN RAISE EXCEPTION 'Coach calendar conflict' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.guard_new_group_calendar() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.guard_new_group_calendar() TO service_role;
CREATE TRIGGER guard_new_group_calendar BEFORE INSERT ON public.video_class_occurrences
 FOR EACH ROW EXECUTE FUNCTION private.guard_new_group_calendar();

NOTIFY pgrst,'reload schema';
COMMIT;
