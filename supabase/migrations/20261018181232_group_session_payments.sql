-- Per-occurrence group bookings. No historical booking or payment is backfilled.
-- All financial mutations are service-only and serialize through the class row.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.payment_orders DROP CONSTRAINT payment_orders_kind_check;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_kind_check CHECK (kind IN ('booking','products','subscription','group'));
ALTER TABLE public.payment_settlements DROP CONSTRAINT payment_settlements_kind_check;
ALTER TABLE public.payment_settlements ADD CONSTRAINT payment_settlements_kind_check CHECK (kind IN ('booking','products','subscription','group'));

CREATE TABLE public.video_class_occurrences (
  video_class_id uuid NOT NULL REFERENCES public.video_classes(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  class_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(video_class_id, starts_at)
);
CREATE TABLE public.group_booking_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  creator_id uuid NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
  video_class_id uuid NOT NULL,
  occurrence_start timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  class_title text NOT NULL,
  creator_slug text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents = 0 OR price_cents BETWEEN 50 AND 2000000000),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  stripe_livemode boolean,
  account_id text,
  payment_order_id uuid UNIQUE REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  stripe_checkout_session_id text UNIQUE,
  checkout_url text,
  checkout_idempotency_key text NOT NULL UNIQUE,
  checkout_expires_at timestamptz NOT NULL,
  checkout_request_started_at timestamptz,
  status text NOT NULL CHECK (status IN ('creating','open','processing','confirmed','expired','failed','cancelled','refund_pending','refunded','payment_review')),
  booking_id uuid UNIQUE,
  refund_status text NOT NULL DEFAULT 'not_requested' CHECK (refund_status IN ('not_requested','pending','succeeded','failed')),
  refund_idempotency_key text NOT NULL UNIQUE,
  refund_provider_id text UNIQUE,
  refund_amount_cents integer CHECK (refund_amount_cents>0 AND refund_amount_cents<=price_cents),
  refund_request_started_at timestamptz,
  refund_requested_at timestamptz,
  amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0 AND amount_refunded_cents <= price_cents),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(buyer_id,request_id),
  FOREIGN KEY(video_class_id,occurrence_start) REFERENCES public.video_class_occurrences(video_class_id,starts_at) ON DELETE RESTRICT,
  CHECK ((price_cents=0 AND account_id IS NULL AND stripe_livemode IS NULL) OR
    (price_cents>0 AND account_id IS NOT NULL AND account_id ~ '^acct_[A-Za-z0-9]+$' AND stripe_livemode IS NOT NULL))
);
CREATE INDEX group_booking_reservations_capacity_idx ON public.group_booking_reservations(video_class_id,occurrence_start,status);
CREATE INDEX group_booking_reservations_recovery_idx ON public.group_booking_reservations(status,updated_at);
CREATE UNIQUE INDEX group_booking_reservations_active_buyer_idx ON public.group_booking_reservations(video_class_id,buyer_id,occurrence_start)
  WHERE status IN ('creating','open','processing','confirmed');
ALTER TABLE public.video_class_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_booking_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_class_occurrences,public.group_booking_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.video_class_occurrences,public.group_booking_reservations TO service_role;
CREATE POLICY group_booking_reservations_select_own ON public.group_booking_reservations FOR SELECT TO authenticated USING (buyer_id=(SELECT auth.uid()));
GRANT SELECT(id,video_class_id,creator_id,occurrence_start,duration_minutes,class_title,creator_slug,price_cents,status,booking_id,refund_status,amount_refunded_cents,stripe_livemode,created_at)
  ON public.group_booking_reservations TO authenticated;
CREATE VIEW public.group_booking_status WITH(security_invoker=true) AS
  SELECT id,video_class_id,creator_id,occurrence_start,duration_minutes,class_title,creator_slug,price_cents,status,booking_id,refund_status,amount_refunded_cents,stripe_livemode,created_at
  FROM public.group_booking_reservations;
