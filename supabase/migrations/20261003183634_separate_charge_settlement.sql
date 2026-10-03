-- Additive settlement ledger for new platform charges. No historical payment or
-- booking is backfilled, migrated, or reassigned.
ALTER TABLE public.coaching_payment_attempts ADD COLUMN charge_architecture text NOT NULL DEFAULT 'destination'
  CHECK (charge_architecture IN ('destination','separate'));
DROP FUNCTION public.begin_coaching_payment_attempt(uuid,uuid,boolean,timestamptz,uuid,text,integer);
CREATE FUNCTION public.begin_coaching_payment_attempt(
  p_booking_id uuid, p_buyer_id uuid, p_livemode boolean, p_expires_at timestamptz,
  p_replace_attempt_id uuid DEFAULT NULL, p_destination_account_id text DEFAULT NULL,
  p_application_fee_cents integer DEFAULT 0, p_charge_architecture text DEFAULT 'destination'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; attempt_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF b.buyer_id IS DISTINCT FROM p_buyer_id OR p_buyer_id IS NULL THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF b.stripe_livemode IS DISTINCT FROM p_livemode OR p_livemode IS NULL THEN RETURN jsonb_build_object('error', 'mode_mismatch'); END IF;
  IF b.price_cents <= 0 OR b.is_subscription_session OR b.status NOT IN ('pending_payment', 'payment_failed', 'expired', 'reversed')
    OR b.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback') OR b.fulfilled_payment_attempt_id IS NOT NULL
    OR b.refund_status <> 'not_requested' THEN RETURN jsonb_build_object('error', 'not_payable'); END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR b.scheduled_at <= now() THEN RETURN jsonb_build_object('error', 'invalid_expiry'); END IF;
  IF p_charge_architecture NOT IN ('destination', 'separate') OR (p_charge_architecture = 'separate' AND p_destination_account_id IS NULL) THEN RETURN jsonb_build_object('error', 'invalid_connect_snapshot'); END IF;
  IF p_application_fee_cents IS NULL OR p_application_fee_cents < 0 OR p_application_fee_cents > b.price_cents
    OR (p_destination_account_id IS NULL AND p_application_fee_cents <> 0) THEN RETURN jsonb_build_object('error', 'invalid_connect_snapshot'); END IF;
  IF b.current_payment_attempt_id IS NOT NULL THEN
    SELECT * INTO a FROM public.coaching_payment_attempts WHERE id = b.current_payment_attempt_id FOR UPDATE;
    IF a.booking_id IS DISTINCT FROM b.id THEN RAISE EXCEPTION 'Attempt ownership mismatch' USING ERRCODE = '23514'; END IF;
    IF a.provider_state IN ('creating', 'open', 'processing') THEN
      RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'created', false);
    END IF;
    IF a.provider_state NOT IN ('failed', 'expired', 'canceled') OR a.reconciliation_reason IS NOT NULL THEN RETURN jsonb_build_object('error', 'not_payable'); END IF;
    IF p_replace_attempt_id IS DISTINCT FROM a.id THEN RETURN jsonb_build_object('error', 'stale_attempt'); END IF;
  ELSIF p_replace_attempt_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'stale_attempt'); END IF;
  BEGIN
    UPDATE public.bookings SET status = 'pending_payment', payment_status = 'pending', reservation_expires_at = p_expires_at,
      stripe_checkout_session_id = NULL, stripe_payment_intent_id = NULL,
      payment_updated_at = now() WHERE id = b.id RETURNING * INTO b;
  EXCEPTION WHEN exclusion_violation THEN RETURN jsonb_build_object('error', 'slot_unavailable'); END;
  INSERT INTO public.coaching_payment_attempts(id, booking_id, buyer_id, creator_id, price_cents, stripe_livemode,
    destination_account_id, application_fee_cents, reservation_expires_at, checkout_idempotency_key, refund_idempotency_key, charge_architecture)
  VALUES (attempt_id, b.id, b.buyer_id, b.creator_id, b.price_cents, p_livemode, p_destination_account_id,
    p_application_fee_cents, p_expires_at, 'ardore-coaching-checkout-' || attempt_id::text || '-v1',
    'ardore-coaching-reconciliation-' || attempt_id::text || '-v1', p_charge_architecture) RETURNING * INTO a;
  UPDATE public.bookings SET current_payment_attempt_id = a.id WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'created', true);
