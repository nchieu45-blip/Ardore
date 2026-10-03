-- Additive lifecycle bookkeeping. Historical bookings and event claims are
-- deliberately not backfilled or rewritten.
ALTER TABLE public.bookings
  ADD COLUMN current_payment_attempt_id uuid,
  ADD COLUMN fulfilled_payment_attempt_id uuid,
  ADD COLUMN booking_request_key uuid;
CREATE UNIQUE INDEX bookings_buyer_request_key_uidx
  ON public.bookings (buyer_id, booking_request_key)
  WHERE booking_request_key IS NOT NULL;

CREATE TABLE public.coaching_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  buyer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creator_id uuid NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  stripe_livemode boolean NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  checkout_url text,
  checkout_idempotency_key text NOT NULL UNIQUE,
  refund_idempotency_key text NOT NULL UNIQUE,
  legacy_checkout boolean NOT NULL DEFAULT false,
  destination_account_id text,
  application_fee_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_cents >= 0 AND application_fee_cents <= price_cents),
  reservation_expires_at timestamptz NOT NULL,
  provider_state text NOT NULL DEFAULT 'creating' CHECK (provider_state IN ('creating', 'open', 'processing', 'paid', 'failed', 'expired', 'canceled')),
  provider_checked_at timestamptz,
  provider_error_code text,
  fulfillment_state text NOT NULL DEFAULT 'not_fulfilled' CHECK (fulfillment_state IN ('not_fulfilled', 'paid_confirmed', 'reconciliation_pending', 'reconciled')),
  reconciliation_reason text CHECK (reconciliation_reason IN ('slot_unavailable', 'appointment_elapsed', 'booking_cancelled', 'duplicate_payment', 'payment_already_refunded')),
  amount_paid_cents integer CHECK (amount_paid_cents >= 0 AND amount_paid_cents <= price_cents),
  amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0 AND amount_refunded_cents <= price_cents),
  refund_status text NOT NULL DEFAULT 'not_requested' CHECK (refund_status IN ('not_requested', 'pending', 'succeeded', 'failed')),
  refund_amount_cents integer CHECK (refund_amount_cents > 0 AND refund_amount_cents <= price_cents),
  stripe_refund_id text UNIQUE,
  stripe_transfer_id text,
  transfer_reversal_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transfer_reversal_ids) = 'array'),
  application_fee_refund_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(application_fee_refund_ids) = 'array'),
  transfer_status text NOT NULL DEFAULT 'not_required' CHECK (transfer_status IN ('not_required', 'pending', 'succeeded', 'failed')),
  processing_fee_cents integer CHECK (processing_fee_cents >= 0),
  processing_fee_cost_owner text NOT NULL DEFAULT 'platform' CHECK (processing_fee_cost_owner = 'platform'),
  processing_fee_accounting_status text NOT NULL DEFAULT 'pending' CHECK (processing_fee_accounting_status IN ('pending', 'recorded')),
  last_error_code text,
  refund_provider_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_paid_cents IS NULL OR amount_refunded_cents <= amount_paid_cents),
  CHECK ((fulfillment_state NOT IN ('reconciliation_pending', 'reconciled')) OR reconciliation_reason IS NOT NULL),
  CHECK ((refund_status = 'not_requested') OR reconciliation_reason IS NOT NULL)
);
CREATE INDEX coaching_payment_attempts_booking_idx ON public.coaching_payment_attempts(booking_id, created_at);
CREATE INDEX coaching_payment_attempts_reconcile_idx ON public.coaching_payment_attempts(updated_at)
  WHERE fulfillment_state = 'reconciliation_pending';
CREATE INDEX coaching_payment_attempts_reservation_idx ON public.coaching_payment_attempts(reservation_expires_at)
  WHERE provider_state IN ('creating', 'open', 'processing');
