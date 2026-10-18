-- ISOLATED LOCAL POSTGRES ONLY. Requires group_marketplace_rls_setup.sql, then
-- the actual group marketplace RLS repair migration. Run with ON_ERROR_STOP=1
-- and ardore.isolated_sql_test=true in exactly ardore_group_rls_test.
-- All mutations roll back, so assertions can run again after migration reapply.
-- This proves PostgreSQL RLS behavior, not GoTrue/Auth FK integration.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;
DO $$
DECLARE role_name text; operation text;
BEGIN
  IF current_database() <> 'ardore_group_rls_test'
    OR current_setting('ardore.isolated_sql_test', true) IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Explicit disposable ardore_group_rls_test database required'; END IF;
  ASSERT (SELECT count(*) = 7 FROM public.video_classes), 'Known isolated class fixtures required';
  ASSERT (SELECT count(*) = 6 FROM public.video_class_bookings), 'Known isolated booking fixtures required';
  ASSERT (SELECT prosecdef AND provolatile = 's' AND pronargs = 1
      AND proconfig @> ARRAY['search_path=""']
    FROM pg_proc WHERE oid = 'private.has_own_video_class_booking(uuid)'::regprocedure),
    'Helper is stable, security definer, identity-bound, with an empty search path';
  ASSERT (SELECT owner.rolbypassrls FROM pg_proc function
    JOIN pg_roles owner ON owner.oid = function.proowner
    WHERE function.oid = 'private.has_own_video_class_booking(uuid)'::regprocedure),
    'Helper owner bypasses RLS so the lookup cannot re-enter the caller policies';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'private.has_own_video_class_booking(uuid)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'PUBLIC does not inherit helper execution';
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    ASSERT has_function_privilege(role_name, 'private.has_own_video_class_booking(uuid)', 'EXECUTE'),
      'Existing API roles can evaluate the SELECT policy';
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ASSERT NOT has_schema_privilege(role_name, 'private', 'CREATE'),
      'Browser roles cannot replace private policy helpers';
    FOREACH operation IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      ASSERT NOT has_table_privilege(role_name, 'public.video_class_bookings', operation),
        'Browser booking write grants remain revoked';
    END LOOP;
  END LOOP;
  ASSERT (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'video_classes'),
    'Repair preserves the existing owner policy without adding broad policies';
  ASSERT (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'video_class_bookings'),
    'Repair preserves existing enrollment SELECT policies';
END;
$$;

SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $$
DECLARE affected bigint;
BEGIN
  ASSERT auth.uid() IS NULL, 'Anonymous fixture has no actor identity';
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid
  ] FROM public.video_classes), 'Anonymous visitors see active classes of published coaches only';
  ASSERT (SELECT count(*) = 2 FROM public.video_classes vc
    JOIN public.creator_profiles cp ON cp.id = vc.creator_id WHERE vc.active),
    'Actual marketplace class/profile join works without RLS recursion';
  ASSERT (SELECT count(*) = 2 FROM public.creator_profiles), 'Private coach profile remains anonymous-hidden';
  ASSERT (SELECT count(*) = 0 FROM public.video_class_bookings), 'Anonymous enrollment rows remain hidden';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Anonymous caller cannot infer a participant enrollment';
  ASSERT NOT private.has_own_video_class_booking(NULL), 'NULL class is false';
  BEGIN
    INSERT INTO public.video_classes VALUES ('20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000001', 'Denied anonymous class', false);
    RAISE EXCEPTION 'Anonymous class insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.video_classes SET title = 'Denied anonymous edit'
    WHERE id = '20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'RLS prevents anonymous UPDATE despite existing table grants';
  DELETE FROM public.video_classes WHERE id = '20000000-0000-0000-0000-000000000006';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'RLS prevents anonymous DELETE despite existing table grants';
  BEGIN
    INSERT INTO public.video_class_bookings VALUES ('30000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'confirmed');
    RAISE EXCEPTION 'Anonymous booking insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.video_class_bookings SET status = status WHERE false;
    RAISE EXCEPTION 'Anonymous booking update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.video_class_bookings WHERE false;
    RAISE EXCEPTION 'Anonymous booking delete unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

-- An authenticated role without a subject must not acquire enrollment access.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT auth.uid() IS NULL, 'Missing authenticated subject stays NULL';
  ASSERT (SELECT count(*) = 2 FROM public.video_classes), 'Missing subject sees public classes only';
  ASSERT (SELECT count(*) = 0 FROM public.video_class_bookings), 'Missing subject sees no enrollment rows';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Authenticated role alone never grants enrollment access';
END;
$$;
RESET ROLE;

-- Ordinary signed-in visitor has no enrollment or coaching profile.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected bigint;
BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid
  ] FROM public.video_classes), 'Ordinary signed-in visitors retain the same public class boundary';
  ASSERT (SELECT count(*) = 0 FROM public.video_class_bookings), 'Ordinary visitor sees no enrollment identities';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Helper never accepts another actor identity';
  ASSERT NOT private.has_own_video_class_booking('ffffffff-ffff-ffff-ffff-ffffffffffff'),
    'Unknown class has no own enrollment';
  UPDATE public.video_classes SET title = 'Denied stranger edit'
    WHERE id = '20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'Public class visibility does not grant stranger UPDATE';
  DELETE FROM public.video_classes WHERE id = '20000000-0000-0000-0000-000000000006';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'Public class visibility does not grant stranger DELETE';
  BEGIN
    INSERT INTO public.video_classes VALUES ('20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000001', 'Denied stranger class', false);
    RAISE EXCEPTION 'Stranger class insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

