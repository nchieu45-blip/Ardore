-- Apply before the reschedule migration during a coordinated production cutover.
-- Replay order on an empty database is harmless: this gate is removed by its pair.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION private.pause_reschedule_email_cutover() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
  RAISE EXCEPTION 'Schedule release in progress; retry shortly' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.pause_reschedule_email_cutover() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.pause_reschedule_email_cutover() TO service_role;
CREATE TRIGGER pause_reschedule_email_cutover BEFORE UPDATE OF scheduled_at ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION private.pause_reschedule_email_cutover();
COMMIT;
