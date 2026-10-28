-- Apply only after the matching application is live and old processes have stopped.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER pause_reschedule_email_cutover ON public.bookings;
DROP FUNCTION private.pause_reschedule_email_cutover();
COMMIT;
