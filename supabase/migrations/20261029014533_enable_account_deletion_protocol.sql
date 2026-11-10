-- APPLY LAST, only with separate production approval after the new application,
-- provider-key retirement and ambiguous provider/email work are verified.
-- This is not a substitute for those operational checks. Never batch-push the
-- pending migrations: the release gate must be installed FIRST and stay closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE target text; changed integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Protocol activation requires the reviewed postgres role';
  END IF;
  IF to_regclass('private.account_deletion_release') IS NULL
    OR to_regclass('private.account_deletion_barriers') IS NULL THEN
    RAISE EXCEPTION 'Deletion release prerequisites are missing';
  END IF;
  FOREACH target IN ARRAY ARRAY[
    'public.account_deletion_release_ready()',
    'public.account_deletion_storage_clear(uuid)',
    'public.begin_account_deletion(uuid)',
    'public.mark_account_deletion_auth(uuid,uuid)',
    'public.release_account_deletion(uuid,uuid)'
  ] LOOP
    IF to_regprocedure(target) IS NULL THEN
      RAISE EXCEPTION 'Deletion release RPC is missing';
    END IF;
    IF has_function_privilege('anon',target,'EXECUTE')
      OR has_function_privilege('authenticated',target,'EXECUTE')
      OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
      RAISE EXCEPTION 'Deletion release RPC permissions are unsafe';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) item
    WHERE s.setrole='authenticator'::regrole
      AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND item='pgrst.db_pre_request=public.account_deletion_request_gate'
  ) THEN RAISE EXCEPTION 'Deletion request hook is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['profiles','availability_slots','bookings',
      'coaching_offers','creator_profiles','date_overrides','messages','products',
      'purchases','reviews','subscription_tiers','subscriptions']) AS tables(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.'||tables.name)
        AND t.tgname='reject_legacy_account_row_deletes' AND t.tgenabled='O'
        AND t.tgfoid='private.reject_legacy_account_row_deletes()'::regprocedure)
  ) OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
      AND tgname='require_account_deletion_protocol' AND tgenabled='O'
      AND tgfoid='private.require_account_deletion_protocol()'::regprocedure)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
      AND tgname='guard_account_storage_deletion' AND tgenabled='O')
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass
      AND tgname='guard_account_storage_write' AND tgenabled='O')
    OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND t.tgname='guard_account_record_write'
        AND t.tgenabled='O') <> 12 THEN
    RAISE EXCEPTION 'Deletion validation or write guards are missing';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('public_profiles','public_product_reviews','public_session_reviews')
      AND c.reloptions @> ARRAY['security_invoker=true','security_barrier=true']) <> 3 THEN
    RAISE EXCEPTION 'Reviewed public view projections are missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
    WHERE oid='private.account_deletion_release'::regclass)
    OR has_table_privilege('service_role','private.account_deletion_release','UPDATE')
    OR has_table_privilege('anon','private.account_deletion_release','SELECT')
    OR has_table_privilege('authenticated','private.account_deletion_release','UPDATE') THEN
    RAISE EXCEPTION 'Release switch permissions are unsafe';
  END IF;
  UPDATE private.account_deletion_release
    SET enabled=true, notification_dispatch_paused=false
    WHERE singleton AND NOT enabled AND notification_dispatch_paused;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Expected exactly one closed release switch'; END IF;
END;
$$;
COMMIT;
