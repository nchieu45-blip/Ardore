-- Apply only after the new application is live and old processes are stopped.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER pause_individual_coaching_email_cutover ON public.bookings;
DROP TRIGGER pause_group_coaching_email_cutover ON public.video_class_bookings;
DROP FUNCTION private.pause_coaching_email_cutover();
COMMIT;