REVOKE ALL ON public.group_booking_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.group_booking_status TO authenticated,service_role;

ALTER TABLE public.video_class_bookings
  ADD COLUMN occurrence_start timestamptz,
  ADD COLUMN duration_minutes integer CHECK (duration_minutes BETWEEN 5 AND 480),
  ADD COLUMN class_title text,
  ADD COLUMN payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  ADD COLUMN reservation_id uuid UNIQUE REFERENCES public.group_booking_reservations(id) ON DELETE RESTRICT,
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unknown' CHECK (payment_status IN ('unknown','not_required','paid','partially_refunded','refunded','disputed','chargeback')),
  ADD COLUMN stripe_livemode boolean,
  ADD COLUMN refund_status text NOT NULL DEFAULT 'not_requested' CHECK (refund_status IN ('not_requested','pending','succeeded','failed')),
  ADD COLUMN amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK(amount_refunded_cents>=0);
ALTER TABLE public.video_class_bookings DROP CONSTRAINT video_class_bookings_video_class_id_user_id_key;
CREATE UNIQUE INDEX video_class_bookings_legacy_identity_key ON public.video_class_bookings(video_class_id,user_id) WHERE occurrence_start IS NULL;
CREATE UNIQUE INDEX video_class_bookings_occurrence_identity_key ON public.video_class_bookings(video_class_id,user_id,occurrence_start) WHERE occurrence_start IS NOT NULL AND status='confirmed';
CREATE INDEX video_class_bookings_occurrence_capacity_idx ON public.video_class_bookings(video_class_id,occurrence_start,status);

CREATE FUNCTION public.protect_group_booking_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.reservation_id IS NOT NULL AND (NEW.id,NEW.video_class_id,NEW.user_id,NEW.subscription_id,NEW.occurrence_start,NEW.duration_minutes,NEW.class_title,NEW.price_paid_cents,NEW.payment_order_id,NEW.reservation_id,NEW.stripe_livemode)
    IS DISTINCT FROM (OLD.id,OLD.video_class_id,OLD.user_id,OLD.subscription_id,OLD.occurrence_start,OLD.duration_minutes,OLD.class_title,OLD.price_paid_cents,OLD.payment_order_id,OLD.reservation_id,OLD.stripe_livemode)
  THEN RAISE EXCEPTION 'Immutable group booking agreement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_group_booking_snapshot BEFORE UPDATE ON public.video_class_bookings FOR EACH ROW EXECUTE FUNCTION public.protect_group_booking_snapshot();
CREATE FUNCTION public.protect_group_reservation_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.id,NEW.request_id,NEW.buyer_id,NEW.creator_id,NEW.video_class_id,NEW.occurrence_start,NEW.duration_minutes,NEW.class_title,NEW.creator_slug,NEW.price_cents,NEW.subscription_id,NEW.stripe_livemode,NEW.account_id,NEW.checkout_idempotency_key,NEW.checkout_expires_at,NEW.refund_idempotency_key,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.request_id,OLD.buyer_id,OLD.creator_id,OLD.video_class_id,OLD.occurrence_start,OLD.duration_minutes,OLD.class_title,OLD.creator_slug,OLD.price_cents,OLD.subscription_id,OLD.stripe_livemode,OLD.account_id,OLD.checkout_idempotency_key,OLD.checkout_expires_at,OLD.refund_idempotency_key,OLD.created_at)
    OR (OLD.payment_order_id IS NOT NULL AND NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id)
    OR (OLD.stripe_checkout_session_id IS NOT NULL AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id)
    OR (OLD.booking_id IS NOT NULL AND NEW.booking_id IS DISTINCT FROM OLD.booking_id)
    OR (OLD.refund_amount_cents IS NOT NULL AND NEW.refund_amount_cents IS DISTINCT FROM OLD.refund_amount_cents)
    OR (OLD.refund_provider_id IS NOT NULL AND NEW.refund_provider_id IS DISTINCT FROM OLD.refund_provider_id)
    OR NEW.amount_refunded_cents<OLD.amount_refunded_cents
  THEN RAISE EXCEPTION 'Immutable group reservation agreement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_group_reservation_snapshot BEFORE UPDATE ON public.group_booking_reservations FOR EACH ROW EXECUTE FUNCTION public.protect_group_reservation_snapshot();
