-- The caller must create
-- two dedicated Auth users through GoTrueAdmin (never SQL), then set the local
-- ardore.test_buyer_id / ardore.test_coach_id settings to those synthetic UUIDs.
-- Every application row written below is a fresh, rollback-owned fixture.
-- When injecting transaction-local fixture settings, prepend BEGIN and those
-- set_config calls to this same SQL request. An extra BEGIN is harmless.
BEGIN;
DO $$
DECLARE
  buyer uuid := nullif(current_setting('ardore.test_buyer_id', true), '')::uuid;
  coach_user uuid := nullif(current_setting('ardore.test_coach_id', true), '')::uuid;
  coach uuid := gen_random_uuid(); request_key uuid := gen_random_uuid(); discount uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid(); occupied uuid := gen_random_uuid(); free_b uuid := gen_random_uuid();
  completed_b uuid := gen_random_uuid(); already_refunded_b uuid := gen_random_uuid();
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; res jsonb; obs jsonb; observed timestamptz := now();
  token1 uuid := gen_random_uuid(); token2 uuid := gen_random_uuid(); test_event_id text := 'evt_ardore_lifecycle_sql_' || gen_random_uuid()::text;
BEGIN
  IF buyer IS NULL OR coach_user IS NULL OR buyer = coach_user OR (
    SELECT count(*) FROM auth.users WHERE id IN (buyer, coach_user)
      AND email LIKE 'delivered+ardore-lifecycle-%@resend.dev'
  ) <> 2 THEN RAISE EXCEPTION 'Dedicated GoTrueAdmin synthetic fixtures required'; END IF;
  INSERT INTO public.creator_profiles(id, user_id, display_name, slug)
    VALUES(coach, coach_user, 'Synthetic lifecycle SQL fixture', 'ardore-lifecycle-sql-' || coach::text);
  INSERT INTO public.coaching_offers(creator_id, is_enabled, price_cents, duration_minutes, cancellation_policy_hours)
    VALUES(coach, true, 500, 5, 24);
  INSERT INTO public.discounts(id, creator_id, type, value, applies_to, redemption_count)
    VALUES(discount, coach, 'percent', 10, 'sessions', 0);
  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
    payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name, booking_request_key, discount_id)
    VALUES(b1, coach, buyer, now() + interval '14 days', 5, 500, 'pending_payment', 'pending', false,
      now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer', request_key, discount);
  BEGIN
    INSERT INTO public.bookings(creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
      payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name, booking_request_key)
      VALUES(coach, buyer, now() + interval '15 days', 5, 500, 'pending_payment', 'pending', false,
        now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer', request_key);
    RAISE EXCEPTION 'Repeated booking request was not rejected';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes');
  a1 := (res->'attempt'->>'id')::uuid;
  ASSERT (res->>'created')::boolean AND a1 IS NOT NULL, 'Initial attempt is durable';
  PERFORM public.register_coaching_checkout(a1, 'cs_sql_' || a1::text, 'https://checkout.stripe.com/synthetic');
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes');
  ASSERT (res->'attempt'->>'id')::uuid = a1 AND NOT (res->>'created')::boolean, 'Repeated checkout reuses attempt';
  obs := jsonb_build_object('booking_id', b1, 'buyer_id', buyer, 'creator_id', coach, 'session_id', 'cs_sql_' || a1::text,
    'payment_intent_id', 'pi_sql_' || a1::text, 'livemode', false, 'currency', 'eur', 'amount_total', 500,
    'provider_state', 'open', 'provider_checked_at', observed, 'provider_error_code', 'payment_failed');
  res := public.observe_coaching_payment_attempt(a1, obs);
  ASSERT res->'booking'->>'status' = 'pending_payment' AND res->'booking'->>'payment_status' = 'failed', 'Retryable failure retains hold';
  BEGIN
    INSERT INTO public.bookings(creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status, payment_status, buyer_email, buyer_name)
      VALUES(coach, buyer, now() + interval '14 days', 5, 0, 'confirmed', 'not_required', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
    RAISE EXCEPTION 'Retryable failure released its slot unsafely';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  BEGIN
    PERFORM public.observe_coaching_payment_attempt(a1, obs || jsonb_build_object('livemode', true));
    RAISE EXCEPTION 'Foreign provider mode was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  res := public.observe_coaching_payment_attempt(a1, obs);
  ASSERT res->'booking'->>'status' = 'pending_payment', 'Duplicate failure is harmless';
  observed := observed + interval '1 second';
  res := public.observe_coaching_payment_attempt(a1, obs || jsonb_build_object('provider_state', 'failed', 'provider_checked_at', observed));
  ASSERT res->'booking'->>'status' = 'payment_failed', 'Provider-terminal failure releases hold';
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes');
  ASSERT res->>'error' = 'stale_attempt', 'Retry requires compare-and-set identity';
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes', a1);
  a2 := (res->'attempt'->>'id')::uuid;
  ASSERT a2 IS NOT NULL AND a2 <> a1, 'Retry retains booking with distinct attempt';
  PERFORM public.register_coaching_checkout(a2, 'cs_sql_' || a2::text, 'https://checkout.stripe.com/synthetic');
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes', a1);
  ASSERT (res->'attempt'->>'id')::uuid = a2, 'Repeated retry uses one attempt';
  UPDATE public.coaching_offers SET price_cents = 800, cancellation_policy_hours = 48 WHERE creator_id = coach;
  ASSERT (SELECT price_cents = 500 AND cancellation_policy_hours = 24 FROM public.bookings WHERE id = b1), 'Agreed price and cutoff remain immutable';
  observed := observed + interval '1 second';
  res := public.observe_coaching_payment_attempt(a1, obs || jsonb_build_object('provider_state', 'paid', 'provider_checked_at', observed, 'amount_paid_cents', 500, 'provider_error_code', NULL));
  ASSERT (res->>'newly_confirmed')::boolean AND res->'booking'->>'status' = 'confirmed', 'Delayed old success safely fulfills available slot';
  ASSERT (SELECT redemption_count = 1 FROM public.discounts WHERE id = discount), 'First fulfillment atomically redeems discount';
  res := public.observe_coaching_payment_attempt(a1, obs || jsonb_build_object('provider_state', 'paid', 'provider_checked_at', observed, 'amount_paid_cents', 500));
  ASSERT NOT (res->>'newly_confirmed')::boolean AND NOT (res->>'needs_reconciliation')::boolean, 'Duplicate success creates no second fulfillment';
  ASSERT (SELECT redemption_count = 1 FROM public.discounts WHERE id = discount), 'Duplicate success never double-redeems discount';
  observed := observed + interval '1 second';
  res := public.observe_coaching_payment_attempt(a1, obs || jsonb_build_object('provider_state', 'failed', 'provider_checked_at', observed));
  ASSERT NOT (res->>'applied')::boolean AND res->'booking'->>'payment_status' = 'paid', 'Failure after success cannot regress payment';
  obs := obs || jsonb_build_object('session_id', 'cs_sql_' || a2::text, 'payment_intent_id', 'pi_sql_' || a2::text,
    'provider_state', 'paid', 'provider_checked_at', observed, 'amount_paid_cents', 500);
  res := public.observe_coaching_payment_attempt(a2, obs);
  ASSERT (res->>'needs_reconciliation')::boolean AND res->'attempt'->>'reconciliation_reason' = 'duplicate_payment', 'Second paid attempt has durable refund claim';
  ASSERT res->'booking'->>'stripe_payment_intent_id' = 'pi_sql_' || a1::text, 'Second paid attempt never overwrites winner';
  res := public.apply_coaching_attempt_refund_state(a2, jsonb_build_object('state', 'pending', 'amount_cents', 500, 'last_error_code', 'payment_capture_pending'), 'paid', 0, 500, observed);
  res := public.observe_coaching_payment_attempt(a2, obs || jsonb_build_object('provider_checked_at', observed + interval '1 second'));
  ASSERT res->'attempt'->>'last_error_code' = 'payment_capture_pending', 'Provider observation preserves refund capture marker';
  res := public.apply_coaching_attempt_refund_state(a2, jsonb_build_object('state', 'succeeded', 'amount_cents', 500, 'stripe_refund_id', 're_sql_' || a2::text, 'last_error_code', NULL), 'refunded', 500, 500, observed + interval '2 seconds');
  ASSERT res->'attempt'->>'fulfillment_state' = 'reconciled' AND res->'booking'->>'payment_status' = 'refunded', 'Refund adapter reports losing payment truth';
  ASSERT (SELECT payment_status = 'paid' AND status = 'confirmed' AND stripe_payment_intent_id = 'pi_sql_' || a1::text FROM public.bookings WHERE id = b1), 'Refund does not change fulfilled booking';
  ASSERT (SELECT redemption_count = 1 FROM public.discounts WHERE id = discount), 'Losing attempt neither fulfills nor redeems again';
  BEGIN
    PERFORM public.apply_coaching_attempt_refund_state(a1, jsonb_build_object('state', 'pending', 'amount_cents', 500), 'paid', 0, 500, observed);
    RAISE EXCEPTION 'Winner payment was allowed into automatic reconciliation';
  EXCEPTION WHEN check_violation THEN NULL; END;
  res := public.begin_coaching_payment_attempt(b1, buyer, false, now() + interval '31 minutes', a2);
  ASSERT res->>'error' = 'not_payable', 'A paid booking cannot create another Checkout';

  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
    payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name)
    VALUES(b2, coach, buyer, now() + interval '16 days', 5, 500, 'pending_payment', 'pending', false,
      now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.begin_coaching_payment_attempt(b2, buyer, false, now() + interval '31 minutes'); a3 := (res->'attempt'->>'id')::uuid;
  PERFORM public.register_coaching_checkout(a3, 'cs_sql_' || a3::text, NULL);
  obs := jsonb_build_object('booking_id', b2, 'buyer_id', buyer, 'creator_id', coach, 'session_id', 'cs_sql_' || a3::text,
    'payment_intent_id', 'pi_sql_' || a3::text, 'livemode', false, 'currency', 'eur', 'amount_total', 500,
    'provider_state', 'expired', 'provider_checked_at', observed);
  res := public.observe_coaching_payment_attempt(a3, obs);
  ASSERT res->'booking'->>'status' = 'expired', 'Checkout expiry releases hold';
  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status, payment_status, buyer_email, buyer_name)
    VALUES(occupied, coach, buyer, now() + interval '16 days', 5, 0, 'confirmed', 'not_required', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.observe_coaching_payment_attempt(a3, obs || jsonb_build_object('provider_state', 'paid', 'provider_checked_at', observed + interval '1 second', 'amount_paid_cents', 500));
  ASSERT (res->>'needs_reconciliation')::boolean AND res->'attempt'->>'reconciliation_reason' = 'slot_unavailable', 'Paid delayed occupied slot creates refund claim';
  ASSERT NOT (res->>'newly_confirmed')::boolean AND res->'booking'->>'status' <> 'confirmed', 'Occupied slot is never double-booked';
  res := public.apply_coaching_attempt_refund_state(a3, jsonb_build_object('state', 'failed', 'amount_cents', 500, 'last_error_code', 'stripe_refund_request_failed'), 'paid', 0, 500, observed + interval '2 seconds');
  ASSERT res->'attempt'->>'refund_status' = 'failed' AND (SELECT payment_status = 'paid' FROM public.bookings WHERE id = b2), 'API failure never falsely marks refunded';
  res := public.apply_coaching_attempt_refund_state(a3, jsonb_build_object('state', 'succeeded', 'amount_cents', 500, 'stripe_refund_id', 're_sql_' || a3::text, 'last_error_code', NULL), 'refunded', 500, 500, observed + interval '3 seconds');
  ASSERT (SELECT status = 'refunded' AND payment_status = 'refunded' FROM public.bookings WHERE id = b2), 'Completed full refund settles unfulfilled booking';
  ASSERT (SELECT status = 'confirmed' AND payment_status = 'not_required' FROM public.bookings WHERE id = occupied), 'Replacement/free booking remains untouched';
  res := public.apply_coaching_attempt_refund_state(a3, jsonb_build_object('state', 'failed'), NULL, NULL, NULL, observed + interval '4 seconds');
  ASSERT NOT (res->>'applied')::boolean AND res->'attempt'->>'refund_status' = 'succeeded', 'Unavailable provider read cannot regress succeeded refund';
  BEGIN
    PERFORM public.apply_coaching_attempt_refund_state(a3, jsonb_build_object('state', 'succeeded', 'amount_cents', 600), 'refunded', 600, 500, observed + interval '5 seconds');
    RAISE EXCEPTION 'Over-refund was not rejected';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
    payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name)
    VALUES(b3, coach, buyer, now() + interval '17 days', 5, 500, 'pending_payment', 'pending', false,
      now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.begin_coaching_payment_attempt(b3, buyer, false, now() + interval '31 minutes'); a4 := (res->'attempt'->>'id')::uuid;
  PERFORM public.register_coaching_checkout(a4, 'cs_sql_' || a4::text, NULL);
  obs := jsonb_build_object('booking_id', b3, 'buyer_id', buyer, 'creator_id', coach, 'session_id', 'cs_sql_' || a4::text,
    'payment_intent_id', 'pi_sql_' || a4::text, 'livemode', false, 'currency', 'eur', 'amount_total', 500,
    'provider_state', 'expired', 'provider_checked_at', observed);
  PERFORM public.observe_coaching_payment_attempt(a4, obs);
  res := public.observe_coaching_payment_attempt(a4, obs || jsonb_build_object('provider_state', 'paid', 'provider_checked_at', observed + interval '1 second', 'amount_paid_cents', 500));
  ASSERT (res->>'newly_confirmed')::boolean AND res->'booking'->>'status' = 'confirmed', 'Delayed success restores expired available slot';
  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status, payment_status, buyer_email, buyer_name)
    VALUES(free_b, coach, buyer, now() + interval '18 days', 5, 0, 'confirmed', 'not_required', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.begin_coaching_payment_attempt(free_b, buyer, false, now() + interval '31 minutes');
  ASSERT res->>'error' IN ('not_payable', 'mode_mismatch') AND NOT EXISTS(SELECT 1 FROM public.coaching_payment_attempts WHERE booking_id = free_b), 'Free bookings never create paid attempts';
  ASSERT (SELECT count(*) = 4 FROM public.coaching_payment_attempts WHERE booking_id IN (b1,b2,b3)), 'Retry and duplicates have exactly four attempts';

  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
    payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name)
    VALUES(completed_b, coach, buyer, now() + interval '19 days', 5, 500, 'pending_payment', 'pending', false,
      now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.begin_coaching_payment_attempt(completed_b, buyer, false, now() + interval '31 minutes'); a4 := (res->'attempt'->>'id')::uuid;
  PERFORM public.register_coaching_checkout(a4, 'cs_sql_' || a4::text, NULL);
  obs := jsonb_build_object('booking_id', completed_b, 'buyer_id', buyer, 'creator_id', coach, 'session_id', 'cs_sql_' || a4::text,
    'payment_intent_id', 'pi_sql_' || a4::text, 'livemode', false, 'currency', 'eur', 'amount_total', 500,
    'provider_state', 'open', 'provider_checked_at', observed);
  PERFORM public.observe_coaching_payment_attempt(a4, obs);
  UPDATE public.bookings SET status = 'completed' WHERE id = completed_b;
  res := public.observe_coaching_payment_attempt(a4, obs || jsonb_build_object('provider_state', 'paid', 'provider_checked_at', observed + interval '1 second', 'amount_paid_cents', 500));
  ASSERT (res->>'needs_reconciliation')::boolean AND NOT (res->>'newly_confirmed')::boolean, 'Anomalous completed unfulfilled payment reconciles privately';
  res := public.apply_coaching_attempt_refund_state(a4, jsonb_build_object('state', 'succeeded', 'amount_cents', 500, 'stripe_refund_id', 're_sql_' || a4::text), 'refunded', 500, 500, observed + interval '2 seconds');
  ASSERT res->'attempt'->>'fulfillment_state' = 'reconciled', 'Completed unfulfilled payment can settle safely';
  ASSERT (SELECT status = 'completed' AND payment_status = 'pending' AND amount_paid_cents IS NULL AND refund_status = 'not_requested' FROM public.bookings WHERE id = completed_b), 'Completed primary booking is never changed by private technical refund';

  INSERT INTO public.bookings(id, creator_id, buyer_id, scheduled_at, duration_minutes, price_cents, status,
    payment_status, stripe_livemode, reservation_expires_at, buyer_email, buyer_name)
    VALUES(already_refunded_b, coach, buyer, now() + interval '20 days', 5, 500, 'pending_payment', 'pending', false,
      now() + interval '31 minutes', 'delivered+ardore-lifecycle-sql@resend.dev', 'Synthetic buyer');
  res := public.begin_coaching_payment_attempt(already_refunded_b, buyer, false, now() + interval '31 minutes'); a4 := (res->'attempt'->>'id')::uuid;
  PERFORM public.register_coaching_checkout(a4, 'cs_sql_' || a4::text, NULL);
  obs := jsonb_build_object('booking_id', already_refunded_b, 'buyer_id', buyer, 'creator_id', coach, 'session_id', 'cs_sql_' || a4::text,
    'payment_intent_id', 'pi_sql_' || a4::text, 'livemode', false, 'currency', 'eur', 'amount_total', 500,
    'provider_state', 'paid', 'provider_checked_at', observed, 'amount_paid_cents', 500, 'amount_refunded_cents', 500,
    'force_reconciliation_reason', 'payment_already_refunded');
  res := public.observe_coaching_payment_attempt(a4, obs);
  ASSERT (res->>'needs_reconciliation')::boolean AND res->'attempt'->>'reconciliation_reason' = 'payment_already_refunded', 'Already-refunded payment cannot grant fresh fulfillment';
  res := public.apply_coaching_attempt_refund_state(a4, jsonb_build_object('state', 'succeeded'), 'refunded', 500, 500, observed + interval '1 second');
  ASSERT res->'booking'->>'amount_refunded_cents' = '500' AND res->'booking'->>'payment_status' = 'refunded', 'Adapter retains actual full refund amount without creating a new refund';

  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token1);
  ASSERT (res->>'claimed')::boolean, 'First webhook worker owns lease';
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token2);
  ASSERT (res->>'busy')::boolean AND NOT (res->>'claimed')::boolean, 'Concurrent webhook waits for lease';
  ASSERT NOT public.complete_stripe_webhook_event(test_event_id, token2), 'Foreign worker cannot complete lease';
  ASSERT NOT public.release_stripe_webhook_event(test_event_id, token2), 'Foreign worker cannot release lease';
  ASSERT public.release_stripe_webhook_event(test_event_id, token1), 'Failed worker releases its own lease';
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token2);
  ASSERT (res->>'claimed')::boolean, 'Failure retry reclaims event';
  ASSERT NOT public.complete_stripe_webhook_event(test_event_id, token1), 'Old worker cannot complete reclaimed event';
  ASSERT public.complete_stripe_webhook_event(test_event_id, token2), 'Current worker completes event';
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token1);
  ASSERT (res->>'processed')::boolean AND NOT (res->>'claimed')::boolean, 'Completed event retries are harmless';
  test_event_id := 'evt_ardore_lifecycle_sql_crash_' || gen_random_uuid()::text;
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token1);
  ASSERT (res->>'claimed')::boolean, 'Crash simulation starts with owned lease';
  UPDATE public.stripe_webhook_events SET lease_expires_at = now() - interval '1 second' WHERE stripe_webhook_events.event_id = test_event_id;
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token2);
  ASSERT (res->>'claimed')::boolean, 'Expired crashed worker lease is recoverable';
  ASSERT NOT public.complete_stripe_webhook_event(test_event_id, token1), 'Expired old worker cannot finalize recovered event';
  test_event_id := 'evt_ardore_lifecycle_sql_legacy_' || gen_random_uuid()::text;
  INSERT INTO public.stripe_webhook_events(event_id, event_type, livemode) VALUES(test_event_id, 'checkout.session.completed', false);
  res := public.claim_stripe_webhook_event(test_event_id, 'checkout.session.completed', false, token1);
  ASSERT (res->>'processed')::boolean, 'Historical finalized event default remains processed';
END;
$$;
ROLLBACK;
SELECT true AS lifecycle_assertions_passed, 49 AS lifecycle_assertions, 5 AS negative_guards;
