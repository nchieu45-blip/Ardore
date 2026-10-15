-- ISOLATED LOCAL/TEST POSTGRES ONLY. Never run this against production.
-- Required: migration applied in a disposable database named
-- ardore_notification_test*, anon/authenticated/service_role roles, a dedicated
-- booking with TWO synthetic recipient identities provisioned by GoTrue Admin
-- (never SQL), and these session settings:
--   ardore.isolated_sql_test = true
--   ardore.test_booking_id, ardore.test_buyer_id, ardore.test_coach_id = UUIDs
-- A completely isolated PostgreSQL mock may instead reference public fixture
-- identities; that verifies outbox behavior, not GoTrue/Auth FK integration.
-- PGlite uses template1 internally; its runner additionally sets
-- ardore.isolated_sql_engine=pglite and creates public.fixture_users instead.
-- Run with ON_ERROR_STOP. All writes below roll back. No auth.users writes,
-- email calls, production queries, database resets, or destructive cleanup.
-- Real multi-connection follow-up: claim the same tuple in two transactions;
-- commit the first, and assert exactly one claimed and one busy. Repeat with
-- an expired lease, then race stale completion against a new claim. PGlite's
-- single connection can test the state machine, not actual lock contention.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;

DO $$
DECLARE
  signature text;
  role_name text;
  operation text;
BEGIN
  IF current_setting('ardore.isolated_sql_test', true) IS DISTINCT FROM 'true'
    OR (current_database() LIKE 'ardore_notification_test%'
      OR (current_database() = 'template1'
        AND current_setting('ardore.isolated_sql_engine', true) = 'pglite'
        AND to_regclass('public.fixture_users') IS NOT NULL)) IS NOT TRUE
    OR nullif(current_setting('ardore.test_booking_id', true), '') IS NULL
    OR nullif(current_setting('ardore.test_buyer_id', true), '') IS NULL
    OR nullif(current_setting('ardore.test_coach_id', true), '') IS NULL
  THEN RAISE EXCEPTION 'Explicit isolated database and synthetic fixtures required'; END IF;

  ASSERT (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.session_notification_deliveries'::regclass), 'Outbox RLS enabled';
  ASSERT NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'session_notification_deliveries'), 'No browser RLS policies';
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      ASSERT NOT has_table_privilege(role_name, 'public.session_notification_deliveries', operation),
        'Browser roles must have no outbox privileges';
    END LOOP;
    ASSERT NOT EXISTS (
      SELECT FROM pg_attribute a
      WHERE a.attrelid = 'public.session_notification_deliveries'::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
        AND (has_column_privilege(role_name, a.attrelid, a.attname, 'SELECT')
          OR has_column_privilege(role_name, a.attrelid, a.attname, 'INSERT')
          OR has_column_privilege(role_name, a.attrelid, a.attname, 'UPDATE'))
    ), 'No leftover browser column grants';
  END LOOP;
  FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    ASSERT has_table_privilege('service_role', 'public.session_notification_deliveries', operation),
      'Service role has required outbox privileges';
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.claim_session_notification(uuid,uuid,text,text,timestamptz,jsonb,uuid)',
    'public.complete_session_notification(uuid,uuid)',
    'public.fail_session_notification(uuid,uuid)',
    'public.session_notification_rollout_at()'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      ASSERT has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'),
        'Only service role can call delivery functions';
    END LOOP;
    ASSERT (SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=""']
      FROM pg_proc WHERE oid = signature::regprocedure), 'Invoker function with empty search_path';
  END LOOP;
END;
$$;

