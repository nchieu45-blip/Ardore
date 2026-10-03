-- Read-only permission assertions; no users, bookings or Auth rows are changed.
WITH attempt_columns AS (
  SELECT attname::text AS col FROM pg_attribute
  WHERE attrelid = 'public.coaching_payment_attempts'::regclass AND attnum > 0 AND NOT attisdropped
), functions(signature) AS (VALUES
  ('public.begin_coaching_payment_attempt(uuid,uuid,boolean,timestamptz,uuid,text,integer)'),
  ('public.register_coaching_checkout(uuid,text,text)'),
  ('public.register_legacy_coaching_payment_attempt(uuid,text,boolean,text,integer)'),
  ('public.fail_coaching_checkout_creation(uuid,text)'),
  ('public.observe_coaching_payment_attempt(uuid,jsonb)'),
  ('public.apply_coaching_attempt_refund_state(uuid,jsonb,text,integer,integer,timestamptz)'),
  ('public.claim_stripe_webhook_event(text,text,boolean,uuid)'),
  ('public.complete_stripe_webhook_event(text,uuid)'),
  ('public.release_stripe_webhook_event(text,uuid)')
), assertions AS (
  SELECT 'private_attempt:' || role_name || ':' || col || ':' || op AS label,
    NOT has_column_privilege(role_name, 'public.coaching_payment_attempts', col, op) AS passed
  FROM attempt_columns CROSS JOIN (VALUES ('anon'), ('authenticated')) roles(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) operations(op)
  UNION ALL
  SELECT 'private_attempt_table:' || role_name || ':' || op,
    NOT has_table_privilege(role_name, 'public.coaching_payment_attempts', op)
  FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
    CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER')) operations(op)
  UNION ALL
  SELECT 'rpc:' || role_name || ':' || signature,
    has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role')
  FROM functions CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)
  UNION ALL
  SELECT 'rpc_invoker:' || signature, NOT prosecdef
  FROM functions JOIN pg_proc ON oid = signature::regprocedure
  UNION ALL
  SELECT 'authority:' || role_name || ':' || col || ':' || op,
    NOT has_column_privilege(role_name, 'public.bookings', col, op)
  FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
    CROSS JOIN (VALUES ('current_payment_attempt_id'), ('fulfilled_payment_attempt_id'), ('booking_request_key')) columns(col)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(op)
  UNION ALL
  SELECT 'service_attempt:' || op, has_table_privilege('service_role', 'public.coaching_payment_attempts', op)
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) operations(op)
  UNION ALL
  SELECT 'service_webhook:' || op, has_table_privilege('service_role', 'public.stripe_webhook_events', op)
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) operations(op)
  UNION ALL
  SELECT 'attempt_rls', relrowsecurity FROM pg_class WHERE oid = 'public.coaching_payment_attempts'::regclass
  UNION ALL
  SELECT 'webhook_rls', relrowsecurity FROM pg_class WHERE oid = 'public.stripe_webhook_events'::regclass
  UNION ALL
  SELECT 'coach_commercial:' || col || ':' || op,
    has_column_privilege('authenticated', 'public.coaching_offers', col, op)
  FROM (VALUES ('price_cents'), ('duration_minutes'), ('description'), ('cancellation_policy_hours'), ('is_enabled')) columns(col)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) operations(op)
  UNION ALL
  SELECT 'request_idempotency_index', EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'bookings_buyer_request_key_uidx'
  )
  UNION ALL
  SELECT 'slot_exclusion_preserved', pg_get_constraintdef(oid) LIKE '%pending_payment%confirmed%'
  FROM pg_constraint WHERE conname = 'bookings_no_overlapping_active_sessions'
  UNION ALL
  SELECT 'legacy_event_completed_default', pg_get_expr(adbin, adrelid) = '''completed''::text'
  FROM pg_attrdef WHERE adrelid = 'public.stripe_webhook_events'::regclass
    AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = adrelid AND attname = 'processing_state')
)
SELECT label, passed FROM assertions ORDER BY label;
