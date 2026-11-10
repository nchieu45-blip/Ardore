-- APPLY FIRST during the separately approved production cutover, before the
-- three older pending deletion migrations. This installs a closed gate only.
-- No customer row/file is updated or deleted. Never auto-enable this gate.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS private;

-- Refuse to silently replace a different API pre-request security hook.
DO $$
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'Release gate migration requires the reviewed postgres role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_db_role_setting s
    CROSS JOIN LATERAL unnest(s.setconfig) item
    WHERE s.setrole = 'authenticator'::regrole
      AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname=current_database()))
      AND item LIKE 'pgrst.db_pre_request=%'
      AND item <> 'pgrst.db_pre_request='
  ) THEN
    RAISE EXCEPTION 'Existing API request hook requires separate review';
  END IF;
END;
$$;

CREATE TABLE private.account_deletion_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  notification_dispatch_paused boolean NOT NULL DEFAULT true
);
ALTER TABLE private.account_deletion_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.account_deletion_release FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.account_deletion_release(singleton,enabled,notification_dispatch_paused) VALUES(true,false,true);

CREATE FUNCTION private.account_deletion_release_ready()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT enabled FROM private.account_deletion_release WHERE singleton),false);
$$;
REVOKE ALL ON FUNCTION private.account_deletion_release_ready() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.account_deletion_release_ready() TO service_role;
CREATE FUNCTION public.account_deletion_release_ready()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.account_deletion_release_ready();
$$;
REVOKE ALL ON FUNCTION public.account_deletion_release_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_release_ready() TO service_role;

CREATE FUNCTION private.enforce_account_deletion_request()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  verb text := current_setting('request.method',true);
  path text := btrim(coalesce(current_setting('request.path',true),''),'/');
  protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-ardore-account-deletion-protocol','');
  app_protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-ardore-service-protocol','');
BEGIN
  -- Freeze new durable notification claims during provider-key handover. Allow
  -- existing workers to complete/fail their previous claims for reconciliation.
  IF path IN ('rpc/claim_coaching_email','rpc/claim_group_reminder',
    'rpc/claim_current_group_reminder','rpc/claim_session_notification')
    AND coalesce((SELECT notification_dispatch_paused FROM private.account_deletion_release WHERE singleton),true) THEN
    RAISE EXCEPTION 'notification_dispatch_cutover_paused' USING ERRCODE='PT503';
  END IF;
  -- Retired builds cannot obtain the personal/provider references used by any
  -- historical deletion handler, even if restarted with fresh provider keys.
  -- This intentionally makes old service-backed features fail closed until
  -- the new marked application is deployed. Public/browser RLS reads stay intact.
  IF verb IN ('GET','HEAD') AND path IN ('profiles','creator_profiles','subscriptions','bookings')
    AND app_protocol<>'v2' THEN
    RAISE EXCEPTION 'retired_service_protocol' USING ERRCODE='PT503';
  END IF;
  -- Current legacy deletion always performs this HEAD before email/Stripe.
  -- Normal group payment/notification reads use GET and remain unchanged.
  IF (verb='HEAD' AND path='group_booking_reservations' AND protocol<>'v2')
    OR (path='rpc/begin_account_deletion' AND
      (app_protocol<>'v2' OR protocol<>'v2' OR NOT private.account_deletion_release_ready())) THEN
    RAISE EXCEPTION 'account_deletion_release_paused' USING ERRCODE='PT503';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_account_deletion_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_account_deletion_request() TO service_role;

-- Invoker wrapper exposes no privileged operation to browser roles. Only an
-- authenticated service role can reach the private checker. The header is a
-- protocol/version marker, not a credential or an authorization mechanism.
CREATE FUNCTION public.account_deletion_request_gate()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' THEN
    PERFORM private.enforce_account_deletion_request();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_request_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_deletion_request_gate() TO anon,authenticated,service_role;

CREATE FUNCTION private.reject_legacy_account_row_deletes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- New deletion uses the GoTrue transaction and FK cascades, never REST
  -- deletes. Statement-level validation also rejects deletes matching no rows.
  -- Browser-owned CRUD and non-REST, privileged operator SQL are unaffected.
  IF current_setting('request.method',true)='DELETE'
    AND coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' THEN
    RAISE EXCEPTION 'legacy_account_row_delete_disabled' USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reject_legacy_account_row_deletes() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.require_account_deletion_protocol()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE armed boolean := false;
BEGIN
  -- Same account lock as the pending write barrier. Acquire BEFORE checking
  -- the durable arm, so concurrent writers/deleters cannot use a stale snapshot.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'account_deletion_isolation_unsupported' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ardore-account-write:' || OLD.id::text,0));
  IF NOT private.account_deletion_release_ready() THEN
    RAISE EXCEPTION 'account_deletion_release_paused' USING ERRCODE='55000';
  END IF;
  IF to_regclass('private.account_deletion_barriers') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM private.account_deletion_barriers WHERE user_id=$1 AND auth_started AND lease_until>clock_timestamp())'
      INTO armed USING OLD.id;
  END IF;
  IF NOT armed THEN
    RAISE EXCEPTION 'account_deletion_requires_protocol' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.require_account_deletion_protocol() FROM PUBLIC,anon,authenticated,service_role;

-- DDL takes bounded locks and commits all defenses together. Failure rolls back
-- this entire migration. It cannot undo statements committed before activation.
LOCK TABLE auth.users, public.profiles, public.availability_slots, public.bookings,
  public.coaching_offers, public.creator_profiles, public.date_overrides,
  public.messages, public.products, public.purchases, public.reviews,
  public.subscription_tiers, public.subscriptions IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['profiles','availability_slots','bookings',
    'coaching_offers','creator_profiles','date_overrides','messages','products',
    'purchases','reviews','subscription_tiers','subscriptions'] LOOP
    EXECUTE format('CREATE TRIGGER reject_legacy_account_row_deletes BEFORE DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.reject_legacy_account_row_deletes()',target);
  END LOOP;
END;
$$;
-- Guard Auth itself, including accounts whose profile is already missing.
-- This only validates a GoTrue Admin deletion; it never mutates auth.users.
CREATE TRIGGER require_account_deletion_protocol BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.require_account_deletion_protocol();

DO $$
BEGIN
  EXECUTE format('ALTER ROLE authenticator IN DATABASE %I SET pgrst.db_pre_request = %L',
    current_database(),'public.account_deletion_request_gate');
END;
$$;
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
COMMIT;
