-- User-confirmed launch capacity: nine attendees plus one Daily host.
-- A database constraint also covers direct owner writes and concurrent changes.
-- Never truncate existing offers or bookings to make this migration succeed.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.video_classes ALTER COLUMN max_participants SET DEFAULT 9;
ALTER TABLE public.video_classes ADD CONSTRAINT video_classes_group_video_capacity
  CHECK (max_participants IS NOT NULL AND max_participants BETWEEN 1 AND 9);
NOTIFY pgrst, 'reload schema';
COMMIT;
