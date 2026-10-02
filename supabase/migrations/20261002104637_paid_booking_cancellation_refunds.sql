-- Historical bookings have no recorded agreement; deliberately do not infer
-- their cutoff from an offer that may have changed since purchase.
ALTER TABLE public.bookings
  ADD COLUMN cancellation_policy_hours integer CHECK (cancellation_policy_hours BETWEEN 0 AND 168),
  ADD COLUMN amount_paid_cents integer CHECK (amount_paid_cents >= 0 AND amount_paid_cents <= price_cents),
  ADD COLUMN refund_status text NOT NULL DEFAULT 'not_requested'
    CHECK (refund_status IN ('not_requested', 'pending', 'succeeded', 'failed')),
  ADD COLUMN refund_provider_checked_at timestamptz;

CREATE FUNCTION public.snapshot_booking_cancellation_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE agreed_hours integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(o.cancellation_policy_hours, 24)
      INTO agreed_hours
      FROM public.coaching_offers o WHERE o.creator_id = NEW.creator_id FOR SHARE;
    agreed_hours := coalesce(agreed_hours, 24);
    IF NEW.cancellation_policy_hours IS NOT NULL AND NEW.cancellation_policy_hours <> agreed_hours THEN
      RAISE EXCEPTION 'Cancellation policy changed; reload booking' USING ERRCODE = '40001';
    END IF;
    NEW.cancellation_policy_hours := agreed_hours;
  ELSIF NEW.cancellation_policy_hours IS DISTINCT FROM OLD.cancellation_policy_hours THEN
    RAISE EXCEPTION 'The booking cancellation agreement is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_booking_cancellation_policy() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bookings_cancellation_agreement
  BEFORE INSERT OR UPDATE OF cancellation_policy_hours ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_booking_cancellation_policy();

CREATE TABLE public.booking_refunds (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('buyer', 'creator')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('not_requested', 'pending', 'succeeded', 'failed')),
  amount_cents integer CHECK (amount_cents > 0),
  stripe_refund_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_livemode boolean,
  stripe_transfer_id text,
  transfer_reversal_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transfer_reversal_ids) = 'array'),
  application_fee_refund_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(application_fee_refund_ids) = 'array'),
  transfer_status text NOT NULL DEFAULT 'not_required' CHECK (transfer_status IN ('not_required', 'pending', 'succeeded', 'failed')),
  processing_fee_cents integer CHECK (processing_fee_cents >= 0),
  processing_fee_cost_owner text NOT NULL CHECK (processing_fee_cost_owner IN ('platform', 'coach')),
  processing_fee_accounting_status text NOT NULL DEFAULT 'pending' CHECK (processing_fee_accounting_status IN ('pending', 'recorded')),
  last_error_code text,
  CHECK (processing_fee_cost_owner = CASE WHEN actor_role = 'creator' THEN 'coach' ELSE 'platform' END)
);
ALTER TABLE public.booking_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_refunds FROM anon, authenticated;
-- Customers receive lifecycle information, never internal fee accounting.
GRANT SELECT (booking_id, state, amount_cents) ON public.booking_refunds TO authenticated;
GRANT ALL ON public.booking_refunds TO service_role;
CREATE POLICY booking_refunds_read_participant ON public.booking_refunds
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.creator_profiles cp ON cp.id = b.creator_id
    WHERE b.id = booking_id AND (b.buyer_id = (SELECT auth.uid()) OR cp.user_id = (SELECT auth.uid()))
  ));

