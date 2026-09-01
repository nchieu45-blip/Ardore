-- Run after migrations with: supabase test db supabase/tests/021_access_boundaries_test.sql
-- Catalog-level checks require no fixture users and never touch auth.users.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(37);

SELECT ok(NOT has_table_privilege('anon', 'public.purchases', 'INSERT'), 'anon cannot forge purchases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'INSERT'), 'customers cannot forge purchases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'UPDATE'), 'customers cannot update purchases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'DELETE'), 'customers cannot delete purchases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'TRUNCATE'), 'customers cannot truncate purchases');
SELECT policies_are('public', 'purchases', ARRAY['purchases_select_own'], 'purchases expose only the own-row read policy');

SELECT ok(has_table_privilege('authenticated', 'public.reviews', 'INSERT'), 'authenticated buyers may attempt a review');
SELECT policies_are(
  'public', 'reviews',
  ARRAY['reviews_delete_own', 'reviews_insert_purchaser', 'reviews_select_own', 'reviews_update_own'],
  'review operations are owner/entitlement scoped'
);
SELECT ok(
  (SELECT with_check ILIKE '%purchases%' AND with_check ILIKE '%auth.uid%'
   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews' AND policyname = 'reviews_insert_purchaser'),
  'review insertion requires an authenticated purchase'
);
SELECT ok(NOT has_table_privilege('anon', 'public.reviews', 'SELECT'), 'anonymous users cannot read raw buyer-linked reviews');
SELECT ok(NOT has_table_privilege('anon', 'public.reviews', 'INSERT'), 'anonymous users cannot insert reviews');
SELECT ok(NOT has_table_privilege('authenticated', 'public.reviews', 'TRUNCATE'), 'customers cannot truncate reviews');
SELECT ok(has_table_privilege('anon', 'public.public_product_reviews', 'SELECT'), 'anonymous users can read safe review projection');

SELECT ok(NOT has_table_privilege('anon', 'public.bookings', 'INSERT'), 'anonymous users cannot insert bookings directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bookings', 'INSERT'), 'customers cannot insert bookings directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bookings', 'UPDATE'), 'participants cannot manipulate booking state directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bookings', 'DELETE'), 'participants cannot delete bookings directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.bookings', 'TRUNCATE'), 'participants cannot truncate bookings');

SELECT ok(NOT has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anonymous users cannot read private profiles');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), 'users cannot truncate profiles');
SELECT ok(NOT has_table_privilege('anon', 'public.public_profiles', 'SELECT'), 'anonymous users cannot enumerate customer identities');
SELECT ok(has_table_privilege('authenticated', 'public.public_profiles', 'SELECT'), 'authenticated chat users can resolve display identities');
SELECT policies_are('public', 'profiles', ARRAY['profiles_select_own', 'profiles_update_own'], 'base profiles are owner-scoped');
SELECT columns_are(
  'public', 'public_profiles', ARRAY['id', 'full_name', 'avatar_url', 'role'],
  'public profile projection contains only intended presentation fields'
);
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('public_profiles', 'public_product_reviews', 'public_session_reviews')
    AND column_name IN ('email', 'buyer_id', 'is_admin')
), 'public projections expose no email, buyer ID, or admin flag');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'products_upload_creator' AND with_check ILIKE '%creator_profiles%'
), 'private product uploads are creator-folder scoped');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'products_download_entitled' AND qual ILIKE '%purchases%' AND qual ILIKE '%file_url%'
), 'private product reads require creator ownership or exact purchased product entitlement');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'thumbnails_upload_creator' AND with_check ILIKE '%creator_profiles%'
), 'thumbnail writes are creator-folder scoped');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'profile_images_insert_creator' AND with_check ILIKE '%creator_profiles%'
), 'profile image writes are creator-folder scoped');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('Users can upload profile images', 'Users can update their profile images', 'Users can delete their profile images')
), 'permissive deployed profile-image write policies are removed');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN (
      'products: authenticated upload own folder', 'products: authenticated read own folder',
      'products: authenticated delete own folder', 'thumbnails: authenticated upload own folder',
      'thumbnails: authenticated delete own folder', 'profile-images: authenticated upload own folder',
      'profile-images: authenticated update own folder', 'profile-images: authenticated delete own folder'
    )
), 'legacy user-ID folder policies are removed in favor of creator-ID ownership');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'profile_images_update_creator' AND qual ILIKE '%creator_profiles%'
), 'profile image updates are creator-folder scoped');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'profile_images_delete_creator' AND qual ILIKE '%creator_profiles%'
), 'profile image deletes are creator-folder scoped');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'profile_images_select_public' AND qual ILIKE '%profile-images%'
), 'public profile images remain readable and upsert-compatible');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
    WHERE procedure.oid = 'public.get_public_product_sales_counts(uuid[])'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute sales-count RPC'
);
SELECT ok(has_function_privilege('anon', 'public.get_public_product_sales_counts(uuid[])', 'EXECUTE'), 'anon can execute safe sales-count RPC');
SELECT ok(has_function_privilege('authenticated', 'public.get_public_product_sales_counts(uuid[])', 'EXECUTE'), 'authenticated can execute safe sales-count RPC');

SELECT * FROM finish();
ROLLBACK;
