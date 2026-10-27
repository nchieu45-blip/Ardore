-- Requires setup, then actual group_session_payments migration, in the isolated
-- marked database. Every synthetic test mutation rolls back.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $$ BEGIN
 IF current_database()<>'ardore_group_payments_test' OR current_setting('ardore.isolated_sql_test',true) IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Explicit disposable ardore_group_payments_test database required'; END IF;
 ASSERT NOT has_function_privilege('authenticated','public.reserve_group_class_booking(uuid,uuid,uuid,timestamptz,boolean,text,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.fulfill_payment_order(uuid,uuid,timestamptz,text)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.video_class_occurrences','SELECT');
 ASSERT NOT has_column_privilege('authenticated','public.group_booking_reservations','account_id','SELECT');
 ASSERT NOT has_column_privilege('authenticated','public.group_booking_reservations','checkout_idempotency_key','SELECT');
 ASSERT NOT has_column_privilege('authenticated','public.group_booking_reservations','checkout_url','SELECT');
 ASSERT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='private.protect_group_class_schedule()'::regprocedure);
END; $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE bad integer; BEGIN
 FOREACH bad IN ARRAY ARRAY[0,10,199,NULL] LOOP
  BEGIN
   UPDATE public.video_classes SET max_participants=bad WHERE id='20000000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'Unsupported group capacity was accepted: %',bad;
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 ASSERT (SELECT max_participants=1 FROM public.video_classes WHERE id='20000000-0000-4000-8000-000000000001');
 INSERT INTO public.video_classes(id,creator_id,title,schedule_type,starts_at)
  VALUES('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','Default capacity fixture','once',now()+interval '4 days');
 ASSERT (SELECT max_participants=9 FROM public.video_classes WHERE id='20000000-0000-4000-8000-000000000099');
 DELETE FROM public.video_classes WHERE id='20000000-0000-4000-8000-000000000099';
END; $$;
DO $$ DECLARE c uuid:='20000000-0000-4000-8000-000000000001'; buyer uuid:='00000000-0000-4000-8000-000000000011'; t timestamptz; first jsonb; again jsonb; r public.group_booking_reservations%ROWTYPE; sid uuid;
BEGIN
 SELECT starts_at INTO t FROM public.video_classes WHERE id=c;
 ASSERT public.valid_group_class_occurrence(c,t);
 ASSERT NOT public.valid_group_class_occurrence(c,t+interval'1 minute');
 first:=public.reserve_group_class_booking(c,buyer,'30000000-0000-4000-8000-000000000001',t,false,'acct_fixture',500);
 ASSERT first->'reservation'->>'status'='creating','Paid reserve does not create entitlement';
 ASSERT NOT EXISTS(SELECT 1 FROM public.video_class_bookings WHERE video_class_id=c),'No access before provider capture';
 again:=public.reserve_group_class_booking(c,buyer,'30000000-0000-4000-8000-000000000001',t,false,'acct_fixture',500);
 ASSERT first->'reservation'->>'id'=again->'reservation'->>'id' AND (again->>'created')::boolean=false,'Idempotent caller request';
 ASSERT public.reserve_group_class_booking(c,buyer,'30000000-0000-4000-8000-000000000001',t+interval'1 minute',false,'acct_fixture',500)->>'error'='request_conflict';
 ASSERT public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000002',t,false,'acct_fixture',500)->>'error'='full','Unresolved holds consume capacity';
 SELECT * INTO r FROM public.group_booking_reservations WHERE id=(first->'reservation'->>'id')::uuid;
 -- A wall-clock expiry alone must not release an unknown payable checkout.
 ASSERT (public.group_class_availability(c,t)->>'remaining')::integer=0;
 UPDATE public.video_classes SET price_cents=700 WHERE id=c;
 ASSERT public.reserve_group_class_booking(c,buyer,'30000000-0000-4000-8000-000000000001',t,false,'acct_fixture',700)->'reservation'->>'price_cents'='500','Retry preserves frozen price';
 INSERT INTO public.payment_orders(id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,reference,stripe_checkout_session_id)
 VALUES(r.id,'group',r.buyer_id,r.creator_id,r.account_id,r.price_cents,50,450,false,jsonb_build_object('reservationId',r.id,'videoClassId',c,'occurrenceStart',t,'durationMinutes',r.duration_minutes),'cs_fixture_one');
 PERFORM public.bind_group_checkout(r.id,r.id,'cs_fixture_one','https://checkout.stripe.com/synthetic');
 INSERT INTO public.payment_settlements(order_id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,stripe_payment_intent_id)
 VALUES(r.id,'group',r.buyer_id,r.creator_id,r.account_id,500,50,450,false,'pi_fixture_one') RETURNING id INTO sid;
 first:=public.fulfill_payment_order(r.id,sid);
 ASSERT (first->>'newly_fulfilled')::boolean,'Captured provider payment fulfills once';
 ASSERT (SELECT count(*)=1 FROM public.video_class_bookings WHERE reservation_id=r.id AND status='confirmed' AND payment_status='paid' AND occurrence_start=t AND price_paid_cents=500);
 ASSERT (public.fulfill_payment_order(r.id,sid)->>'newly_fulfilled')::boolean=false,'Duplicate webhook has no duplicate enrollment';
 ASSERT (public.claim_settlement_action(sid,'transfer',0,450,gen_random_uuid())->>'legacy_delegate')::boolean,'Valid group fulfillment can use existing transfer engine';
 ASSERT public.cancel_group_class_booking((first->>'booking_id')::uuid,'00000000-0000-4000-8000-000000000012')->>'error'='forbidden';
 ASSERT public.cancel_group_class_booking((first->>'booking_id')::uuid,buyer)->'reservation'->>'status'='refund_pending','Cancel creates durable refund intent';
 ASSERT (public.claim_settlement_action(sid,'transfer',0,450,gen_random_uuid())->>'blocked')::boolean,'Cancelled enrollment cannot authorize a later transfer';
 ASSERT public.cancel_group_class_booking((first->>'booking_id')::uuid,buyer)->>'already_cancelled'='true','Cancel retry does not create a second refund agreement';