CREATE FUNCTION public.protect_group_occurrence_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.video_class_id,NEW.starts_at,NEW.duration_minutes,NEW.class_title,NEW.created_at)
    IS DISTINCT FROM (OLD.video_class_id,OLD.starts_at,OLD.duration_minutes,OLD.class_title,OLD.created_at)
  THEN RAISE EXCEPTION 'Immutable group occurrence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_group_occurrence_snapshot BEFORE UPDATE ON public.video_class_occurrences FOR EACH ROW EXECUTE FUNCTION public.protect_group_occurrence_snapshot();

CREATE FUNCTION public.valid_group_class_occurrence(p_class_id uuid,p_occurrence_start timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; wall timestamp;
BEGIN
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id;
 IF vc.id IS NULL OR p_occurrence_start IS NULL OR NOT isfinite(p_occurrence_start) OR NOT vc.active
  OR NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE id=vc.creator_id AND is_published)
  OR vc.duration_minutes NOT BETWEEN 5 AND 480 OR p_occurrence_start>now()+interval '90 days'
  OR p_occurrence_start+make_interval(mins=>vc.duration_minutes)<=now() THEN RETURN false; END IF;
 IF vc.schedule_type='once' THEN RETURN vc.starts_at IS NOT DISTINCT FROM p_occurrence_start; END IF;
 IF vc.schedule_type<>'recurring' OR vc.recurring_weekday IS NULL OR vc.recurring_time IS NULL
  OR vc.recurring_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00(\.0{1,6})?)?$' THEN RETURN false; END IF;
 wall:=p_occurrence_start AT TIME ZONE 'Europe/Berlin';
 RETURN extract(dow FROM wall)::integer=vc.recurring_weekday AND to_char(wall,'HH24:MI')=left(vc.recurring_time,5)
  AND date_trunc('minute',wall)=wall
  AND ((p_occurrence_start-interval '1 hour') AT TIME ZONE 'Europe/Berlin')<>wall
  AND ((p_occurrence_start+interval '1 hour') AT TIME ZONE 'Europe/Berlin')<>wall;