ALTER TABLE public.coaching_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coaching_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.coaching_payment_attempts TO service_role;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_current_payment_attempt_fk FOREIGN KEY (current_payment_attempt_id) REFERENCES public.coaching_payment_attempts(id) ON DELETE SET NULL,
  ADD CONSTRAINT bookings_fulfilled_payment_attempt_fk FOREIGN KEY (fulfilled_payment_attempt_id) REFERENCES public.coaching_payment_attempts(id) ON DELETE SET NULL;

CREATE FUNCTION public.begin_coaching_payment_attempt(
  p_booking_id uuid, p_buyer_id uuid, p_livemode boolean, p_expires_at timestamptz,
  p_replace_attempt_id uuid DEFAULT NULL, p_destination_account_id text DEFAULT NULL,
  p_application_fee_cents integer DEFAULT 0
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
    destination_account_id, application_fee_cents, reservation_expires_at, checkout_idempotency_key, refund_idempotency_key)
  VALUES (attempt_id, b.id, b.buyer_id, b.creator_id, b.price_cents, p_livemode, p_destination_account_id,
    p_application_fee_cents, p_expires_at, 'ardore-coaching-checkout-' || attempt_id::text || '-v1',
    'ardore-coaching-reconciliation-' || attempt_id::text || '-v1') RETURNING * INTO a;
  UPDATE public.bookings SET current_payment_attempt_id = a.id WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'created', true);
END;
$$;

CREATE FUNCTION public.register_coaching_checkout(p_attempt_id uuid, p_session_id text, p_session_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; booking_id uuid;
BEGIN
  SELECT ca.booking_id INTO booking_id FROM public.coaching_payment_attempts ca WHERE ca.id = p_attempt_id;
  SELECT * INTO b FROM public.bookings WHERE id = booking_id FOR UPDATE;
  SELECT * INTO a FROM public.coaching_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Attempt missing'; END IF;
  IF p_session_id IS NULL OR p_session_id = '' OR (a.stripe_checkout_session_id IS NOT NULL AND a.stripe_checkout_session_id <> p_session_id) THEN
    RAISE EXCEPTION 'Checkout binding mismatch' USING ERRCODE = '23514'; END IF;
  UPDATE public.coaching_payment_attempts SET stripe_checkout_session_id = p_session_id,
    checkout_url = coalesce(checkout_url, p_session_url), provider_state = CASE WHEN provider_state = 'creating' THEN 'open' ELSE provider_state END,
    updated_at = now() WHERE id = a.id RETURNING * INTO a;
  IF b.current_payment_attempt_id = a.id AND b.fulfilled_payment_attempt_id IS NULL THEN
    UPDATE public.bookings SET stripe_checkout_session_id = p_session_id WHERE id = b.id RETURNING * INTO b;
  END IF;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'registered', true);
END;
$$;

CREATE FUNCTION public.register_legacy_coaching_payment_attempt(
  p_booking_id uuid, p_session_id text, p_livemode boolean,
  p_destination_account_id text DEFAULT NULL, p_application_fee_cents integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; attempt_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.stripe_checkout_session_id IS DISTINCT FROM p_session_id OR p_session_id IS NULL
    OR b.stripe_livemode IS DISTINCT FROM p_livemode OR p_livemode IS NULL OR b.price_cents <= 0 OR b.is_subscription_session THEN
    RAISE EXCEPTION 'Legacy checkout does not match booking' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM public.coaching_payment_attempts WHERE stripe_checkout_session_id = p_session_id FOR UPDATE;
  IF FOUND THEN
    IF a.booking_id <> b.id THEN RAISE EXCEPTION 'Attempt ownership mismatch' USING ERRCODE = '23514'; END IF;
    RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'created', false);
  END IF;
  IF b.current_payment_attempt_id IS NOT NULL THEN RAISE EXCEPTION 'Legacy checkout has been replaced' USING ERRCODE = '23514'; END IF;
  IF p_application_fee_cents IS NULL OR p_application_fee_cents < 0 OR p_application_fee_cents > b.price_cents
    OR (p_destination_account_id IS NULL AND p_application_fee_cents <> 0) THEN RAISE EXCEPTION 'Invalid Connect snapshot' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.coaching_payment_attempts(id, booking_id, buyer_id, creator_id, price_cents, stripe_livemode,
    stripe_checkout_session_id, stripe_payment_intent_id, legacy_checkout, destination_account_id, application_fee_cents,
    reservation_expires_at, checkout_idempotency_key, refund_idempotency_key)
  VALUES (attempt_id, b.id, b.buyer_id, b.creator_id, b.price_cents, p_livemode, p_session_id, b.stripe_payment_intent_id,
    true, p_destination_account_id, p_application_fee_cents, coalesce(b.reservation_expires_at, now()),
    'ardore-coaching-checkout-' || attempt_id::text || '-v1', 'ardore-coaching-reconciliation-' || attempt_id::text || '-v1') RETURNING * INTO a;
  UPDATE public.bookings SET current_payment_attempt_id = a.id,
    fulfilled_payment_attempt_id = CASE WHEN payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback') AND stripe_payment_intent_id IS NOT NULL THEN a.id ELSE NULL END
    WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'created', true);