-- All role, deadline and completion checks occur while holding the booking lock.
-- The cancellation and durable refund claim either both commit or neither does.
CREATE FUNCTION public.cancel_coaching_booking(p_booking_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  b public.bookings%ROWTYPE;
  r public.booking_refunds%ROWTYPE;
  coach_user_id uuid;
  coach_display_name text;
  actor_role text;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT user_id, display_name INTO coach_user_id, coach_display_name FROM public.creator_profiles WHERE id = b.creator_id;
  IF p_actor_user_id = b.buyer_id THEN actor_role := 'buyer';
  ELSIF p_actor_user_id = coach_user_id THEN actor_role := 'creator';
  ELSE RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO r FROM public.booking_refunds WHERE booking_id = b.id;
  IF b.status = 'cancelled' THEN
    RETURN jsonb_build_object('booking', to_jsonb(b), 'refund', CASE WHEN r.booking_id IS NULL THEN NULL ELSE to_jsonb(r) END, 'actor_role', actor_role, 'creator_user_id', coach_user_id, 'creator_display_name', coach_display_name, 'newly_cancelled', false);
  END IF;
  IF b.status <> 'confirmed' OR b.scheduled_at + make_interval(mins => b.duration_minutes) <= now() THEN
    RETURN jsonb_build_object('error', 'not_cancellable');
  END IF;
  IF actor_role = 'buyer' THEN
    IF b.cancellation_policy_hours IS NULL THEN RETURN jsonb_build_object('error', 'policy_unavailable'); END IF;
    IF b.scheduled_at - make_interval(hours => b.cancellation_policy_hours) < now() THEN
      RETURN jsonb_build_object('error', 'policy_violation', 'policy_hours', b.cancellation_policy_hours);
    END IF;
  END IF;
  IF b.payment_status IN ('paid', 'partially_refunded') THEN
    IF b.stripe_payment_intent_id IS NULL OR b.stripe_livemode IS NULL OR b.is_subscription_session THEN
      RETURN jsonb_build_object('error', 'payment_not_valid');
    END IF;
    INSERT INTO public.booking_refunds (booking_id, actor_user_id, actor_role, stripe_payment_intent_id, stripe_livemode, processing_fee_cost_owner)
    VALUES (b.id, p_actor_user_id, actor_role, b.stripe_payment_intent_id, b.stripe_livemode, CASE WHEN actor_role = 'creator' THEN 'coach' ELSE 'platform' END)
    RETURNING * INTO r;
  ELSIF b.payment_status NOT IN ('not_required', 'unpaid') THEN
    RETURN jsonb_build_object('error', 'payment_not_valid');
  END IF;
  UPDATE public.bookings SET status = 'cancelled', refund_status = CASE WHEN r.booking_id IS NULL THEN 'not_requested' ELSE 'pending' END
    WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'refund', CASE WHEN r.booking_id IS NULL THEN NULL ELSE to_jsonb(r) END, 'actor_role', actor_role, 'creator_user_id', coach_user_id, 'creator_display_name', coach_display_name, 'newly_cancelled', true);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_coaching_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_coaching_booking(uuid, uuid) TO service_role;

