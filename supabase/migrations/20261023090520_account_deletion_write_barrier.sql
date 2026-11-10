-- Pending: apply only after separate production approval. No existing rows or
-- files are changed. Storage triggers are supported; never write its metadata.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A tombstone deliberately survives Auth/profile deletion. Lease expiry permits
-- another deletion worker, NEVER new writes. Only opaque account/attempt IDs and
-- control state; no emails, credentials, document names or financial payloads.
CREATE TABLE private.account_deletion_barriers (
  user_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  auth_started boolean NOT NULL DEFAULT false
);
ALTER TABLE private.account_deletion_barriers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.account_deletion_barriers FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.lock_account_writes(p_users uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'account_write_isolation_unsupported' USING ERRCODE = '55000';
  END IF;
  -- Transaction locks only, ordered for buyer/coach pairs. Never span HTTP calls.
  FOR account_id IN SELECT DISTINCT id FROM unnest(p_users) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ardore-account-write:' || account_id::text, 0));
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_account_writes(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.require_writable_accounts(p_users uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_id uuid;
BEGIN
  PERFORM private.lock_account_writes(p_users);
  -- Fresh snapshots after waiting are essential. These functions must NOT be
  -- STABLE: a concurrent delete/transition may have committed while we waited.
  FOR account_id IN SELECT DISTINCT id FROM unnest(p_users) AS ids(id) WHERE id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = account_id)
      OR EXISTS (SELECT 1 FROM private.account_deletion_barriers WHERE user_id = account_id) THEN
      RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.require_writable_accounts(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- Service-only lifecycle API. The caller is the server's verified Auth user,
-- never a browser-provided target. Privileged work stays in the private schema.
CREATE FUNCTION private.begin_account_deletion(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempt uuid := gen_random_uuid(); previous private.account_deletion_barriers%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END IF;
  PERFORM private.lock_account_writes(ARRAY[p_user_id]);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO previous FROM private.account_deletion_barriers WHERE user_id = p_user_id;
  IF FOUND AND previous.lease_until > clock_timestamp() THEN
    RAISE EXCEPTION 'account_deletion_in_progress' USING ERRCODE = '55000';
  END IF;
  INSERT INTO private.account_deletion_barriers(user_id, attempt_id, lease_until)
    VALUES (p_user_id, attempt, clock_timestamp() + interval '5 minutes')
    ON CONFLICT (user_id) DO UPDATE SET attempt_id = EXCLUDED.attempt_id, lease_until = EXCLUDED.lease_until;
  -- auth_started is monotonic across retries. An ambiguous Auth call must never
  -- reopen writes, including when a later worker fails before its own Auth call.
  RETURN attempt;
END;
$$;
CREATE FUNCTION private.mark_account_deletion_auth(p_user_id uuid, p_attempt_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.lock_account_writes(ARRAY[p_user_id]);
  UPDATE private.account_deletion_barriers SET auth_started = true
    WHERE user_id = p_user_id AND attempt_id = p_attempt_id AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;
CREATE FUNCTION private.release_account_deletion(p_user_id uuid, p_attempt_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.lock_account_writes(ARRAY[p_user_id]);
  DELETE FROM private.account_deletion_barriers
    WHERE user_id = p_user_id AND attempt_id = p_attempt_id AND NOT auth_started;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION private.begin_account_deletion(uuid), private.mark_account_deletion_auth(uuid,uuid), private.release_account_deletion(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.begin_account_deletion(uuid), private.mark_account_deletion_auth(uuid,uuid), private.release_account_deletion(uuid,uuid) TO service_role;

CREATE FUNCTION public.begin_account_deletion(p_user_id uuid)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.begin_account_deletion(p_user_id); $$;
CREATE FUNCTION public.mark_account_deletion_auth(p_user_id uuid, p_attempt_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.mark_account_deletion_auth(p_user_id,p_attempt_id); $$;
CREATE FUNCTION public.release_account_deletion(p_user_id uuid, p_attempt_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.release_account_deletion(p_user_id,p_attempt_id); $$;
REVOKE ALL ON FUNCTION public.begin_account_deletion(uuid), public.mark_account_deletion_auth(uuid,uuid), public.release_account_deletion(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(uuid), public.mark_account_deletion_auth(uuid,uuid), public.release_account_deletion(uuid,uuid) TO service_role;

CREATE FUNCTION private.guard_account_record_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data jsonb := to_jsonb(NEW); buyer uuid; creator uuid; coach_user uuid;
BEGIN
  buyer := (row_data->>TG_ARGV[0])::uuid;
  creator := (row_data->>TG_ARGV[1])::uuid;
  IF TG_TABLE_NAME = 'purchases' THEN
    SELECT creator_id INTO creator FROM public.products WHERE id = NEW.product_id;
    IF creator IS NULL THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END IF;
  ELSIF TG_TABLE_NAME IN ('video_class_bookings', 'video_class_occurrences') THEN
    SELECT creator_id INTO creator FROM public.video_classes WHERE id = NEW.video_class_id;
    IF creator IS NULL THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END IF;
  END IF;
  IF creator IS NOT NULL THEN
    SELECT user_id INTO coach_user FROM public.creator_profiles WHERE id = creator;
    IF coach_user IS NULL THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END IF;
  END IF;
  PERFORM private.require_writable_accounts(ARRAY[buyer, coach_user]);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_account_record_write() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.payment_settlements FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.coaching_payment_attempts FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.discount_redemptions FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,product_id ON public.purchases FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF user_id,video_class_id ON public.video_class_bookings FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('user_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF creator_id ON public.verification_requests FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF user_id ON public.creator_profiles FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('user_id','unused_creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF buyer_id,creator_id ON public.group_booking_reservations FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('buyer_id','creator_id');
CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF video_class_id ON public.video_class_occurrences FOR EACH ROW EXECUTE FUNCTION private.guard_account_record_write('unused_buyer_id','creator_id');

-- Supported Storage validation hook: no managed functions/tables are replaced,
-- no metadata is manually inserted/updated/deleted. Includes service-role uploads
-- that bypass RLS and stale user JWTs. Existing folder policies still authorize.
CREATE FUNCTION private.guard_account_storage_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_user uuid; folder_user uuid; prefix text := split_part(NEW.name,'/',1);
BEGIN
  owner_user := COALESCE(NULLIF(NEW.owner_id,'' )::uuid, NEW.owner);
  IF NEW.bucket_id IN ('verification-docs','products','thumbnails','profile-images') THEN
    SELECT user_id INTO folder_user FROM public.creator_profiles WHERE id::text = prefix;
    IF folder_user IS NULL THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END IF;
  ELSIF NEW.bucket_id = 'avatars' THEN
    BEGIN folder_user := prefix::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'account_write_blocked' USING ERRCODE = '55000'; END;
  END IF;
  PERFORM private.require_writable_accounts(ARRAY[owner_user, NEW.owner, folder_user]);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_account_storage_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_account_storage_write BEFORE INSERT OR UPDATE OF name,bucket_id,owner_id,owner ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.guard_account_storage_write();

-- Include every Ardore folder convention, not only today's service-uploaded
-- verification files. Public assets still count as stored account data.
CREATE OR REPLACE FUNCTION private.account_owns_storage(p_user_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.owner_id = p_user_id::text OR object.owner = p_user_id
      OR (object.bucket_id = 'avatars' AND split_part(object.name,'/',1) = p_user_id::text)
      OR (object.bucket_id IN ('verification-docs','products','thumbnails','profile-images') AND EXISTS (
        SELECT 1 FROM public.creator_profiles AS creator
        WHERE creator.user_id = p_user_id AND split_part(object.name,'/',1) = creator.id::text
      ))
  );
$$;

-- Final transaction boundary, also protecting direct Auth Admin deletion. Reads
-- run after the same advisory lock as every writer, so writer-first commits are
-- rechecked, and delete-first writers see a missing profile and fail closed.
CREATE OR REPLACE FUNCTION private.guard_account_storage_deletion()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE creator uuid;
BEGIN
  PERFORM private.lock_account_writes(ARRAY[OLD.id]);
  IF private.account_owns_storage(OLD.id) THEN
    RAISE EXCEPTION 'account_storage_requires_review' USING ERRCODE = '23503';
  END IF;
  SELECT id INTO creator FROM public.creator_profiles WHERE user_id = OLD.id;
  IF EXISTS(SELECT 1 FROM public.payment_orders WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.payment_settlements WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.coaching_payment_attempts WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.discount_redemptions WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.bookings WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.group_booking_reservations WHERE buyer_id=OLD.id OR creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.video_class_occurrences o JOIN public.video_classes c ON c.id=o.video_class_id WHERE c.creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.purchases p JOIN public.products product ON product.id=p.product_id WHERE p.buyer_id=OLD.id OR product.creator_id=creator)
    OR EXISTS(SELECT 1 FROM public.video_class_bookings b JOIN public.video_classes c ON c.id=b.video_class_id WHERE b.user_id=OLD.id OR c.creator_id=creator) THEN
    RAISE EXCEPTION 'account_records_require_review' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

COMMIT;
