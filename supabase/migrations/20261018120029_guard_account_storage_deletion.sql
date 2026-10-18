-- No customer data is updated/deleted. Apply only after separate approval.
-- GoTrue versions differ in their treatment of Storage ownership. Fail closed
-- before Stripe calls and again inside the existing Auth -> profiles cascade.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE FUNCTION private.account_owns_storage(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.owner_id = p_user_id::text OR object.owner = p_user_id
  );
$$;
REVOKE ALL ON FUNCTION private.account_owns_storage(uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.account_owns_storage(uuid) TO service_role;

-- Only the trusted server can ask this yes/no question. No object names, user
-- details or credentials are returned; no new browser permission is granted.
CREATE FUNCTION public.account_deletion_storage_clear(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT NOT private.account_owns_storage(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.account_deletion_storage_clear(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_storage_clear(uuid) TO service_role;

CREATE FUNCTION private.guard_account_storage_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- OLD.id is supplied by the FK cascade, never a browser-controlled argument.
  IF private.account_owns_storage(OLD.id) THEN
    RAISE EXCEPTION 'account_storage_requires_review' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_account_storage_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_account_storage_deletion
BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.guard_account_storage_deletion();

COMMIT;