END;
$$;


CREATE TABLE public.payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('booking','products','subscription')),
 buyer_id uuid NOT NULL,
 creator_id uuid NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
 account_id text,
 gross_cents integer NOT NULL CHECK (gross_cents >= 0),
 platform_fee_cents integer NOT NULL,
 coach_net_cents integer NOT NULL,
 currency text NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
 stripe_livemode boolean NOT NULL,
 reference jsonb NOT NULL CHECK (jsonb_typeof(reference) = 'object'),
 stripe_checkout_session_id text UNIQUE,
 stripe_subscription_id text UNIQUE,
 state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','checkout_created','fulfilled','refund_required','refunded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (platform_fee_cents = floor(gross_cents::numeric / 10 + 0.5)::integer),
 CHECK (coach_net_cents = gross_cents - platform_fee_cents),
 CHECK ((gross_cents > 0 AND account_id ~ '^acct_[A-Za-z0-9]+$') OR (gross_cents = 0 AND kind = 'products'))
);
CREATE TABLE public.payment_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK (kind IN ('booking','products','subscription')),
 buyer_id uuid NOT NULL,
 creator_id uuid NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
 account_id text NOT NULL,
 gross_cents integer NOT NULL CHECK (gross_cents > 0),
 platform_fee_cents integer NOT NULL,
 coach_net_cents integer NOT NULL,
 currency text NOT NULL CHECK (currency = 'eur'),
 stripe_livemode boolean NOT NULL,
 stripe_payment_intent_id text NOT NULL UNIQUE,
 stripe_charge_id text NOT NULL UNIQUE,
 stripe_invoice_id text UNIQUE,
 stripe_checkout_session_id text,
 stripe_subscription_id text,
 cycle_key text NOT NULL,
 state text NOT NULL DEFAULT 'awaiting_fulfillment' CHECK (state IN ('awaiting_fulfillment','pending','held','transferring','settled','reversing','refund_pending','refunded','failed')),
 fulfillment_state text NOT NULL DEFAULT 'awaiting' CHECK (fulfillment_state IN ('awaiting','fulfilled','refund_required','refunded')),
 stripe_transfer_id text UNIQUE,
 transfer_amount_cents integer CHECK (transfer_amount_cents >= 0 AND transfer_amount_cents <= coach_net_cents),
 pretransfer_refunded_cents integer NOT NULL DEFAULT 0 CHECK (pretransfer_refunded_cents >= 0 AND pretransfer_refunded_cents <= gross_cents),
 amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0 AND amount_refunded_cents <= gross_cents),
 refund_requested_cents integer NOT NULL DEFAULT 0 CHECK (refund_requested_cents >= 0 AND refund_requested_cents <= gross_cents),
 amount_reversed_cents integer NOT NULL DEFAULT 0 CHECK (amount_reversed_cents >= 0 AND amount_reversed_cents <= coalesce(transfer_amount_cents,0)),
 transfer_reversal_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transfer_reversal_ids) = 'array'),
 provider_checked_at timestamptz,
 eligibility_checked_at timestamptz,
 last_error_code text,
 lease_token uuid,
 lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,cycle_key),
 CHECK (platform_fee_cents = floor(gross_cents::numeric / 10 + 0.5)::integer),
 CHECK (coach_net_cents = gross_cents - platform_fee_cents)
);
CREATE INDEX payment_settlements_recovery_idx ON public.payment_settlements(creator_id,state,updated_at);
CREATE TABLE public.payment_settlement_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 settlement_id uuid NOT NULL REFERENCES public.payment_settlements(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('transfer','reversal')),
 target_cents integer NOT NULL CHECK (target_cents >= 0),
 amount_cents integer NOT NULL CHECK (amount_cents > 0),
 idempotency_key text NOT NULL UNIQUE,
 stripe_object_id text UNIQUE,
 request_started_at timestamptz NOT NULL DEFAULT now(),
 uncertain boolean NOT NULL DEFAULT false,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(settlement_id,kind,target_cents)
);
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settlement_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_orders,public.payment_settlements,public.payment_settlement_actions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payment_orders,public.payment_settlements,public.payment_settlement_actions TO service_role;