END; $$;
RESET ROLE;

-- The actual owner may update future pricing but cannot mutate frozen schedule.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
 UPDATE public.video_classes SET price_cents=800 WHERE id='20000000-0000-4000-8000-000000000001';
 GET DIAGNOSTICS affected=ROW_COUNT; ASSERT affected=1,'Real owner price edit remains allowed';
 BEGIN
  UPDATE public.video_classes SET duration_minutes=90 WHERE id='20000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'Frozen duration changed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.video_classes SET active=false WHERE id='20000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'Frozen course deactivated';
 EXCEPTION WHEN check_violation THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
 UPDATE public.video_classes SET price_cents=99 WHERE id='20000000-0000-4000-8000-000000000001';
 GET DIAGNOSTICS affected=ROW_COUNT; ASSERT affected=0,'Foreign class UPDATE denied by actual RLS';
 ASSERT (SELECT count(*)=0 FROM public.group_booking_status),'Foreign reservations not leaked';
END; $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ DECLARE c uuid:='20000000-0000-4000-8000-000000000002'; t timestamptz; a jsonb; b jsonb; bid uuid;
BEGIN
 t:=((date_trunc('day',now() AT TIME ZONE 'Europe/Berlin')+interval'14 days')::date+
  ((2-extract(dow FROM (now() AT TIME ZONE 'Europe/Berlin'))::integer+7)%7)+time'18:00') AT TIME ZONE 'Europe/Berlin';
 a:=public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000003',t,NULL,NULL,0);
 b:=public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000004',t+interval'7 days',NULL,NULL,0);
 ASSERT a->'reservation'->>'status'='confirmed' AND b->'reservation'->>'status'='confirmed';
 ASSERT a->'reservation'->>'booking_id'<>b->'reservation'->>'booking_id','Recurring bookings are per session, not perpetual access';
 ASSERT (SELECT count(*)=2 FROM public.video_class_bookings WHERE video_class_id=c AND user_id='00000000-0000-4000-8000-000000000011');
 ASSERT (public.group_class_availability(c,t)->>'capacity')::integer=9,'Group capacity includes at most nine attendees';
 BEGIN UPDATE public.group_booking_reservations SET price_cents=100 WHERE id=(a->'reservation'->>'id')::uuid; RAISE EXCEPTION 'Frozen price changed'; EXCEPTION WHEN check_violation THEN NULL; END;
END; $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (SELECT count(*)=3 FROM public.group_booking_status),'Own pending/history projection is readable';
 BEGIN PERFORM checkout_url FROM public.group_booking_reservations; RAISE EXCEPTION 'Private checkout URL exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ensure_group_class_occurrence('20000000-0000-4000-8000-000000000002',now()+interval'3 days'); RAISE EXCEPTION 'Browser invoked internal RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

