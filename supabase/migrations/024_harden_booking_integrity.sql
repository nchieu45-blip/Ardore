-- Booking OS hardening phase 1:
-- - reconcile the remotely-existing cancellation policy column with migration history
-- - snapshot the buffer used for each booking
-- - maintain explicit blocked ranges
-- - reject concurrent overlaps at the database boundary

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.coaching_offers
  ADD COLUMN IF NOT EXISTS cancellation_policy_hours integer;

UPDATE public.coaching_offers
SET cancellation_policy_hours = 24
WHERE cancellation_policy_hours IS NULL;

ALTER TABLE public.coaching_offers
  ALTER COLUMN cancellation_policy_hours SET DEFAULT 24,
  ALTER COLUMN cancellation_policy_hours SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coaching_offers'::regclass
      AND conname = 'coaching_offers_cancellation_policy_hours_check'
  ) THEN
    ALTER TABLE public.coaching_offers
      ADD CONSTRAINT coaching_offers_cancellation_policy_hours_check
      CHECK (cancellation_policy_hours >= 0 AND cancellation_policy_hours <= 168);
  END IF;
END
$$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS buffer_minutes integer,
  ADD COLUMN IF NOT EXISTS blocked_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_end_at timestamptz;

UPDATE public.bookings booking
SET buffer_minutes = COALESCE(offer.buffer_minutes, 0)
FROM public.coaching_offers offer
WHERE offer.creator_id = booking.creator_id
  AND booking.buffer_minutes IS NULL;

UPDATE public.bookings SET buffer_minutes = 0 WHERE buffer_minutes IS NULL;

CREATE OR REPLACE FUNCTION public.set_booking_blocked_range()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.blocked_start_at := NEW.scheduled_at;
  NEW.blocked_end_at := NEW.scheduled_at
    + make_interval(mins => NEW.duration_minutes + NEW.buffer_minutes);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_booking_blocked_range() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_set_blocked_range ON public.bookings;
CREATE TRIGGER bookings_set_blocked_range
BEFORE INSERT OR UPDATE OF scheduled_at, duration_minutes, buffer_minutes
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.set_booking_blocked_range();

UPDATE public.bookings
SET blocked_start_at = scheduled_at,
    blocked_end_at = scheduled_at + make_interval(mins => duration_minutes + buffer_minutes);

ALTER TABLE public.bookings
  ALTER COLUMN buffer_minutes SET DEFAULT 0,
  ALTER COLUMN buffer_minutes SET NOT NULL,
  ALTER COLUMN blocked_start_at SET NOT NULL,
  ALTER COLUMN blocked_end_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname = 'bookings_duration_minutes_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_duration_minutes_check
      CHECK (duration_minutes BETWEEN 5 AND 480);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname = 'bookings_buffer_minutes_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_buffer_minutes_check
      CHECK (buffer_minutes IN (0, 15, 30));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname = 'bookings_blocked_range_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_blocked_range_check
      CHECK (blocked_start_at = scheduled_at AND scheduled_at < blocked_end_at);
  END IF;
END
$$;

SET LOCAL search_path = public, extensions, pg_catalog;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlapping_active_sessions
  EXCLUDE USING gist (
    creator_id WITH =,
    tstzrange(blocked_start_at, blocked_end_at, '[)') WITH &&
  )
  WHERE (status <> 'cancelled');