CREATE FUNCTION public.protect_payment_order() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF (NEW.id,NEW.kind,NEW.buyer_id,NEW.creator_id,NEW.account_id,NEW.gross_cents,NEW.platform_fee_cents,NEW.coach_net_cents,NEW.currency,NEW.stripe_livemode,NEW.reference,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.kind,OLD.buyer_id,OLD.creator_id,OLD.account_id,OLD.gross_cents,OLD.platform_fee_cents,OLD.coach_net_cents,OLD.currency,OLD.stripe_livemode,OLD.reference,OLD.created_at)
   OR (OLD.stripe_checkout_session_id IS NOT NULL AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id)
   OR (OLD.stripe_subscription_id IS NOT NULL AND NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id) THEN
  RAISE EXCEPTION 'Immutable order snapshot' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER protect_payment_order BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION public.protect_payment_order();
CREATE FUNCTION public.protect_payment_settlement() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF (NEW.id,NEW.order_id,NEW.kind,NEW.buyer_id,NEW.creator_id,NEW.account_id,NEW.gross_cents,NEW.platform_fee_cents,NEW.coach_net_cents,NEW.currency,NEW.stripe_livemode,NEW.stripe_payment_intent_id,NEW.stripe_charge_id,NEW.stripe_invoice_id,NEW.cycle_key)
  IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.kind,OLD.buyer_id,OLD.creator_id,OLD.account_id,OLD.gross_cents,OLD.platform_fee_cents,OLD.coach_net_cents,OLD.currency,OLD.stripe_livemode,OLD.stripe_payment_intent_id,OLD.stripe_charge_id,OLD.stripe_invoice_id,OLD.cycle_key)
  OR (OLD.stripe_transfer_id IS NOT NULL AND NEW.stripe_transfer_id IS DISTINCT FROM OLD.stripe_transfer_id)
  OR (OLD.transfer_amount_cents IS NOT NULL AND NEW.transfer_amount_cents IS DISTINCT FROM OLD.transfer_amount_cents)
  OR NEW.amount_refunded_cents < OLD.amount_refunded_cents OR NEW.refund_requested_cents < OLD.refund_requested_cents
  OR NEW.amount_reversed_cents < OLD.amount_reversed_cents THEN
   RAISE EXCEPTION 'Immutable settlement snapshot' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER protect_payment_settlement BEFORE UPDATE ON public.payment_settlements FOR EACH ROW EXECUTE FUNCTION public.protect_payment_settlement();

CREATE FUNCTION public.bind_settlement_checkout(p_order_id uuid,p_session_id text,p_subscription_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL OR p_session_id IS NULL OR p_session_id='' THEN RAISE EXCEPTION 'Invalid checkout order'; END IF;
 IF (o.stripe_checkout_session_id IS NOT NULL AND o.stripe_checkout_session_id<>p_session_id)
  OR (o.stripe_subscription_id IS NOT NULL AND p_subscription_id IS NOT NULL AND o.stripe_subscription_id<>p_subscription_id)
  OR (p_subscription_id IS NOT NULL AND o.kind<>'subscription') THEN RAISE EXCEPTION 'Checkout ownership mismatch'; END IF;
 UPDATE public.payment_orders SET stripe_checkout_session_id=p_session_id,
  stripe_subscription_id=coalesce(stripe_subscription_id,p_subscription_id),
  state=CASE WHEN state='created' THEN 'checkout_created' ELSE state END,updated_at=now() WHERE id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o);
END; $$;

