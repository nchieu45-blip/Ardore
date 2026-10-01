-- Read-only catalog assertions. No users, data, settings or prices are changed.
WITH forbidden_creator_columns AS (
  SELECT role_name, column_name, operation
  FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
  CROSS JOIN (VALUES ('stripe_account_id'), ('stripe_account_active'), ('is_verified'), ('verified_at'), ('is_demo')) cols(column_name)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(operation)
  UNION ALL
  SELECT role_name, 'id', operation
  FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(operation)
  UNION ALL SELECT 'authenticated', 'user_id', 'UPDATE'
), protected_records AS (
  SELECT role_name, table_name, a.attname::text AS column_name, operation
  FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
  CROSS JOIN (VALUES ('subscriptions'), ('video_class_bookings'), ('verification_requests'), ('purchases'), ('bookings')) tables(table_name)
  JOIN pg_attribute a ON a.attrelid = ('public.' || table_name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(operation)
), commercial_columns AS (
  SELECT table_name, column_name, operation
  FROM (VALUES
    ('products', 'price'), ('products', 'title'), ('products', 'description'), ('products', 'duration'),
    ('products', 'file_url'), ('products', 'is_published'),
    ('subscription_tiers', 'price_monthly'), ('subscription_tiers', 'name'), ('subscription_tiers', 'description'),
    ('subscription_tiers', 'features'), ('subscription_tiers', 'is_active'),
    ('subscription_tiers', 'included_video_sessions'), ('subscription_tiers', 'included_session_duration_minutes'),
    ('coaching_offers', 'price_cents'), ('coaching_offers', 'duration_minutes'), ('coaching_offers', 'description'),
    ('coaching_offers', 'is_enabled'), ('coaching_offers', 'buffer_minutes'), ('coaching_offers', 'min_notice_hours'),
    ('coaching_offers', 'max_horizon_days'), ('coaching_offers', 'cancellation_policy_hours'),
    ('video_classes', 'price_cents'), ('video_classes', 'title'), ('video_classes', 'description'),
    ('video_classes', 'starts_at'), ('video_classes', 'duration_minutes'), ('video_classes', 'max_participants'),
    ('video_classes', 'included_in_subscription'), ('video_classes', 'active'),
    ('date_overrides', 'type'), ('date_overrides', 'start_time'), ('date_overrides', 'end_time'),
    ('availability_slots', 'start_time'), ('availability_slots', 'end_time'),
    ('discounts', 'value'), ('discounts', 'type'), ('discounts', 'active'), ('discounts', 'max_redemptions'),
    ('creator_profiles', 'display_name'), ('creator_profiles', 'bio'), ('creator_profiles', 'services'),
    ('creator_profiles', 'qualifications'), ('creator_profiles', 'languages')
  ) fields(table_name, column_name)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(operation)
), assertions AS (
  SELECT 'forbidden_creator:' || role_name || ':' || column_name || ':' || operation AS label,
    NOT has_column_privilege(role_name, 'public.creator_profiles', column_name, operation) AS passed
  FROM forbidden_creator_columns
  UNION ALL
  SELECT 'forbidden_record:' || role_name || ':' || table_name || ':' || column_name || ':' || operation,
    NOT has_column_privilege(role_name, 'public.' || table_name, column_name, operation)
  FROM protected_records
  UNION ALL
  SELECT 'commercial_edit:' || table_name || ':' || column_name || ':' || operation,
    has_column_privilege('authenticated', 'public.' || table_name, column_name, operation)
  FROM commercial_columns
  UNION ALL
  SELECT 'server_write:' || table_name || ':' || operation,
    has_table_privilege('service_role', 'public.' || table_name, operation)
  FROM (VALUES ('creator_profiles'), ('subscriptions'), ('video_class_bookings'), ('verification_requests'), ('purchases'), ('bookings')) tables(table_name)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) operations(operation)
  UNION ALL
  SELECT 'no_whole_table_destruction:' || role_name || ':' || c.relname,
    NOT has_table_privilege(role_name, c.oid, 'TRUNCATE')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) roles(role_name)
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'creator_ownership_check', coalesce((SELECT with_check LIKE '%auth.uid%' FROM pg_policies
    WHERE schemaname='public' AND tablename='creator_profiles' AND policyname='creator_profiles_update_own'), false)
  UNION ALL
  SELECT 'no_entitlement_write_policy', NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('subscriptions','verification_requests','video_class_bookings') AND cmd <> 'SELECT')
  UNION ALL
  SELECT 'existing_buyer_inactive_tier_read', coalesce((SELECT qual LIKE '%subscriptions%' AND qual LIKE '%buyer_id%' FROM pg_policies
    WHERE schemaname='public' AND tablename='subscription_tiers' AND policyname='tiers_select_active'), false)
  UNION ALL
  SELECT 'private_file_owner_binding', coalesce((SELECT qual LIKE '%product.creator_id%' FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='products_download_entitled'), false)
)
SELECT label, passed FROM assertions ORDER BY label;