-- Late payment after release and another buyer's win must refund without access.
SET LOCAL ROLE service_role;
DO $$ DECLARE c uuid:='20000000-0000-4000-8000-000000000003'; t timestamptz; a jsonb; r public.group_booking_reservations%ROWTYPE; sid uuid; other jsonb;
BEGIN
 SELECT starts_at INTO t FROM public.video_classes WHERE id=c;
 a:=public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000005',t,false,'acct_fixture',500);
 SELECT * INTO r FROM public.group_booking_reservations WHERE id=(a->'reservation'->>'id')::uuid;
 UPDATE public.group_booking_reservations SET status='expired' WHERE id=r.id;
 other:=public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000006',t,false,'acct_fixture',500);
 ASSERT other->'reservation'->>'status'='creating';
 INSERT INTO public.payment_orders(id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,reference)
 VALUES(r.id,'group',r.buyer_id,r.creator_id,r.account_id,500,50,450,false,jsonb_build_object('reservationId',r.id,'videoClassId',c,'occurrenceStart',t,'durationMinutes',r.duration_minutes));
 INSERT INTO public.payment_settlements(order_id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,stripe_payment_intent_id)
 VALUES(r.id,'group',r.buyer_id,r.creator_id,r.account_id,500,50,450,false,'pi_fixture_late') RETURNING id INTO sid;
 ASSERT (public.fulfill_payment_order(r.id,sid)->>'refund_required')::boolean,'Late losing payment requires full system refund';
 ASSERT NOT EXISTS(SELECT 1 FROM public.video_class_bookings WHERE reservation_id=r.id),'Losing payment never grants video membership';
 ASSERT (SELECT refund_status='pending' AND status='refund_pending' FROM public.group_booking_reservations WHERE id=r.id);
 INSERT INTO public.payment_orders(id,kind,buyer_id,creator_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,reference)
 VALUES('40000000-0000-4000-8000-000000000099','products',r.buyer_id,r.creator_id,0,0,0,false,'{}');
 ASSERT (public.fulfill_payment_order('40000000-0000-4000-8000-000000000099')->>'legacy_delegate')::boolean,'Existing discounted/non-group fulfillment remains delegated';
END; $$;
-- Subscription eligibility is independently rechecked inside the atomic RPC.
DO $$ DECLARE c uuid:='20000000-0000-4000-8000-000000000004'; t timestamptz:=date_trunc('minute',now()+interval'4 days'); x jsonb; i integer; buyer uuid;
BEGIN
 INSERT INTO public.video_classes(id,creator_id,title,schedule_type,starts_at,duration_minutes,max_participants,price_cents,included_in_subscription)
 VALUES(c,'10000000-0000-4000-8000-000000000001','Synthetic subscription class','once',t,60,9,500,true);
 -- A rejected price comparison must not freeze a schedule or reserve capacity.
 ASSERT public.reserve_group_class_booking(c,'00000000-0000-4000-8000-000000000040',gen_random_uuid(),t,false,'acct_fixture',0)->>'error'='price_changed';
 ASSERT NOT EXISTS(SELECT 1 FROM public.video_class_occurrences WHERE video_class_id=c),'Rejected request cannot freeze a class';
 INSERT INTO public.creator_profiles VALUES('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',true,'other-fixture-coach');
 INSERT INTO public.subscription_tiers VALUES('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
 FOR i IN 1..7 LOOP
  buyer:=('00000000-0000-4000-8000-'||lpad((40+i)::text,12,'0'))::uuid;
  INSERT INTO public.subscriptions(id,buyer_id,creator_id,tier_id,status,current_period_end,stripe_subscription_id,stripe_livemode)
  VALUES(gen_random_uuid(),buyer,'10000000-0000-4000-8000-000000000001',
    CASE WHEN i=5 THEN '60000000-0000-4000-8000-000000000002'::uuid ELSE '60000000-0000-4000-8000-000000000001'::uuid END,
    CASE WHEN i=3 THEN 'canceled' ELSE 'active' END,CASE WHEN i=4 THEN now()-interval'1 day' ELSE now()+interval'7 days' END,
    CASE WHEN i=7 THEN 'free_server-issued' WHEN i=6 THEN 'freeXforged' ELSE 'sub_fixture_'||i END,
    CASE WHEN i IN(6,7) THEN NULL WHEN i=2 THEN false ELSE true END);
  x:=public.reserve_group_class_booking(c,buyer,gen_random_uuid(),t,false,'acct_fixture',500);
  IF i IN(1,7) THEN
    ASSERT x->'reservation'->>'price_cents'='0' AND x->'reservation'->>'status'='confirmed','Trusted live/server-free membership benefits apply';
    ASSERT (SELECT payment_status='not_required' AND price_paid_cents=0 AND payment_order_id IS NULL FROM public.video_class_bookings WHERE reservation_id=(x->'reservation'->>'id')::uuid);
  ELSE
    ASSERT x->'reservation'->>'price_cents'='500' AND x->'reservation'->>'status'='creating','Test, canceled, expired, foreign-tier and forged-free memberships cannot bypass payment';
    ASSERT NOT EXISTS(SELECT 1 FROM public.video_class_bookings WHERE reservation_id=(x->'reservation'->>'id')::uuid);
  END IF;
 END LOOP;
END; $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'Group payments PostgreSQL assertions passed: capacity, frozen terms, per-session identity, role ACL, late refund and legacy delegation'; END; $$;
ROLLBACK;