-- Prove denial by executing harmless operations, not just reading ACL metadata.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.session_notification_deliveries;
    RAISE EXCEPTION 'Anonymous outbox read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'Anonymous claim unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.session_notification_deliveries DEFAULT VALUES;
    RAISE EXCEPTION 'Authenticated outbox insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.session_notification_deliveries SET state = 'pending' WHERE false;
    RAISE EXCEPTION 'Authenticated outbox update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.session_notification_deliveries WHERE false;
    RAISE EXCEPTION 'Authenticated outbox delete unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.complete_session_notification(NULL, NULL);
    RAISE EXCEPTION 'Authenticated completion unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.fail_session_notification(NULL, NULL);
    RAISE EXCEPTION 'Authenticated failure unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  booking uuid := current_setting('ardore.test_booking_id')::uuid;
  buyer uuid := current_setting('ardore.test_buyer_id')::uuid;
  coach uuid := current_setting('ardore.test_coach_id')::uuid;
  occurrence timestamptz := '2031-04-01 10:00:00+00';
  token1 uuid := gen_random_uuid();
  token2 uuid := gen_random_uuid();
  token3 uuid := gen_random_uuid();
  inapp_id uuid;
  email_id uuid;
  first_attempt timestamptz;
  rollout_at timestamptz := public.session_notification_rollout_at();
  result jsonb;
  inapp jsonb := jsonb_build_object('title', 'Fixture reminder', 'message', 'Fixture message',
    'link', '/session/' || booking::text);
  email jsonb := jsonb_build_object('from', 'Ardore <fixture@example.invalid>',
    'to', 'recipient@example.invalid', 'subject', 'Fixture reminder',
    'html', '<p>Fixture only</p>', 'text', 'Fixture only');
