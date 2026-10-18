-- ISOLATED LOCAL POSTGRES ONLY. Never run against a linked/production database.
-- Run once in a NEW database named exactly ardore_group_rls_test, with
-- ardore.isolated_sql_test=true and psql ON_ERROR_STOP=1. Existing Supabase
-- anon/authenticated/service_role roles are required. This fixture deliberately
-- models the affected live policies; it is not the complete application schema.
-- Identities are synthetic UUID claims. No GoTrue user rows are created/changed.
-- The final assertion MUST reproduce 42P17 before the repair is applied.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;

DO $$
BEGIN
  IF current_database() <> 'ardore_group_rls_test'
    OR current_setting('ardore.isolated_sql_test', true) IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Explicit disposable ardore_group_rls_test database required'; END IF;
  IF to_regnamespace('auth') IS NOT NULL OR to_regnamespace('private') IS NOT NULL
    OR to_regclass('public.creator_profiles') IS NOT NULL
    OR to_regclass('public.video_classes') IS NOT NULL
    OR to_regclass('public.video_class_bookings') IS NOT NULL
  THEN RAISE EXCEPTION 'Fixture requires an empty dedicated database; no existing objects will be replaced'; END IF;
  ASSERT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user),
    'Fixture/function owner must bypass RLS like the migration owner';
END;
$$;

CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.creator_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_published boolean NOT NULL
);
CREATE TABLE public.video_classes (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES public.creator_profiles(id),
  title text NOT NULL,
  active boolean NOT NULL
);
CREATE TABLE public.video_class_bookings (
  id uuid PRIMARY KEY,
  video_class_id uuid NOT NULL REFERENCES public.video_classes(id),
  user_id uuid NOT NULL,
  status text NOT NULL
);

-- Public coach, private coach, second public coach; actor UUIDs use 000...
-- while profile/class/booking UUIDs use 100.../200.../300... prefixes.
INSERT INTO public.creator_profiles VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Public fixture coach', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Private fixture coach', false),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Other public fixture coach', true);
INSERT INTO public.video_classes VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Public active', true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Public inactive enrolled', false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Private active unbooked', true),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Private inactive canceled enrollment', false),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'Private inactive foreign enrollment', false),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'Other public active', true),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'Other public inactive enrolled', false);
INSERT INTO public.video_class_bookings VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'confirmed'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', 'confirmed'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011', 'canceled'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', 'confirmed'),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 'confirmed'),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000012', 'confirmed');

-- Existing publication helpers bypass the profile/booking RLS graph. The full
-- production can_read_coach helper also recognizes other entitlement types;
-- this minimal fixture retains the owner/public/group-enrollment branches.
CREATE FUNCTION private.can_read_coach(p_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.creator_profiles c WHERE c.id = p_creator_id
      AND (c.is_published OR ((SELECT auth.uid()) IS NOT NULL AND (
        c.user_id = (SELECT auth.uid()) OR EXISTS (
          SELECT 1 FROM public.video_class_bookings vb
          JOIN public.video_classes vc ON vc.id = vb.video_class_id
          WHERE vc.creator_id = c.id AND vb.user_id = (SELECT auth.uid())
        )
      )))
  );
$$;
CREATE FUNCTION private.coach_is_public(p_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.creator_profiles
    WHERE id = p_creator_id AND is_published);
$$;
REVOKE ALL ON FUNCTION private.can_read_coach(uuid), private.coach_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_read_coach(uuid), private.coach_is_public(uuid)
  TO anon, authenticated, service_role;

ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_class_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_profiles_select_all ON public.creator_profiles
  FOR SELECT TO public USING (private.can_read_coach(id));
CREATE POLICY "Creators manage own video classes" ON public.video_classes
  FOR ALL TO public USING (creator_id = (
    SELECT cp.id FROM public.creator_profiles cp WHERE cp.user_id = auth.uid()
  ));
CREATE POLICY "Public can view active video classes" ON public.video_classes
  FOR SELECT TO public USING (
    (active AND private.coach_is_public(creator_id)) OR EXISTS (
      SELECT 1 FROM public.video_class_bookings vb
      WHERE vb.video_class_id = video_classes.id AND vb.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "Coaches see bookings for their classes" ON public.video_class_bookings
  FOR SELECT TO public USING (video_class_id IN (
    SELECT vc.id FROM public.video_classes vc WHERE vc.creator_id = (
      SELECT cp.id FROM public.creator_profiles cp WHERE cp.user_id = auth.uid()
    )
  ));
CREATE POLICY video_class_bookings_select_own ON public.video_class_bookings
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.creator_profiles, public.video_classes, public.video_class_bookings
  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.video_classes TO anon, authenticated;
GRANT ALL ON public.creator_profiles, public.video_classes, public.video_class_bookings TO service_role;
-- Browser enrollment mutations are server-controlled in the existing model.
REVOKE INSERT, UPDATE, DELETE ON public.video_class_bookings FROM PUBLIC, anon, authenticated;

SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM vc.id FROM public.video_classes vc
      JOIN public.creator_profiles cp ON cp.id = vc.creator_id WHERE vc.active;
    RAISE EXCEPTION 'Original marketplace query unexpectedly succeeded; recursion fixture is invalid';
  EXCEPTION WHEN SQLSTATE '42P17' THEN
    RAISE NOTICE 'Reproduced original marketplace RLS recursion (42P17)';
  END;
END;
$$;
RESET ROLE;
COMMIT;
