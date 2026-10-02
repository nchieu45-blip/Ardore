-- Read-only checks: no application data or user identities are modified.
WITH ledger_columns AS (
 SELECT a.attname::text AS col FROM pg_attribute a
 WHERE a.attrelid='public.booking_refunds'::regclass AND a.attnum>0 AND NOT a.attisdropped
), assertions AS (
 SELECT 'ledger:'||role_name||':'||col||':'||op AS label,
   NOT has_column_privilege(role_name,'public.booking_refunds',col,op) AS passed
 FROM ledger_columns CROSS JOIN (VALUES ('anon'),('authenticated')) roles(role_name)
 CROSS JOIN (VALUES ('INSERT'),('UPDATE')) operations(op)
 UNION ALL
 SELECT 'read:'||col,has_column_privilege('authenticated','public.booking_refunds',col,'SELECT') = (col IN ('booking_id','state','amount_cents')) FROM ledger_columns
 UNION ALL
 SELECT 'anon_read:'||col,NOT has_column_privilege('anon','public.booking_refunds',col,'SELECT') FROM ledger_columns
 UNION ALL
 SELECT 'rpc:'||role_name||':'||signature, has_function_privilege(role_name,signature,'EXECUTE')=(role_name='service_role')
 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
 CROSS JOIN (VALUES ('public.cancel_coaching_booking(uuid,uuid)'),('public.apply_coaching_refund_state(uuid,jsonb,text,integer,integer,timestamptz)')) functions(signature)
 UNION ALL
 SELECT 'snapshot_and_payment:'||role_name||':'||col||':'||op,NOT has_column_privilege(role_name,'public.bookings',col,op)
 FROM (VALUES ('anon'),('authenticated')) roles(role_name)
 CROSS JOIN (VALUES ('cancellation_policy_hours'),('amount_paid_cents'),('refund_status'),('refund_provider_checked_at')) columns(col)
 CROSS JOIN (VALUES ('INSERT'),('UPDATE')) operations(op)
 UNION ALL
 SELECT 'coach_commercial:'||col||':'||op,has_column_privilege('authenticated','public.coaching_offers',col,op)
 FROM (VALUES ('price_cents'),('duration_minutes'),('description'),('cancellation_policy_hours'),('is_enabled')) columns(col)
 CROSS JOIN (VALUES ('INSERT'),('UPDATE')) operations(op)
 UNION ALL
 SELECT 'ledger_destruction:'||role_name||':'||op,NOT has_table_privilege(role_name,'public.booking_refunds',op)
 FROM (VALUES ('anon'),('authenticated')) roles(role_name) CROSS JOIN (VALUES ('DELETE'),('TRUNCATE')) operations(op)
 UNION ALL
 SELECT 'service:'||op,has_table_privilege('service_role','public.booking_refunds',op)
 FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) operations(op)
 UNION ALL
 SELECT 'ledger_rls',relrowsecurity FROM pg_class WHERE oid='public.booking_refunds'::regclass
 UNION ALL
 SELECT 'participant_policy',coalesce((SELECT qual LIKE '%buyer_id%' AND qual LIKE '%user_id%' AND qual LIKE '%auth.uid%' FROM pg_policies WHERE schemaname='public' AND tablename='booking_refunds' AND policyname='booking_refunds_read_participant'),false)
 UNION ALL
 SELECT 'rpc_invoker:'||proname,NOT prosecdef FROM pg_proc WHERE oid IN ('public.cancel_coaching_booking(uuid,uuid)'::regprocedure,'public.apply_coaching_refund_state(uuid,jsonb,text,integer,integer,timestamptz)'::regprocedure)
)
SELECT label,passed FROM assertions ORDER BY label;
