-- Apply only after separately verified provider cutover and old-key retirement.
-- This file does not prove external provider state or authorize its own release.
-- Resume existing claims only; retain the closed account-deletion gate.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE deletion_enabled boolean; dispatch_paused boolean;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Notification resume requires the reviewed postgres role';
  END IF;
  SELECT enabled,notification_dispatch_paused INTO deletion_enabled,dispatch_paused
    FROM private.account_deletion_release WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Release gate missing'; END IF;
  -- Already resumed (including a fresh install after full activation): no-op.
  IF NOT dispatch_paused THEN RETURN; END IF;
  IF deletion_enabled THEN RAISE EXCEPTION 'Account deletion must remain closed'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
      AND tgname IN ('require_account_deletion_protocol','reject_legacy_account_row_deletes')) <> 13
    OR NOT EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) item
      WHERE s.setrole='authenticator'::regrole
        AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND item='pgrst.db_pre_request=public.account_deletion_request_gate') THEN
    RAISE EXCEPTION 'Existing account-deletion safeguards must remain installed';
  END IF;
  LOCK TABLE public.coaching_email_deliveries, public.group_reminder_deliveries,
  public.session_notification_deliveries IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.coaching_email_deliveries
      WHERE state IN ('processing','held') OR (first_attempt_at IS NOT NULL AND state <> 'sent'))
    OR EXISTS (SELECT 1 FROM public.group_reminder_deliveries
      WHERE state IN ('processing','held') OR (first_attempt_at IS NOT NULL AND state <> 'sent'))
    OR EXISTS (SELECT 1 FROM public.session_notification_deliveries
      WHERE state IN ('processing','held') OR (first_attempt_at IS NOT NULL AND state NOT IN ('sent','legacy_skipped'))) THEN
    RAISE EXCEPTION 'Unresolved notification attempts require provider reconciliation';
  END IF;
  UPDATE private.account_deletion_release SET notification_dispatch_paused=false
    WHERE singleton AND NOT enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closed release gate missing'; END IF;
END;
$$;
COMMIT;