CREATE FUNCTION public.record_payment_settlement(p_order_id uuid,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE; s public.payment_settlements%ROWTYPE; gross integer:=(p_snapshot->>'gross_cents')::integer; fee integer; cycle text;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL OR o.account_id IS NULL OR gross<=0 OR (o.kind<>'subscription' AND gross<>o.gross_cents)
  OR (p_snapshot->>'livemode')::boolean IS DISTINCT FROM o.stripe_livemode
  OR p_snapshot->>'currency'<>'eur' OR nullif(p_snapshot->>'payment_intent_id','') IS NULL OR nullif(p_snapshot->>'charge_id','') IS NULL THEN
  RAISE EXCEPTION 'Invalid captured payment snapshot' USING ERRCODE='23514'; END IF;
 cycle:=CASE WHEN o.kind='subscription' THEN p_snapshot->>'invoice_id' ELSE 'payment' END;
 IF cycle IS NULL THEN RAISE EXCEPTION 'Missing subscription cycle'; END IF;
 fee:=floor(gross::numeric/10+0.5)::integer;
 INSERT INTO public.payment_settlements(order_id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,
  currency,stripe_livemode,stripe_payment_intent_id,stripe_charge_id,stripe_invoice_id,stripe_checkout_session_id,stripe_subscription_id,cycle_key)
 VALUES(o.id,o.kind,o.buyer_id,o.creator_id,o.account_id,gross,fee,gross-fee,'eur',o.stripe_livemode,
  p_snapshot->>'payment_intent_id',p_snapshot->>'charge_id',p_snapshot->>'invoice_id',p_snapshot->>'session_id',o.stripe_subscription_id,cycle)
 ON CONFLICT(order_id,cycle_key) DO NOTHING;
 SELECT * INTO s FROM public.payment_settlements WHERE order_id=o.id AND cycle_key=cycle FOR UPDATE;
 IF s.stripe_payment_intent_id IS DISTINCT FROM p_snapshot->>'payment_intent_id' OR s.stripe_charge_id IS DISTINCT FROM p_snapshot->>'charge_id'
  OR s.gross_cents<>gross THEN RAISE EXCEPTION 'Cycle payment identity mismatch'; END IF;
 RETURN to_jsonb(s);
END; $$;

CREATE FUNCTION public.fulfill_payment_order(p_order_id uuid,p_settlement_id uuid DEFAULT NULL,p_period_end timestamptz DEFAULT NULL,p_subscription_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE; s public.payment_settlements%ROWTYPE; item jsonb; newly boolean:=false; new_sub boolean:=false; total integer; b public.bookings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order missing'; END IF;
 IF p_settlement_id IS NOT NULL THEN
  SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id AND order_id=o.id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Settlement missing'; END IF;
  IF s.fulfillment_state='fulfilled' THEN RETURN jsonb_build_object('newly_fulfilled',false); END IF;
  IF s.fulfillment_state IN ('refund_required','refunded') THEN RETURN jsonb_build_object('refund_required',s.fulfillment_state='refund_required','newly_fulfilled',false); END IF;
 ELSE
  IF o.gross_cents<>0 OR o.kind<>'products' THEN RAISE EXCEPTION 'Paid fulfillment requires settlement'; END IF;
  IF o.state='fulfilled' THEN RETURN jsonb_build_object('newly_fulfilled',false); END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.buyer_id::text||':'||o.creator_id::text,0));
 IF o.kind='booking' THEN
  SELECT * INTO b FROM public.bookings WHERE id=(o.reference->>'bookingId')::uuid FOR UPDATE;
  IF b.id IS NULL OR b.buyer_id<>o.buyer_id OR b.creator_id<>o.creator_id OR b.fulfilled_payment_attempt_id IS DISTINCT FROM o.id
   OR b.status NOT IN ('confirmed','completed') OR b.payment_status<>'paid' OR b.refund_status<>'not_requested'
   OR b.stripe_payment_intent_id IS DISTINCT FROM s.stripe_payment_intent_id THEN
    UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending' WHERE id=s.id;
    RETURN jsonb_build_object('refund_required',true,'newly_fulfilled',false);
  END IF;
 ELSIF o.kind='products' THEN
  IF jsonb_typeof(o.reference->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(o.reference->'items')=0 THEN RAISE EXCEPTION 'Invalid product snapshot'; END IF;
  SELECT sum((i->>'amountCents')::integer) INTO total FROM jsonb_array_elements(o.reference->'items') i;
  IF total<>o.gross_cents THEN RAISE EXCEPTION 'Product amount snapshot mismatch'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(o.reference->'items') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=(item->>'productId')::uuid AND creator_id=o.creator_id)
     OR EXISTS(SELECT 1 FROM public.purchases WHERE buyer_id=o.buyer_id AND product_id=(item->>'productId')::uuid
      AND payment_status='paid' AND stripe_payment_intent_id IS DISTINCT FROM s.stripe_payment_intent_id) THEN
    IF s.id IS NOT NULL THEN
     UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending' WHERE id=s.id;
     UPDATE public.payment_orders SET state='refund_required' WHERE id=o.id;
     RETURN jsonb_build_object('refund_required',true,'newly_fulfilled',false);
    ELSE
     UPDATE public.payment_orders SET state='fulfilled' WHERE id=o.id;
     RETURN jsonb_build_object('newly_fulfilled',false);
    END IF;
   END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(o.reference->'items') LOOP
   INSERT INTO public.purchases(buyer_id,product_id,amount_paid,stripe_payment_intent_id,stripe_checkout_session_id,stripe_livemode,payment_status,amount_refunded,withdrawal_consent_at,withdrawal_consent_version)
   VALUES(o.buyer_id,(item->>'productId')::uuid,(item->>'amountCents')::numeric/100,s.stripe_payment_intent_id,o.stripe_checkout_session_id,o.stripe_livemode,'paid',0,
    nullif(o.reference->>'withdrawalConsentAt','')::timestamptz,o.reference->>'withdrawalConsentVersion')
   ON CONFLICT(buyer_id,product_id) DO UPDATE SET amount_paid=excluded.amount_paid,stripe_payment_intent_id=excluded.stripe_payment_intent_id,
    stripe_checkout_session_id=excluded.stripe_checkout_session_id,stripe_livemode=excluded.stripe_livemode,payment_status='paid',amount_refunded=0,
    withdrawal_consent_at=excluded.withdrawal_consent_at,withdrawal_consent_version=excluded.withdrawal_consent_version,updated_at=now();
  END LOOP;
 ELSIF o.kind='subscription' THEN
  IF o.stripe_subscription_id IS NULL OR p_period_end IS NULL OR p_subscription_status NOT IN ('active','past_due','canceled','trialing')
    OR NOT EXISTS(SELECT 1 FROM public.subscription_tiers WHERE id=(o.reference->>'tierId')::uuid AND creator_id=o.creator_id) THEN RAISE EXCEPTION 'Invalid paid subscription cycle'; END IF;
  new_sub:=NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE stripe_subscription_id=o.stripe_subscription_id);
  INSERT INTO public.subscriptions(buyer_id,creator_id,tier_id,stripe_subscription_id,stripe_livemode,status,current_period_end)
  VALUES(o.buyer_id,o.creator_id,(o.reference->>'tierId')::uuid,o.stripe_subscription_id,o.stripe_livemode,p_subscription_status,p_period_end)
  ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=excluded.status,current_period_end=greatest(public.subscriptions.current_period_end,excluded.current_period_end);
 END IF;
 newly:=true;
 UPDATE public.payment_orders SET state='fulfilled',updated_at=now() WHERE id=o.id;
 IF s.id IS NOT NULL THEN UPDATE public.payment_settlements SET fulfillment_state='fulfilled',state='pending',updated_at=now() WHERE id=s.id; END IF;
 RETURN jsonb_build_object('newly_fulfilled',newly,'is_new_subscription',new_sub);