BEGIN
  ASSERT buyer <> coach, 'Two distinct synthetic recipients required';
  ASSERT EXISTS (SELECT FROM public.bookings WHERE id = booking), 'Dedicated booking required';

  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence, inapp, token1);
  inapp_id := (result->>'id')::uuid;
  ASSERT result->>'state' = 'claimed' AND inapp_id IS NOT NULL AND result->'payload' = inapp,
    'First claim is durable with frozen payload';
  SELECT first_attempt_at INTO first_attempt FROM public.session_notification_deliveries WHERE id = inapp_id;
  ASSERT (SELECT state = 'processing' AND lease_token = token1
    AND lease_until BETWEEN clock_timestamp() + interval '299 seconds' AND clock_timestamp() + interval '301 seconds'
    FROM public.session_notification_deliveries WHERE id = inapp_id), 'Five minute lease acquired';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence, inapp, token2);
  ASSERT result->>'state' = 'busy', 'Second worker cannot acquire active lease';
  ASSERT NOT public.complete_session_notification(inapp_id, token2), 'Foreign completion rejected';
  ASSERT NOT public.fail_session_notification(inapp_id, token2), 'Foreign failure rejected';
  ASSERT public.fail_session_notification(inapp_id, token1), 'Owner can release failed delivery';
  ASSERT (SELECT state = 'pending' AND lease_token IS NULL AND lease_until IS NULL
    AND first_attempt_at = first_attempt AND payload = inapp
    FROM public.session_notification_deliveries WHERE id = inapp_id), 'Failure preserves idempotency material';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence,
    inapp || '{"title":"Changed attempt"}'::jsonb, token2);
  ASSERT (result->>'id')::uuid = inapp_id AND result->'payload' = inapp, 'Retry uses first payload and ID';
  ASSERT NOT public.complete_session_notification(inapp_id, token1), 'Stale token cannot complete reclaimed lease';
  ASSERT public.complete_session_notification(inapp_id, token2), 'Owner atomically completes in-app delivery';
  ASSERT public.complete_session_notification(inapp_id, token2), 'Repeated owner completion harmless';
  ASSERT NOT public.complete_session_notification(inapp_id, token3), 'Sent completion still rejects foreign token';
  ASSERT (SELECT payload = '{}'::jsonb FROM public.session_notification_deliveries WHERE id = inapp_id),
    'Sent outbox removes frozen private content after inbox materialization';
  ASSERT (SELECT count(*) = 1 FROM public.notifications WHERE id = inapp_id AND user_id = buyer
    AND type = 'session_reminder' AND title = inapp->>'title' AND message = inapp->>'message'
    AND link = inapp->>'link'), 'Exactly one authentic in-app row from frozen payload';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence, inapp, token3);
  ASSERT result->>'state' = 'sent', 'Completed occurrence does not resend';

  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email', occurrence, email, token1);
  email_id := (result->>'id')::uuid;
  ASSERT result->>'state' = 'claimed', 'Own in-app delivery does not suppress email';
  UPDATE public.session_notification_deliveries SET lease_until = clock_timestamp() - interval '1 second'
    WHERE id = email_id;
  ASSERT NOT public.complete_session_notification(email_id, token1), 'Expired owner cannot complete';
  ASSERT NOT public.fail_session_notification(email_id, token1), 'Expired owner cannot release lease';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email', occurrence,
    email || '{"subject":"Changed attempt"}'::jsonb, token2);
  ASSERT result->>'state' = 'claimed' AND (result->>'id')::uuid = email_id AND result->'payload' = email,
    'Expired lease is reclaimable with stable provider key and frozen request';
  ASSERT NOT public.complete_session_notification(email_id, token1), 'Previous worker cannot mark email sent';
  ASSERT public.complete_session_notification(email_id, token2), 'Email owner can record provider success';
  ASSERT (SELECT payload = '{}'::jsonb FROM public.session_notification_deliveries WHERE id = email_id),
    'Sent email outbox does not retain recipient address or rendered email';
  ASSERT NOT EXISTS (SELECT FROM public.notifications WHERE id = email_id), 'Email completion creates no inbox row';

  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp',
    occurrence + interval '1 day', inapp, token1);
  ASSERT result->>'state' = 'claimed' AND (result->>'id')::uuid <> inapp_id, 'Rescheduled occurrence has new identity';
  ASSERT public.complete_session_notification((result->>'id')::uuid, token1), 'Rescheduled reminder completes';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    occurrence + interval '1 day', email, token1);
  ASSERT result->>'state' = 'claimed', 'Own prior occurrence is not mistaken for legacy history';
  email_id := (result->>'id')::uuid;
  ASSERT public.fail_session_notification(email_id, token1), 'Email failure becomes retryable';
  UPDATE public.session_notification_deliveries SET first_attempt_at = clock_timestamp() - interval '23 hours'
    WHERE id = email_id;
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    occurrence + interval '1 day', email, token2);
  ASSERT result->>'state' = 'held', 'Ambiguous email never retries outside provider idempotency window';
  ASSERT NOT public.complete_session_notification(email_id, token1), 'Held work cannot be falsely completed';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    occurrence + interval '1 day', email, token3);
  ASSERT result->>'state' = 'held', 'Held state is durable across subsequent cron runs';

  -- Old notification rows have no ledger identity: suppress uncertain historical
  -- email/inapp outcomes independently for this recipient, not the whole booking.
  INSERT INTO public.notifications(user_id, type, title, message, link)
    VALUES (coach, 'session_reminder', 'Legacy fixture', 'Fixture only', inapp->>'link');
  result := public.claim_session_notification(booking, coach, 'session_reminder', 'inapp', occurrence, inapp, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Legacy in-app outcome is not repeated';
  result := public.claim_session_notification(booking, coach, 'session_reminder', 'email', occurrence, email, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Uncertain legacy email is not repeated';
  ASSERT (SELECT bool_and(payload = '{}'::jsonb) FROM public.session_notification_deliveries
    WHERE booking_id = booking AND recipient_id = coach), 'Legacy skips retain no unnecessary payload';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    occurrence + interval '2 days', email, token1);
  ASSERT result->>'state' = 'claimed', 'Another recipient legacy row never suppresses this recipient';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp',
    occurrence + interval '3 days', inapp, token1);
  inapp_id := (result->>'id')::uuid;
  ASSERT public.fail_session_notification(inapp_id, token1), 'In-app retry fixture released';
  UPDATE public.session_notification_deliveries SET first_attempt_at = clock_timestamp() - interval '24 hours'
    WHERE id = inapp_id;
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp',
    occurrence + interval '3 days', inapp, token2);
  ASSERT result->>'state' = 'claimed', 'Email provider retry cutoff does not prevent atomic in-app retries';
  result := public.claim_session_notification(booking, buyer, 'session_review_prompt', 'inapp', occurrence,
    jsonb_build_object('title', 'Fixture review', 'message', 'Fixture review message',
      'link', '/buyer/sessions?review=' || booking::text), token1);
  ASSERT result->>'state' = 'claimed', 'Review prompts have independent delivery key';
  ASSERT public.complete_session_notification((result->>'id')::uuid, token1), 'Expanded notification type accepts review prompt';
  INSERT INTO public.notifications(user_id, type, title, message)
    VALUES (buyer, 'new_video_class_booking', 'Type compatibility', 'Fixture only');

  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'unsupported', 'inapp', occurrence, inapp, token1);
    RAISE EXCEPTION 'Unsupported notification type accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'session_reminder', 'sms', occurrence, inapp, token1);
    RAISE EXCEPTION 'Unsupported channel accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence,
      inapp || '{"link":"https://example.invalid/foreign"}'::jsonb, token1);
    RAISE EXCEPTION 'Foreign notification link accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'session_reminder', 'email', occurrence,
      email - 'to', token1);
    RAISE EXCEPTION 'Malformed email payload accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', 'infinity', inapp, token1);
    RAISE EXCEPTION 'Infinite occurrence accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, buyer, 'session_reminder', 'inapp', occurrence, inapp, NULL);
    RAISE EXCEPTION 'Missing lease token accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(gen_random_uuid(), buyer, 'session_reminder', 'email', occurrence, email, token1);
    RAISE EXCEPTION 'Missing booking identity accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    PERFORM public.claim_session_notification(booking, gen_random_uuid(), 'session_reminder', 'email', occurrence, email, token1);
    RAISE EXCEPTION 'Missing recipient identity accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  ASSERT NOT public.complete_session_notification(gen_random_uuid(), token1), 'Missing delivery completion is false';
  ASSERT NOT public.fail_session_notification(gen_random_uuid(), token1), 'Missing delivery failure is false';

  -- Neither inbox marker nor a previous ledger row exists for these occurrences.
  -- The fixed cutover must still avoid resending old email-only deliveries.
  result := public.claim_session_notification(booking, buyer, 'session_review_prompt', 'email',
    rollout_at - interval '2 days', email, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Pre-rollout ended email-only review is conservatively skipped';
  result := public.claim_session_notification(booking, buyer, 'session_review_prompt', 'email',
    rollout_at - make_interval(mins => (SELECT duration_minutes FROM public.bookings WHERE id = booking)), email, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Session ending exactly at rollout is treated conservatively';
  UPDATE public.bookings SET created_at = rollout_at - interval '10 days' WHERE id = booking;
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    rollout_at + interval '12 hours', email, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Existing first-day email-only reminder is not resent';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    rollout_at + interval '25 hours', email, token1);
  ASSERT result->>'state' = 'legacy_skipped', 'Exact old 25h reminder boundary remains conservative';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    rollout_at + interval '25 hours 1 second', email, token1);
  ASSERT result->>'state' = 'claimed', 'Occurrence immediately beyond old reminder horizon is new work';
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    rollout_at + interval '26 hours', email, token1);
  ASSERT result->>'state' = 'claimed', 'Later/rescheduled occurrence beyond old reminder horizon remains deliverable';
  UPDATE public.bookings SET created_at = rollout_at + interval '1 second' WHERE id = booking;
  result := public.claim_session_notification(booking, buyer, 'session_reminder', 'email',
    rollout_at + interval '13 hours', email, token1);
  ASSERT result->>'state' = 'claimed', 'New post-rollout booking within first day remains deliverable';
  result := public.claim_session_notification(booking, buyer, 'session_review_prompt', 'email',
    rollout_at + interval '1 minute', email, token1);
  ASSERT result->>'state' = 'claimed', 'Post-rollout review occurrence remains deliverable';
  ASSERT public.session_notification_rollout_at() = rollout_at, 'Cutover timestamp is fixed across calls';
END;
$$;
RESET ROLE;

ROLLBACK;