END;
$$;

CREATE FUNCTION public.fail_coaching_checkout_creation(p_attempt_id uuid, p_error_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; booking_id uuid;
BEGIN
  SELECT ca.booking_id INTO booking_id FROM public.coaching_payment_attempts ca WHERE ca.id = p_attempt_id;
  SELECT * INTO b FROM public.bookings WHERE id = booking_id FOR UPDATE;
  SELECT * INTO a FROM public.coaching_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Attempt missing'; END IF;
  IF a.provider_state = 'creating' AND a.stripe_checkout_session_id IS NULL THEN
    UPDATE public.coaching_payment_attempts SET provider_state = 'failed', provider_error_code = left(p_error_code, 80),
      provider_checked_at = now(), updated_at = now() WHERE id = a.id RETURNING * INTO a;
    IF b.current_payment_attempt_id = a.id AND b.fulfilled_payment_attempt_id IS NULL AND b.status = 'pending_payment' THEN
      UPDATE public.bookings SET status = 'payment_failed', payment_status = 'failed', payment_updated_at = now() WHERE id = b.id RETURNING * INTO b;
    END IF;
  END IF;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a));
END;
$$;

CREATE FUNCTION public.observe_coaching_payment_attempt(p_attempt_id uuid, p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; booking_id uuid;
  observed_at timestamptz := (p_observation->>'provider_checked_at')::timestamptz;
  observed_state text := p_observation->>'provider_state';
  paid_amount integer := (p_observation->>'amount_paid_cents')::integer;
  refunded_amount integer := coalesce((p_observation->>'amount_refunded_cents')::integer, 0);
  intent_id text := nullif(p_observation->>'payment_intent_id', '');
  session_id text := p_observation->>'session_id';
  reason text; newly_confirmed boolean := false;
BEGIN
  SELECT ca.booking_id INTO booking_id FROM public.coaching_payment_attempts ca WHERE ca.id = p_attempt_id;
  SELECT * INTO b FROM public.bookings WHERE id = booking_id FOR UPDATE;
  SELECT * INTO a FROM public.coaching_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Attempt missing'; END IF;
  IF p_observation->>'booking_id' IS DISTINCT FROM b.id::text OR p_observation->>'buyer_id' IS DISTINCT FROM a.buyer_id::text
    OR p_observation->>'creator_id' IS DISTINCT FROM a.creator_id::text OR (p_observation->>'livemode')::boolean IS DISTINCT FROM a.stripe_livemode
    OR p_observation->>'currency' IS DISTINCT FROM 'eur' OR (p_observation->>'amount_total')::integer IS DISTINCT FROM a.price_cents
    OR session_id IS NULL OR session_id = '' OR (a.stripe_checkout_session_id IS NOT NULL AND session_id <> a.stripe_checkout_session_id)
    OR (a.stripe_payment_intent_id IS NOT NULL AND intent_id IS DISTINCT FROM a.stripe_payment_intent_id)
    OR observed_at IS NULL OR observed_state IS NULL OR observed_state NOT IN ('open', 'processing', 'paid', 'failed', 'expired', 'canceled') THEN
    RAISE EXCEPTION 'Provider observation does not match attempt' USING ERRCODE = '23514'; END IF;
  IF observed_state = 'paid' AND (intent_id IS NULL OR paid_amount IS DISTINCT FROM a.price_cents OR refunded_amount < 0 OR refunded_amount > paid_amount) THEN
    RAISE EXCEPTION 'Invalid captured payment' USING ERRCODE = '23514'; END IF;
  IF (a.provider_checked_at IS NOT NULL AND observed_at < a.provider_checked_at) OR (a.provider_state = 'paid' AND observed_state <> 'paid') THEN
    RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'applied', false, 'newly_confirmed', false,
      'needs_reconciliation', a.fulfillment_state = 'reconciliation_pending');
  END IF;
  UPDATE public.coaching_payment_attempts SET stripe_checkout_session_id = session_id,
    stripe_payment_intent_id = coalesce(stripe_payment_intent_id, intent_id), provider_state = observed_state,
    provider_checked_at = observed_at, provider_error_code = coalesce(p_observation->>'provider_error_code', p_observation->>'last_error_code'),
    updated_at = now() WHERE id = a.id RETURNING * INTO a;
  IF observed_state = 'paid' THEN
    IF a.amount_paid_cents IS NOT NULL AND a.amount_paid_cents <> paid_amount THEN RAISE EXCEPTION 'Captured amount changed' USING ERRCODE = '23514'; END IF;
    UPDATE public.coaching_payment_attempts SET amount_paid_cents = paid_amount,
      amount_refunded_cents = greatest(amount_refunded_cents, refunded_amount) WHERE id = a.id RETURNING * INTO a;
    IF a.reconciliation_reason IS NOT NULL THEN
      RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'applied', true, 'newly_confirmed', false,
        'needs_reconciliation', a.fulfillment_state = 'reconciliation_pending');
    END IF;
    IF b.fulfilled_payment_attempt_id = a.id OR (b.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback') AND b.stripe_payment_intent_id = intent_id) THEN
      UPDATE public.coaching_payment_attempts SET fulfillment_state = 'paid_confirmed' WHERE id = a.id RETURNING * INTO a;
      RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'applied', true, 'newly_confirmed', false, 'needs_reconciliation', false);
    END IF;
    IF b.fulfilled_payment_attempt_id IS NOT NULL OR (b.stripe_payment_intent_id IS NOT NULL AND b.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback')) THEN reason := 'duplicate_payment';
    ELSIF b.status IN ('cancelled', 'completed', 'refunded') OR b.refund_status <> 'not_requested' THEN reason := 'booking_cancelled';
    ELSIF refunded_amount > 0 OR p_observation->>'force_reconciliation_reason' = 'payment_already_refunded' THEN reason := 'payment_already_refunded';
    ELSIF b.scheduled_at <= now() THEN reason := 'appointment_elapsed';
    ELSE
      BEGIN
        UPDATE public.bookings SET status = 'confirmed', payment_status = 'paid', stripe_checkout_session_id = session_id,
          stripe_payment_intent_id = intent_id, stripe_livemode = a.stripe_livemode, amount_paid_cents = paid_amount,
          paid_at = coalesce(paid_at, now()), payment_updated_at = now(), fulfilled_payment_attempt_id = a.id
          WHERE id = b.id RETURNING * INTO b;
        IF b.discount_id IS NOT NULL AND b.discount_redeemed_at IS NULL THEN
          UPDATE public.discounts SET redemption_count = redemption_count + 1 WHERE id = b.discount_id;
          IF FOUND THEN
            UPDATE public.bookings SET discount_redeemed_at = now() WHERE id = b.id RETURNING * INTO b;
          END IF;
        END IF;
        newly_confirmed := true;
      EXCEPTION WHEN exclusion_violation THEN reason := 'slot_unavailable'; END;
    END IF;
    IF reason IS NULL THEN
      UPDATE public.coaching_payment_attempts SET fulfillment_state = 'paid_confirmed' WHERE id = a.id RETURNING * INTO a;
    ELSE
      UPDATE public.coaching_payment_attempts SET fulfillment_state = 'reconciliation_pending', reconciliation_reason = reason,
        refund_status = 'pending', updated_at = now() WHERE id = a.id RETURNING * INTO a;
      -- A losing payment never changes the payment/refund fields of a winner.
      IF b.status <> 'completed' AND b.fulfilled_payment_attempt_id IS NULL AND b.payment_status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback')
        AND b.refund_status = 'not_requested' AND NOT EXISTS (SELECT 1 FROM public.booking_refunds br WHERE br.booking_id = b.id) THEN
        UPDATE public.bookings SET status = CASE WHEN status IN ('cancelled', 'completed') THEN status ELSE 'expired' END,
          payment_status = 'paid', stripe_payment_intent_id = intent_id, stripe_checkout_session_id = session_id,
          amount_paid_cents = paid_amount, refund_status = 'pending', paid_at = coalesce(paid_at, now()), payment_updated_at = now()
          WHERE id = b.id RETURNING * INTO b;
      END IF;
    END IF;
  ELSIF b.current_payment_attempt_id = a.id AND b.fulfilled_payment_attempt_id IS NULL
    AND b.status IN ('pending_payment', 'payment_failed', 'expired', 'reversed') AND b.refund_status = 'not_requested'
    AND b.payment_status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback') THEN
    IF observed_state IN ('open', 'processing') THEN
      BEGIN
        UPDATE public.bookings SET status = 'pending_payment',
          payment_status = CASE WHEN observed_state = 'open' AND a.provider_error_code IS NOT NULL THEN 'failed' ELSE 'pending' END,
          stripe_payment_intent_id = coalesce(stripe_payment_intent_id, intent_id), stripe_checkout_session_id = session_id,
          payment_updated_at = now() WHERE id = b.id RETURNING * INTO b;
      EXCEPTION WHEN exclusion_violation THEN NULL; END;
    ELSE
      UPDATE public.bookings SET status = CASE WHEN observed_state = 'expired' THEN 'expired' ELSE 'payment_failed' END,
        payment_status = CASE WHEN observed_state = 'expired' THEN 'expired' WHEN observed_state = 'canceled' THEN 'reversed' ELSE 'failed' END,
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, intent_id), stripe_checkout_session_id = session_id,
        payment_updated_at = now() WHERE id = b.id RETURNING * INTO b;
    END IF;
  END IF;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'attempt', to_jsonb(a), 'applied', true,
    'newly_confirmed', newly_confirmed, 'needs_reconciliation', a.fulfillment_state = 'reconciliation_pending');
