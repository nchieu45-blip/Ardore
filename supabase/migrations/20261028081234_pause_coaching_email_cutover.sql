-- Temporary release gate. Paired with resume_coaching_email_cutover.
-- Reject rather than wait: API callers can retry after the deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION private.pause_coaching_email_cutover() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
    OR NEW.amount_refunded_cents IS DISTINCT FROM OLD.amount_refunded_cents THEN
    RAISE EXCEPTION 'Coaching email release in progress; retry shortly' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.pause_coaching_email_cutover() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.pause_coaching_email_cutover() TO service_role;
CREATE TRIGGER pause_individual_coaching_email_cutover BEFORE UPDATE OF status, amount_refunded_cents
  ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.pause_coaching_email_cutover();
CREATE TRIGGER pause_group_coaching_email_cutover BEFORE UPDATE OF status, amount_refunded_cents
  ON public.video_class_bookings FOR EACH ROW EXECUTE FUNCTION private.pause_coaching_email_cutover();
COMMIT;
