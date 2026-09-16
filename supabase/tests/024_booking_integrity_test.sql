-- Run after migrations with: supabase test db supabase/tests/024_booking_integrity_test.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

SELECT has_column('public', 'coaching_offers', 'cancellation_policy_hours', 'cancellation policy drift is reconciled');
SELECT col_not_null('public', 'coaching_offers', 'cancellation_policy_hours', 'cancellation policy is required');
SELECT has_column('public', 'bookings', 'buffer_minutes', 'booking snapshots its buffer');
SELECT has_column('public', 'bookings', 'blocked_start_at', 'booking has an atomic blocked-range start');
SELECT has_column('public', 'bookings', 'blocked_end_at', 'booking has an atomic blocked-range end');
SELECT col_not_null('public', 'bookings', 'blocked_start_at', 'blocked-range start is required');
SELECT col_not_null('public', 'bookings', 'blocked_end_at', 'blocked-range end is required');
SELECT has_trigger('public', 'bookings', 'bookings_set_blocked_range', 'blocked range is maintained by a trigger');
SELECT has_function('public', 'set_booking_blocked_range', ARRAY[]::text[], 'blocked-range trigger function exists');
SELECT ok(NOT has_function_privilege('anon', 'public.set_booking_blocked_range()', 'EXECUTE'), 'anon cannot call the trigger function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.set_booking_blocked_range()', 'EXECUTE'), 'authenticated cannot call the trigger function');
SELECT ok(EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conrelid = 'public.bookings'::regclass
    AND conname = 'bookings_no_overlapping_active_sessions'
    AND contype = 'x'
), 'active bookings have a database exclusion constraint');

CREATE TEMP TABLE booking_test_context AS
SELECT id AS creator_id FROM public.creator_profiles ORDER BY id LIMIT 1;

DO $fixtures$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM booking_test_context) THEN
    RAISE EXCEPTION 'Booking integrity tests require one creator profile';
  END IF;
END
$fixtures$;

INSERT INTO public.bookings (
  id, creator_id, scheduled_at, duration_minutes, buffer_minutes,
  price_cents, status, buyer_email, buyer_name
)
SELECT '02400000-0000-0000-0000-000000000001', creator_id,
       '2098-01-15 09:00:00+00', 60, 15, 0, 'confirmed',
       'transactional-booking-test@invalid', 'Transactional test'
FROM booking_test_context;

SELECT is(
  (SELECT blocked_end_at FROM public.bookings WHERE id = '02400000-0000-0000-0000-000000000001'),
  '2098-01-15 10:15:00+00'::timestamptz,
  'buffer is included in the database blocked range'
);

SELECT throws_like(
  $$INSERT INTO public.bookings (
      id, creator_id, scheduled_at, duration_minutes, buffer_minutes,
      price_cents, status, buyer_email, buyer_name
    )
    SELECT '02400000-0000-0000-0000-000000000002', creator_id,
           '2098-01-15 09:30:00+00', 30, 0, 0, 'confirmed',
           'transactional-booking-test@invalid', 'Transactional test'
    FROM booking_test_context$$,
  '%conflicting key value violates exclusion constraint%',
  'overlapping active booking is rejected'
);

INSERT INTO public.bookings (
  id, creator_id, scheduled_at, duration_minutes, buffer_minutes,
  price_cents, status, buyer_email, buyer_name
)
SELECT '02400000-0000-0000-0000-000000000003', creator_id,
       '2098-01-15 10:15:00+00', 30, 0, 0, 'confirmed',
       'transactional-booking-test@invalid', 'Transactional test'
FROM booking_test_context;

SELECT lives_ok(
  $$UPDATE public.bookings
    SET scheduled_at = scheduled_at
    WHERE id = '02400000-0000-0000-0000-000000000003'$$,
  'booking does not conflict with itself during reschedule'
);
SELECT lives_ok(
  $$UPDATE public.bookings
    SET scheduled_at = '2098-01-15 11:00:00+00'
    WHERE id = '02400000-0000-0000-0000-000000000003'$$,
  'valid non-overlapping reschedule succeeds'
);
SELECT is(
  (SELECT scheduled_at FROM public.bookings WHERE id = '02400000-0000-0000-0000-000000000003'),
  '2098-01-15 11:00:00+00'::timestamptz,
  'valid reschedule stores the requested UTC time'
);
SELECT throws_like(
  $$UPDATE public.bookings
    SET scheduled_at = '2098-01-15 09:45:00+00'
    WHERE id = '02400000-0000-0000-0000-000000000003'$$,
  '%conflicting key value violates exclusion constraint%',
  'overlapping reschedule is rejected'
);
SELECT is(
  (SELECT scheduled_at FROM public.bookings WHERE id = '02400000-0000-0000-0000-000000000003'),
  '2098-01-15 11:00:00+00'::timestamptz,
  'failed reschedule preserves the original time'
);

UPDATE public.bookings SET status = 'cancelled'
WHERE id = '02400000-0000-0000-0000-000000000001';
INSERT INTO public.bookings (
  id, creator_id, scheduled_at, duration_minutes, buffer_minutes,
  price_cents, status, buyer_email, buyer_name
)
SELECT '02400000-0000-0000-0000-000000000004', creator_id,
       '2098-01-15 09:00:00+00', 60, 15, 0, 'confirmed',
       'transactional-booking-test@invalid', 'Transactional test'
FROM booking_test_context;
SELECT ok(
  EXISTS (SELECT 1 FROM public.bookings WHERE id = '02400000-0000-0000-0000-000000000004'),
  'cancelled booking releases its blocked time'
);

SELECT * FROM finish();
ROLLBACK;