END;
$$;

CREATE FUNCTION public.apply_coaching_attempt_refund_state(
  p_attempt_id uuid, p_state jsonb, p_payment_status text,
  p_amount_refunded_cents integer, p_amount_paid_cents integer, p_provider_checked_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; a public.coaching_payment_attempts%ROWTYPE; booking_id uuid; actual_paid integer; refunded integer; applied boolean := true; payment_shadow jsonb; refund_shadow jsonb;
BEGIN
  SELECT ca.booking_id INTO booking_id FROM public.coaching_payment_attempts ca WHERE ca.id = p_attempt_id;
  SELECT * INTO b FROM public.bookings WHERE id = booking_id FOR UPDATE;
  SELECT * INTO a FROM public.coaching_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL OR a.reconciliation_reason IS NULL OR a.fulfillment_state NOT IN ('reconciliation_pending', 'reconciled')
    OR a.provider_state <> 'paid' OR a.stripe_payment_intent_id IS NULL OR b.fulfilled_payment_attempt_id = a.id
    OR (b.stripe_payment_intent_id = a.stripe_payment_intent_id AND b.status IN ('confirmed', 'completed')
      AND b.payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback')) THEN
    RAISE EXCEPTION 'Payment reconciliation not claimed' USING ERRCODE = '23514'; END IF;
  IF p_provider_checked_at IS NULL OR (a.refund_provider_checked_at IS NOT NULL AND p_provider_checked_at < a.refund_provider_checked_at)
    OR (p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL AND a.refund_status = 'succeeded') THEN applied := false;
  ELSE
    actual_paid := coalesce(p_amount_paid_cents, a.amount_paid_cents);
    refunded := coalesce(p_amount_refunded_cents, a.amount_refunded_cents);
    IF actual_paid IS NULL OR actual_paid < 0 OR actual_paid > a.price_cents OR refunded < 0 OR refunded > actual_paid
      OR (a.amount_paid_cents IS NOT NULL AND p_amount_paid_cents IS NOT NULL AND a.amount_paid_cents <> p_amount_paid_cents)
      OR (a.refund_amount_cents IS NOT NULL AND p_state->>'amount_cents' IS NOT NULL AND a.refund_amount_cents <> (p_state->>'amount_cents')::integer)
      OR coalesce((p_state->>'amount_cents')::integer, a.refund_amount_cents, 0) > actual_paid
      OR (p_state->>'stripe_refund_id' IS NOT NULL AND a.stripe_refund_id IS NOT NULL AND a.stripe_refund_id <> p_state->>'stripe_refund_id') THEN
      RAISE EXCEPTION 'Invalid reconciliation amount or refund binding' USING ERRCODE = '23514'; END IF;
    IF p_payment_status = 'refunded' AND refunded <> actual_paid THEN RAISE EXCEPTION 'Refund not complete' USING ERRCODE = '23514'; END IF;
    UPDATE public.coaching_payment_attempts SET amount_paid_cents = actual_paid, amount_refunded_cents = refunded,
      refund_status = coalesce(p_state->>'state', refund_status),
      refund_amount_cents = coalesce(refund_amount_cents, (p_state->>'amount_cents')::integer),
      stripe_refund_id = coalesce(stripe_refund_id, p_state->>'stripe_refund_id'),
      stripe_transfer_id = coalesce(p_state->>'stripe_transfer_id', stripe_transfer_id),
      transfer_reversal_ids = coalesce(p_state->'transfer_reversal_ids', transfer_reversal_ids),
      application_fee_refund_ids = coalesce(p_state->'application_fee_refund_ids', application_fee_refund_ids),
      transfer_status = coalesce(p_state->>'transfer_status', transfer_status),
      processing_fee_cents = coalesce((p_state->>'processing_fee_cents')::integer, processing_fee_cents),
      processing_fee_accounting_status = coalesce(p_state->>'processing_fee_accounting_status', processing_fee_accounting_status),
      last_error_code = CASE WHEN p_state ? 'last_error_code' THEN p_state->>'last_error_code' ELSE last_error_code END,
      fulfillment_state = CASE WHEN p_state->>'state' = 'succeeded' AND refunded = actual_paid THEN 'reconciled' ELSE fulfillment_state END,
      refund_provider_checked_at = CASE WHEN p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL THEN refund_provider_checked_at ELSE p_provider_checked_at END,
      updated_at = now() WHERE id = a.id RETURNING * INTO a;
    IF b.fulfilled_payment_attempt_id IS NULL AND b.stripe_payment_intent_id = a.stripe_payment_intent_id
      AND b.status NOT IN ('confirmed', 'completed') AND NOT EXISTS (SELECT 1 FROM public.booking_refunds br WHERE br.booking_id = b.id) THEN
      UPDATE public.bookings SET amount_paid_cents = a.amount_paid_cents, amount_refunded_cents = a.amount_refunded_cents,
        refund_status = a.refund_status,
        payment_status = CASE WHEN p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL THEN payment_status ELSE coalesce(p_payment_status, payment_status) END,
        status = CASE WHEN p_payment_status = 'refunded' AND status <> 'cancelled' THEN 'refunded' ELSE status END,
        payment_updated_at = now() WHERE id = b.id RETURNING * INTO b;
    END IF;
  END IF;
  payment_shadow := to_jsonb(b) || jsonb_build_object('stripe_payment_intent_id', a.stripe_payment_intent_id,
    'stripe_livemode', a.stripe_livemode, 'price_cents', a.price_cents, 'amount_paid_cents', a.amount_paid_cents,
    'amount_refunded_cents', a.amount_refunded_cents, 'status', 'cancelled',
    'payment_status', CASE WHEN a.amount_paid_cents = a.amount_refunded_cents THEN 'refunded' WHEN a.amount_refunded_cents > 0 THEN 'partially_refunded' ELSE 'paid' END);
  refund_shadow := to_jsonb(a) || jsonb_build_object('booking_id', a.booking_id, 'actor_role', 'system', 'actor_user_id', NULL,
    'state', a.refund_status, 'amount_cents', a.refund_amount_cents);
  RETURN jsonb_build_object('booking', payment_shadow, 'attempt', to_jsonb(a), 'refund', refund_shadow, 'applied', applied);
END;
$$;

-- Existing completed claims retain the completed default. A new claim is
-- explicitly processing, and a crashed worker can be reclaimed after its lease.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN processing_state text NOT NULL DEFAULT 'completed' CHECK (processing_state IN ('processing', 'completed')),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz;
CREATE FUNCTION public.claim_stripe_webhook_event(p_event_id text, p_event_type text, p_livemode boolean, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.stripe_webhook_events%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR p_event_type IS NULL OR p_livemode IS NULL OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Invalid event claim'; END IF;
  INSERT INTO public.stripe_webhook_events(event_id, event_type, livemode, processing_state, lease_token, lease_expires_at)
  VALUES (p_event_id, p_event_type, p_livemode, 'processing', p_lease_token, now() + interval '5 minutes') ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO e FROM public.stripe_webhook_events WHERE event_id = p_event_id FOR UPDATE;
  IF e.event_type <> p_event_type OR e.livemode <> p_livemode THEN RAISE EXCEPTION 'Event identity mismatch' USING ERRCODE = '23514'; END IF;
  IF e.processing_state = 'completed' THEN RETURN jsonb_build_object('claimed', false, 'processed', true, 'busy', false); END IF;
  IF e.lease_token = p_lease_token THEN RETURN jsonb_build_object('claimed', true, 'processed', false, 'busy', false); END IF;
  IF e.lease_expires_at IS NULL OR e.lease_expires_at <= now() THEN
    UPDATE public.stripe_webhook_events SET lease_token = p_lease_token, lease_expires_at = now() + interval '5 minutes' WHERE event_id = p_event_id;
    RETURN jsonb_build_object('claimed', true, 'processed', false, 'busy', false);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'processed', false, 'busy', true);
END;
$$;
CREATE FUNCTION public.complete_stripe_webhook_event(p_event_id text, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.stripe_webhook_events SET processing_state = 'completed', processed_at = now(), lease_token = NULL, lease_expires_at = NULL
    WHERE event_id = p_event_id AND lease_token = p_lease_token AND processing_state = 'processing';
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.release_stripe_webhook_event(p_event_id text, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.stripe_webhook_events SET lease_token = NULL, lease_expires_at = now()
    WHERE event_id = p_event_id AND lease_token = p_lease_token AND processing_state = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_coaching_payment_attempt(uuid,uuid,boolean,timestamptz,uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_coaching_checkout(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_legacy_coaching_payment_attempt(uuid,text,boolean,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_coaching_checkout_creation(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.observe_coaching_payment_attempt(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_coaching_attempt_refund_state(uuid,jsonb,text,integer,integer,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stripe_webhook_event(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_coaching_payment_attempt(uuid,uuid,boolean,timestamptz,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_coaching_checkout(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_legacy_coaching_payment_attempt(uuid,text,boolean,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_coaching_checkout_creation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.observe_coaching_payment_attempt(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_coaching_attempt_refund_state(uuid,jsonb,text,integer,integer,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stripe_webhook_event(text,uuid) TO service_role;