END; $$;

-- A single parent lease serializes transfer/reversal mutations. Action parameters
-- and keys remain durable after the lease is released or the provider times out.
CREATE FUNCTION public.claim_settlement_action(p_settlement_id uuid,p_kind text,p_target_cents integer,p_amount_cents integer,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE; a public.payment_settlement_actions%ROWTYPE; b public.bookings%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF s.id IS NULL OR p_lease_token IS NULL OR p_kind NOT IN ('transfer','reversal') THEN RAISE EXCEPTION 'Invalid settlement action'; END IF;
 IF s.lease_expires_at>now() THEN RETURN jsonb_build_object('busy',true); END IF;
 IF p_kind='transfer' THEN
  IF s.fulfillment_state<>'fulfilled' OR s.refund_requested_cents>s.amount_refunded_cents OR s.amount_refunded_cents=s.gross_cents THEN RETURN jsonb_build_object('blocked',true); END IF;
  IF s.kind='booking' THEN
   SELECT * INTO b FROM public.bookings WHERE id=(SELECT reference->>'bookingId' FROM public.payment_orders WHERE id=s.order_id)::uuid FOR UPDATE;
   IF b.id IS NULL OR b.buyer_id IS DISTINCT FROM s.buyer_id OR b.creator_id IS DISTINCT FROM s.creator_id
    OR b.fulfilled_payment_attempt_id IS DISTINCT FROM s.order_id OR b.stripe_payment_intent_id IS DISTINCT FROM s.stripe_payment_intent_id
    OR b.price_cents IS DISTINCT FROM s.gross_cents OR b.payment_status<>'paid'
    OR b.status NOT IN ('confirmed','completed') OR b.refund_status<>'not_requested' THEN RETURN jsonb_build_object('blocked',true); END IF;
  END IF;
  IF s.stripe_transfer_id IS NOT NULL THEN RETURN jsonb_build_object('done',true); END IF;
  IF p_target_cents<>0 OR p_amount_cents<>s.coach_net_cents-floor(s.coach_net_cents::numeric*s.amount_refunded_cents/s.gross_cents)::integer THEN RAISE EXCEPTION 'Transfer amount mismatch'; END IF;
 ELSIF s.stripe_transfer_id IS NULL OR p_target_cents>s.transfer_amount_cents OR p_target_cents<s.amount_reversed_cents
  OR p_amount_cents<>p_target_cents-s.amount_reversed_cents THEN RAISE EXCEPTION 'Reversal amount mismatch'; END IF;
 INSERT INTO public.payment_settlement_actions(settlement_id,kind,target_cents,amount_cents,idempotency_key)
 VALUES(s.id,p_kind,p_target_cents,p_amount_cents,CASE WHEN p_kind='transfer' THEN 'ardore-settlement-'||s.id||'-transfer-v1' ELSE 'ardore-settlement-'||s.id||'-reverse-'||p_target_cents||'-v1' END)
 ON CONFLICT(settlement_id,kind,target_cents) DO NOTHING;
 SELECT * INTO a FROM public.payment_settlement_actions WHERE settlement_id=s.id AND kind=p_kind AND target_cents=p_target_cents FOR UPDATE;
 IF a.amount_cents<>p_amount_cents THEN RAISE EXCEPTION 'Frozen action amount mismatch'; END IF;
 IF a.stripe_object_id IS NOT NULL THEN RETURN jsonb_build_object('done',true,'action',to_jsonb(a)); END IF;
 UPDATE public.payment_settlements SET lease_token=p_lease_token,lease_expires_at=now()+interval '5 minutes',
  transfer_amount_cents=CASE WHEN p_kind='transfer' THEN coalesce(transfer_amount_cents,a.amount_cents) ELSE transfer_amount_cents END,
  pretransfer_refunded_cents=CASE WHEN p_kind='transfer' AND transfer_amount_cents IS NULL THEN amount_refunded_cents ELSE pretransfer_refunded_cents END,
  state=CASE WHEN p_kind='transfer' THEN 'transferring' ELSE 'reversing' END,updated_at=now() WHERE id=s.id;
 RETURN jsonb_build_object('action',to_jsonb(a),'settlement',to_jsonb(s));
END; $$;

CREATE FUNCTION public.finish_settlement_action(p_settlement_id uuid,p_action_id uuid,p_lease_token uuid,p_object_id text DEFAULT NULL,p_uncertain boolean DEFAULT false,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE; a public.payment_settlement_actions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF s.lease_token IS DISTINCT FROM p_lease_token THEN RETURN false; END IF;
 SELECT * INTO a FROM public.payment_settlement_actions WHERE id=p_action_id AND settlement_id=s.id FOR UPDATE;
 IF a.id IS NULL OR (a.stripe_object_id IS NOT NULL AND p_object_id IS DISTINCT FROM a.stripe_object_id) THEN RAISE EXCEPTION 'Action identity mismatch'; END IF;
 UPDATE public.payment_settlement_actions SET stripe_object_id=coalesce(stripe_object_id,p_object_id),uncertain=p_uncertain,last_error_code=p_error_code WHERE id=a.id;
 UPDATE public.payment_settlements SET
  stripe_transfer_id=CASE WHEN a.kind='transfer' THEN coalesce(stripe_transfer_id,p_object_id) ELSE stripe_transfer_id END,
  transfer_reversal_ids=CASE WHEN a.kind='reversal' AND p_object_id IS NOT NULL AND NOT transfer_reversal_ids ? p_object_id THEN transfer_reversal_ids||jsonb_build_array(p_object_id) ELSE transfer_reversal_ids END,
  amount_reversed_cents=CASE WHEN a.kind='reversal' AND p_object_id IS NOT NULL THEN greatest(amount_reversed_cents,a.target_cents) ELSE amount_reversed_cents END,
  state=CASE WHEN p_object_id IS NULL THEN 'failed' WHEN a.kind='transfer' THEN 'settled' ELSE 'refund_pending' END,
  last_error_code=p_error_code,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=s.id;
 RETURN true;
END; $$;

CREATE FUNCTION public.request_settlement_refund(p_settlement_id uuid,p_target_cents integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF s.id IS NULL OR p_target_cents<0 OR p_target_cents>s.gross_cents THEN RAISE EXCEPTION 'Invalid refund target'; END IF;
 UPDATE public.payment_settlements SET refund_requested_cents=greatest(refund_requested_cents,p_target_cents),
  state=CASE WHEN state='refunded' THEN state ELSE 'refund_pending' END,updated_at=now() WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END; $$;

CREATE FUNCTION public.observe_payment_settlement(p_settlement_id uuid,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE; refunded integer:=(p_snapshot->>'refunded_cents')::integer; reversed integer:=(p_snapshot->>'reversed_cents')::integer;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF s.id IS NULL OR refunded<0 OR refunded>s.gross_cents OR reversed<0 OR reversed>coalesce(s.transfer_amount_cents,0) THEN RAISE EXCEPTION 'Invalid settlement observation'; END IF;
 IF s.provider_checked_at>(p_snapshot->>'checked_at')::timestamptz THEN RETURN to_jsonb(s); END IF;
 UPDATE public.payment_settlements SET amount_refunded_cents=greatest(amount_refunded_cents,refunded),
  amount_reversed_cents=greatest(amount_reversed_cents,reversed),
  transfer_reversal_ids=coalesce(p_snapshot->'reversal_ids',transfer_reversal_ids),provider_checked_at=(p_snapshot->>'checked_at')::timestamptz,
  state=CASE WHEN refunded=gross_cents AND
    ((stripe_transfer_id IS NOT NULL AND reversed=coalesce(transfer_amount_cents,0)) OR
      (stripe_transfer_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.payment_settlement_actions pa
        WHERE pa.settlement_id=s.id AND pa.kind='transfer' AND pa.uncertain))) THEN 'refunded'
    WHEN refund_requested_cents>refunded THEN 'refund_pending' WHEN lease_expires_at>now() THEN state
    WHEN stripe_transfer_id IS NOT NULL THEN 'settled' ELSE state END,
  fulfillment_state=CASE WHEN refunded=gross_cents THEN 'refunded' ELSE fulfillment_state END,
  eligibility_checked_at=coalesce((p_snapshot->>'eligibility_checked_at')::timestamptz,eligibility_checked_at),
  last_error_code=CASE WHEN p_snapshot ? 'error_code' THEN p_snapshot->>'error_code' ELSE last_error_code END,
  updated_at=now() WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END; $$;

-- Protect authority tables and every settlement RPC against client execution.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('begin_coaching_payment_attempt','bind_settlement_checkout','record_payment_settlement','fulfill_payment_order','claim_settlement_action','finish_settlement_action','request_settlement_refund','observe_payment_settlement','protect_payment_order','protect_payment_settlement') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fn.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn.signature||' TO service_role';
 END LOOP;
END $$;