END; $$;
CREATE FUNCTION public.ensure_group_class_occurrence(p_class_id uuid,p_occurrence_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; occ public.video_class_occurrences%ROWTYPE;
BEGIN
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id FOR UPDATE;
 IF NOT public.valid_group_class_occurrence(p_class_id,p_occurrence_start) THEN RETURN jsonb_build_object('error','invalid_occurrence'); END IF;
 SELECT * INTO occ FROM public.video_class_occurrences WHERE video_class_id=vc.id AND starts_at=p_occurrence_start;
 IF occ.video_class_id IS NOT NULL THEN RETURN to_jsonb(occ); END IF;
 INSERT INTO public.video_class_occurrences(video_class_id,starts_at,duration_minutes,class_title)
  VALUES(vc.id,p_occurrence_start,vc.duration_minutes,vc.title) RETURNING * INTO occ;
 RETURN to_jsonb(occ);
END; $$;

CREATE FUNCTION public.group_class_availability(p_class_id uuid,p_occurrence_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE vc public.video_classes%ROWTYPE; reserved integer; confirmed integer; capacity integer;
BEGIN
 SELECT * INTO vc FROM public.video_classes WHERE id=p_class_id;
 IF vc.id IS NULL OR NOT vc.active OR NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE id=vc.creator_id AND is_published) THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF NOT public.valid_group_class_occurrence(p_class_id,p_occurrence_start) OR p_occurrence_start<=now() THEN RETURN jsonb_build_object('error','invalid_occurrence'); END IF;
 capacity:=greatest(0,least(coalesce(vc.max_participants,199),199));
 SELECT count(*) INTO confirmed FROM public.video_class_bookings WHERE video_class_id=vc.id AND status='confirmed'
   AND (occurrence_start=p_occurrence_start OR (occurrence_start IS NULL AND vc.schedule_type='once' AND vc.starts_at=p_occurrence_start));
 SELECT count(*) INTO reserved FROM public.group_booking_reservations WHERE video_class_id=vc.id AND occurrence_start=p_occurrence_start AND status IN ('creating','open','processing');
 RETURN jsonb_build_object('occurrenceStart',p_occurrence_start,'capacity',capacity,'remaining',greatest(0,capacity-confirmed-reserved),'isFull',confirmed+reserved>=capacity);
END; $$;

CREATE FUNCTION public.reserve_group_class_booking(p_class_id uuid,p_buyer_id uuid,p_request_id uuid,p_occurrence_start timestamptz,p_livemode boolean DEFAULT NULL,p_account_id text DEFAULT NULL,p_expected_price_cents integer DEFAULT NULL)
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
   OR p_occurrence_start IS NULL OR p_occurrence_start<=now() THEN RETURN jsonb_build_object('error','not_available'); END IF;
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

CREATE FUNCTION public.bind_group_checkout(p_reservation_id uuid,p_order_id uuid,p_session_id text,p_checkout_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.group_booking_reservations%ROWTYPE; o public.payment_orders%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.group_booking_reservations WHERE id=p_reservation_id FOR UPDATE;
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id;
 IF r.id IS NULL OR r.price_cents<=0 OR o.id IS DISTINCT FROM r.id OR o.kind<>'group' OR o.buyer_id<>r.buyer_id OR o.creator_id<>r.creator_id
  OR o.gross_cents<>r.price_cents OR o.account_id IS DISTINCT FROM r.account_id OR o.stripe_livemode IS DISTINCT FROM r.stripe_livemode
  OR o.reference->>'reservationId' IS DISTINCT FROM r.id::text OR o.stripe_checkout_session_id IS DISTINCT FROM p_session_id
  OR (r.stripe_checkout_session_id IS NOT NULL AND r.stripe_checkout_session_id IS DISTINCT FROM p_session_id)
  THEN RAISE EXCEPTION 'Group checkout ownership mismatch'; END IF;
 UPDATE public.group_booking_reservations SET payment_order_id=o.id,stripe_checkout_session_id=p_session_id,checkout_url=p_checkout_url,
  status=CASE WHEN status='creating' THEN 'open' ELSE status END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END; $$;

-- Preserve the existing discount wrapper and its implementation for other kinds.
ALTER FUNCTION public.fulfill_payment_order(uuid,uuid,timestamptz,text) RENAME TO fulfill_payment_order_without_group;
CREATE FUNCTION public.fulfill_payment_order(p_order_id uuid,p_settlement_id uuid DEFAULT NULL,p_period_end timestamptz DEFAULT NULL,p_subscription_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE; s public.payment_settlements%ROWTYPE; r public.group_booking_reservations%ROWTYPE;
 vc public.video_classes%ROWTYPE; n integer; bid uuid; available boolean;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order missing'; END IF;
 IF o.kind<>'group' THEN RETURN public.fulfill_payment_order_without_group(p_order_id,p_settlement_id,p_period_end,p_subscription_status); END IF;
 SELECT * INTO vc FROM public.video_classes WHERE id=(o.reference->>'videoClassId')::uuid FOR UPDATE;
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id AND order_id=o.id FOR UPDATE;
 SELECT * INTO r FROM public.group_booking_reservations WHERE id=(o.reference->>'reservationId')::uuid FOR UPDATE;
 IF r.id IS NULL OR s.id IS NULL OR r.id<>o.id OR r.buyer_id<>o.buyer_id OR r.creator_id<>o.creator_id OR r.video_class_id IS DISTINCT FROM vc.id
  OR r.price_cents<>o.gross_cents OR s.gross_cents<>r.price_cents OR s.kind<>'group' OR s.buyer_id<>r.buyer_id OR s.creator_id<>r.creator_id
  OR r.stripe_livemode IS DISTINCT FROM s.stripe_livemode OR r.stripe_livemode IS DISTINCT FROM o.stripe_livemode OR s.account_id IS DISTINCT FROM r.account_id
  OR r.account_id IS DISTINCT FROM o.account_id OR (r.payment_order_id IS NOT NULL AND r.payment_order_id<>o.id)
  OR (o.reference->>'occurrenceStart')::timestamptz IS DISTINCT FROM r.occurrence_start
  OR (o.reference->>'durationMinutes')::integer IS DISTINCT FROM r.duration_minutes
  THEN RAISE EXCEPTION 'Group settlement ownership mismatch'; END IF;
 IF s.fulfillment_state='fulfilled' THEN RETURN jsonb_build_object('newly_fulfilled',false); END IF;
 IF s.fulfillment_state IN ('refund_required','refunded') THEN RETURN jsonb_build_object('newly_fulfilled',false,'refund_required',s.fulfillment_state='refund_required'); END IF;
 SELECT count(*) INTO n FROM public.video_class_bookings WHERE video_class_id=vc.id AND status='confirmed'
  AND (occurrence_start=r.occurrence_start OR (occurrence_start IS NULL AND vc.schedule_type='once' AND vc.starts_at=r.occurrence_start));
 SELECT n+count(*) INTO n FROM public.group_booking_reservations WHERE video_class_id=vc.id AND occurrence_start=r.occurrence_start
  AND id<>r.id AND status IN ('creating','open','processing');
 available:=vc.active AND r.occurrence_start>now() AND r.refund_status='not_requested' AND r.status IN ('creating','open','processing','expired','failed')
  AND vc.duration_minutes=r.duration_minutes AND n<least(coalesce(vc.max_participants,199),199)
  AND NOT EXISTS(SELECT 1 FROM public.video_class_bookings WHERE video_class_id=vc.id AND user_id=r.buyer_id AND status='confirmed' AND occurrence_start=r.occurrence_start);
 IF NOT available THEN
  UPDATE public.payment_orders SET state='refund_required',updated_at=now() WHERE id=o.id;
  UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending',updated_at=now() WHERE id=s.id;
  UPDATE public.group_booking_reservations SET status='refund_pending',refund_status='pending',refund_requested_at=coalesce(refund_requested_at,now()),payment_order_id=o.id,updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('newly_fulfilled',false,'refund_required',true);
 END IF;
 INSERT INTO public.video_class_bookings(video_class_id,user_id,subscription_id,price_paid_cents,status,occurrence_start,duration_minutes,class_title,payment_order_id,reservation_id,payment_status,stripe_livemode)
 VALUES(vc.id,r.buyer_id,r.subscription_id,r.price_cents,'confirmed',r.occurrence_start,r.duration_minutes,r.class_title,o.id,r.id,'paid',r.stripe_livemode) RETURNING id INTO bid;
 UPDATE public.group_booking_reservations SET booking_id=bid,payment_order_id=o.id,status='confirmed',updated_at=now() WHERE id=r.id;
 UPDATE public.payment_orders SET state='fulfilled',updated_at=now() WHERE id=o.id;
 UPDATE public.payment_settlements SET fulfillment_state='fulfilled',state='pending',updated_at=now() WHERE id=s.id;
 RETURN jsonb_build_object('newly_fulfilled',true,'booking_id',bid);
END; $$;

ALTER FUNCTION public.claim_settlement_action(uuid,text,integer,integer,uuid) RENAME TO claim_settlement_action_without_group;
CREATE FUNCTION public.claim_settlement_action(p_settlement_id uuid,p_kind text,p_target_cents integer,p_amount_cents integer,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE; o public.payment_orders%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF p_kind='transfer' AND s.kind='group' THEN
  SELECT * INTO o FROM public.payment_orders WHERE id=s.order_id;
  IF NOT EXISTS(SELECT 1 FROM public.group_booking_reservations r JOIN public.video_class_bookings b ON b.reservation_id=r.id
   WHERE r.id=(o.reference->>'reservationId')::uuid AND r.payment_order_id=o.id AND r.buyer_id=s.buyer_id AND r.creator_id=s.creator_id
    AND r.status='confirmed' AND r.refund_status='not_requested' AND b.id=r.booking_id AND b.payment_order_id=o.id AND b.status='confirmed'
    AND b.payment_status='paid' AND b.price_paid_cents=s.gross_cents AND b.stripe_livemode IS NOT DISTINCT FROM s.stripe_livemode
    AND b.refund_status='not_requested') THEN RETURN jsonb_build_object('blocked',true); END IF;
 END IF;
 RETURN public.claim_settlement_action_without_group(p_settlement_id,p_kind,p_target_cents,p_amount_cents,p_lease_token);
END; $$;

CREATE FUNCTION public.cancel_group_class_booking(p_booking_id uuid,p_actor_id uuid)
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
 IF r.occurrence_start<=now() AND p_actor_id IS DISTINCT FROM coach THEN RETURN jsonb_build_object('error','already_started'); END IF;
 IF r.occurrence_start+make_interval(mins=>r.duration_minutes)<=now() THEN RETURN jsonb_build_object('error','already_ended'); END IF;
 UPDATE public.video_class_bookings SET status='cancelled',refund_status=CASE WHEN price_paid_cents>0 THEN 'pending' ELSE 'not_requested' END WHERE id=b.id;
 UPDATE public.group_booking_reservations SET status=CASE WHEN price_cents>0 THEN 'refund_pending' ELSE 'cancelled' END,
  refund_status=CASE WHEN price_cents>0 THEN 'pending' ELSE 'not_requested' END,
  refund_requested_at=CASE WHEN price_cents>0 THEN coalesce(refund_requested_at,now()) ELSE NULL END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('reservation',to_jsonb(r));
END; $$;

CREATE FUNCTION private.protect_group_class_schedule() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.creator_id,NEW.schedule_type,NEW.starts_at,NEW.recurring_weekday,NEW.recurring_time,NEW.duration_minutes,NEW.active)
   IS DISTINCT FROM (OLD.creator_id,OLD.schedule_type,OLD.starts_at,OLD.recurring_weekday,OLD.recurring_time,OLD.duration_minutes,OLD.active) THEN
  IF EXISTS(SELECT 1 FROM public.video_class_occurrences WHERE video_class_id=OLD.id AND starts_at+make_interval(mins=>duration_minutes)>now()) THEN
   RAISE EXCEPTION 'Upcoming group session agreements are frozen. Create a new course with the new schedule.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_group_class_schedule BEFORE UPDATE OR DELETE ON public.video_classes FOR EACH ROW EXECUTE FUNCTION private.protect_group_class_schedule();
REVOKE ALL ON FUNCTION private.protect_group_class_schedule() FROM PUBLIC,anon,authenticated;

-- Public-schema functions are internal APIs, never browser-callable mutations.
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('valid_group_class_occurrence','ensure_group_class_occurrence','group_class_availability','reserve_group_class_booking','bind_group_checkout',
  'fulfill_payment_order','fulfill_payment_order_without_group','claim_settlement_action','claim_settlement_action_without_group','cancel_group_class_booking',
  'protect_group_booking_snapshot','protect_group_reservation_snapshot','protect_group_occurrence_snapshot','protect_group_class_schedule') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