-- Apply a fresh Stripe observation atomically to the ledger and payment state.
-- An older in-flight webhook cannot overwrite a newer provider observation.
CREATE FUNCTION public.apply_coaching_refund_state(
  p_booking_id uuid, p_state jsonb, p_payment_status text,
  p_amount_refunded_cents integer, p_amount_paid_cents integer,
  p_provider_checked_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  b public.bookings%ROWTYPE;
  r public.booking_refunds%ROWTYPE;
  actual_paid integer;
  refunded integer;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking missing'; END IF;
  SELECT * INTO r FROM public.booking_refunds WHERE booking_id = b.id FOR UPDATE;
  -- An API outage is not a provider observation. Never let an unavailable
  -- Stripe read overwrite a concurrently confirmed refund or payment state.
  IF p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL
    AND r.state = 'succeeded' THEN
    RETURN jsonb_build_object('booking', to_jsonb(b), 'refund', to_jsonb(r), 'applied', false);
  END IF;
  IF p_provider_checked_at IS NULL OR (b.refund_provider_checked_at IS NOT NULL AND p_provider_checked_at < b.refund_provider_checked_at) THEN
    RETURN jsonb_build_object('booking', to_jsonb(b), 'refund', CASE WHEN r.booking_id IS NULL THEN NULL ELSE to_jsonb(r) END, 'applied', false);
  END IF;
  actual_paid := coalesce(p_amount_paid_cents, b.amount_paid_cents);
  refunded := coalesce(p_amount_refunded_cents, b.amount_refunded_cents);
  IF refunded < 0 OR (actual_paid IS NOT NULL AND (refunded > actual_paid OR actual_paid > b.price_cents))
    OR (b.amount_paid_cents IS NOT NULL AND p_amount_paid_cents IS NOT NULL AND b.amount_paid_cents <> p_amount_paid_cents) THEN
    RAISE EXCEPTION 'Invalid provider payment amount' USING ERRCODE = '23514';
  END IF;
  IF p_state IS NOT NULL THEN
    IF r.booking_id IS NULL THEN RAISE EXCEPTION 'Refund not claimed'; END IF;
    IF r.amount_cents IS NOT NULL AND (p_state->>'amount_cents') IS NOT NULL AND r.amount_cents <> (p_state->>'amount_cents')::integer THEN
      RAISE EXCEPTION 'Frozen refund amount changed' USING ERRCODE = '23514';
    END IF;
    IF coalesce((p_state->>'amount_cents')::integer, r.amount_cents, 0) > coalesce(actual_paid, 0) THEN
      RAISE EXCEPTION 'Refund exceeds actual payment' USING ERRCODE = '23514';
    END IF;
    UPDATE public.booking_refunds SET
      state = coalesce(p_state->>'state', state),
      amount_cents = coalesce(amount_cents, (p_state->>'amount_cents')::integer),
      stripe_refund_id = coalesce(p_state->>'stripe_refund_id', stripe_refund_id),
      stripe_payment_intent_id = coalesce(p_state->>'stripe_payment_intent_id', stripe_payment_intent_id),
      stripe_livemode = coalesce((p_state->>'stripe_livemode')::boolean, stripe_livemode),
      stripe_transfer_id = coalesce(p_state->>'stripe_transfer_id', stripe_transfer_id),
      transfer_reversal_ids = coalesce(p_state->'transfer_reversal_ids', transfer_reversal_ids),
      application_fee_refund_ids = coalesce(p_state->'application_fee_refund_ids', application_fee_refund_ids),
      transfer_status = coalesce(p_state->>'transfer_status', transfer_status),
      processing_fee_cents = coalesce((p_state->>'processing_fee_cents')::integer, processing_fee_cents),
      processing_fee_accounting_status = coalesce(p_state->>'processing_fee_accounting_status', processing_fee_accounting_status),
      last_error_code = CASE WHEN p_state ? 'last_error_code' THEN p_state->>'last_error_code' ELSE last_error_code END,
      updated_at = now()
      WHERE booking_id = b.id RETURNING * INTO r;
  END IF;
  UPDATE public.bookings SET
    amount_paid_cents = actual_paid,
    amount_refunded_cents = refunded,
    payment_status = CASE WHEN p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL THEN payment_status ELSE coalesce(p_payment_status, payment_status) END,
    refund_status = CASE WHEN r.booking_id IS NULL THEN refund_status ELSE r.state END,
    status = CASE WHEN p_payment_status = 'refunded' AND status NOT IN ('cancelled', 'completed') THEN 'refunded' ELSE status END,
    refund_provider_checked_at = CASE WHEN p_amount_paid_cents IS NULL AND p_amount_refunded_cents IS NULL THEN refund_provider_checked_at ELSE p_provider_checked_at END,
    payment_updated_at = now()
    WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('booking', to_jsonb(b), 'refund', CASE WHEN r.booking_id IS NULL THEN NULL ELSE to_jsonb(r) END, 'applied', true);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_coaching_refund_state(uuid, jsonb, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_coaching_refund_state(uuid, jsonb, text, integer, integer, timestamptz) TO service_role;