-- Participant keeps access to confirmed inactive and canceled/private classes.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000002'::uuid,
    '20000000-0000-0000-0000-000000000004'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid
  ] FROM public.video_classes), 'Participant retains own enrollments without exposing foreign/private classes';
  ASSERT (SELECT count(*) = 3 AND bool_and(user_id = auth.uid()) FROM public.video_class_bookings),
    'Participant sees only own enrollment rows';
  ASSERT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000002'),
    'Confirmed inactive enrollment is recognized';
  ASSERT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Canceled enrollment retains the pre-existing visibility contract';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000005'),
    'Same private coach does not expose another participant class';
  ASSERT (SELECT count(*) = 1 FROM public.video_classes vc
    JOIN public.creator_profiles cp ON cp.id = vc.creator_id
    JOIN public.video_class_bookings vb ON vb.video_class_id = vc.id
    WHERE vc.id = '20000000-0000-0000-0000-000000000004'
      AND NOT vc.active AND NOT cp.is_published AND vb.status = 'canceled'),
    'Enrollment/private-coach/class join remains readable for the actual participant';
  BEGIN
    INSERT INTO public.video_class_bookings VALUES ('30000000-0000-0000-0000-000000000090',
      '20000000-0000-0000-0000-000000000006', auth.uid(), 'confirmed');
    RAISE EXCEPTION 'Participant booking insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.video_class_bookings SET status = 'confirmed'
      WHERE id = '30000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'Participant booking update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.video_class_bookings WHERE id = '30000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'Participant booking delete unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

-- Change only JWT identity: a second participant gets a different private set.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000005'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid,
    '20000000-0000-0000-0000-000000000007'::uuid
  ] FROM public.video_classes), 'Second participant receives only their own enrollment extensions';
  ASSERT (SELECT count(*) = 3 AND bool_and(user_id = auth.uid()) FROM public.video_class_bookings),
    'Second participant cannot read the first participant booking';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Helper result changes with current JWT identity';
  ASSERT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000005'),
    'Second participant own private enrollment is recognized';
END;
$$;
RESET ROLE;

-- Public coach can manage own classes and see their actual participants.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected bigint;
BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000002'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid
  ] FROM public.video_classes), 'Coach keeps own inactive classes plus public discovery';
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '30000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000002'::uuid,
    '30000000-0000-0000-0000-000000000005'::uuid
  ] FROM public.video_class_bookings), 'Coach sees all own class participants and no foreign enrollments';
  INSERT INTO public.video_classes VALUES ('20000000-0000-0000-0000-000000000090',
    '10000000-0000-0000-0000-000000000001', 'Owned CRUD fixture', false);
  ASSERT (SELECT count(*) = 1 FROM public.video_classes
    WHERE id = '20000000-0000-0000-0000-000000000090'), 'Owner INSERT/SELECT remain available';
  UPDATE public.video_classes SET title = 'Edited owned fixture', active = true
    WHERE id = '20000000-0000-0000-0000-000000000090';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Owner UPDATE remains available';
  ASSERT (SELECT active AND title = 'Edited owned fixture' FROM public.video_classes
    WHERE id = '20000000-0000-0000-0000-000000000090'), 'Owned class changes were stored';
  DELETE FROM public.video_classes WHERE id = '20000000-0000-0000-0000-000000000090';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Owner DELETE remains available';
  UPDATE public.video_classes SET title = 'Denied foreign coach edit'
    WHERE id = '20000000-0000-0000-0000-000000000006';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'Coach cannot update another published coach class';
  DELETE FROM public.video_classes WHERE id = '20000000-0000-0000-0000-000000000006';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'Coach cannot delete another published coach class';
  BEGIN
    INSERT INTO public.video_classes VALUES ('20000000-0000-0000-0000-000000000090',
      '10000000-0000-0000-0000-000000000002', 'Denied foreign class', false);
    RAISE EXCEPTION 'Foreign coach class insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.video_classes SET creator_id = '10000000-0000-0000-0000-000000000003'
      WHERE id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Coach could transfer ownership to another profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT creator_id = '10000000-0000-0000-0000-000000000001'::uuid
    FROM public.video_classes WHERE id = '20000000-0000-0000-0000-000000000002'),
    'Failed foreign ownership mutation preserved the row';
  BEGIN
    UPDATE public.video_class_bookings SET status = status
      WHERE id = '30000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Coach browser booking write unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '20000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000003'::uuid,
    '20000000-0000-0000-0000-000000000004'::uuid,
    '20000000-0000-0000-0000-000000000005'::uuid,
    '20000000-0000-0000-0000-000000000006'::uuid
  ] FROM public.video_classes), 'Unpublished coach retains all own active/inactive classes';
  ASSERT (SELECT array_agg(id ORDER BY id) = ARRAY[
    '30000000-0000-0000-0000-000000000003'::uuid,
    '30000000-0000-0000-0000-000000000004'::uuid
  ] FROM public.video_class_bookings), 'Unpublished coach retains own class participants only';
  ASSERT NOT private.has_own_video_class_booking('20000000-0000-0000-0000-000000000004'),
    'Ownership itself is not confused with an enrollment by the helper';
END;
$$;
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT count(*) = 7 FROM public.video_classes), 'Read/CRUD assertions preserve fixture classes';
  ASSERT (SELECT count(*) = 6 FROM public.video_class_bookings), 'No enrollment rows were changed';
  ASSERT (SELECT status = 'canceled' FROM public.video_class_bookings
    WHERE id = '30000000-0000-0000-0000-000000000003'), 'Canceled enrollment status remains unchanged';
  RAISE NOTICE 'Group marketplace RLS assertions passed for anonymous, ordinary visitor, both participants and both coach roles';
END;
$$;
ROLLBACK;
