-- Elapsed appointment time is not proof of delivery. The trusted completed
-- booking status excludes delivered sessions; customer cutoff remains unchanged.
CREATE OR REPLACE FUNCTION public.cancel_coaching_booking(p_booking_id uuid, p_actor_user_id uuid)
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
  IF b.status <> 'confirmed' THEN
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

