SET plpgsql.check_asserts = on;
DO $$ DECLARE c uuid := '20000000-0000-4000-8000-000000000001'; t timestamptz; a jsonb; b jsonb;
 token uuid := gen_random_uuid(); next_token uuid := gen_random_uuid();
 recipient uuid := '00000000-0000-4000-8000-000000000002';
 payload jsonb := '{"from":"test","to":"test@example.test","subject":"first","html":"html","text":"text"}';
BEGIN
 ASSERT current_database()='ardore_group_reminders_test';
 SELECT starts_at INTO t FROM public.video_class_occurrences WHERE video_class_id=c;
 ASSERT (SELECT count(*) FROM public.group_reminder_recipients)=4,'3 eligible participants and one coach';
 ASSERT (SELECT count(*) FROM public.group_reminder_recipients WHERE recipient_role='coach')=1,'Coach is deduplicated across participants';
 ASSERT NOT EXISTS(SELECT 1 FROM public.group_reminder_recipients WHERE recipient_id IN('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008'));
 ASSERT NOT public.group_reminder_is_eligible(c,now()-interval '1 second',recipient,'participant');
 ASSERT NOT public.group_reminder_is_eligible(c,now()+interval '25 hours',recipient,'participant');
 ASSERT NOT public.group_reminder_is_eligible(c,t,recipient,'coach');
 INSERT INTO public.notification_preferences VALUES(recipient,false);
 ASSERT NOT public.group_reminder_is_eligible(c,t,recipient,'participant');
 DELETE FROM public.notification_preferences WHERE user_id=recipient;
 a:=public.claim_group_reminder(c,t,recipient,'participant',payload,token);
 ASSERT a->>'state'='claimed';
 b:=public.claim_group_reminder(c,t,recipient,'participant',payload,next_token);
 ASSERT b->>'state'='busy';
 ASSERT NOT public.complete_group_reminder((a->>'id')::uuid,next_token),'Wrong lease cannot complete';
 ASSERT public.fail_group_reminder((a->>'id')::uuid,token);
 b:=public.claim_group_reminder(c,t,recipient,'participant',payload||'{"subject":"changed"}',next_token);
 ASSERT b->>'id'=a->>'id' AND b->'payload'=payload,'Retry freezes payload and identity';
 ASSERT public.complete_group_reminder((b->>'id')::uuid,next_token);
 ASSERT public.complete_group_reminder((b->>'id')::uuid,next_token),'Completion retry is safe';
 ASSERT (SELECT d.payload='{}'::jsonb AND d.state='sent' FROM public.group_reminder_deliveries d WHERE d.id=(b->>'id')::uuid);
 ASSERT public.claim_group_reminder(c,t,recipient,'participant',payload,token)->>'state'='sent';
 -- New occurrence has a separate identity; recurring courses are not suppressed.
 INSERT INTO public.video_class_occurrences SELECT c,t+interval '1 hour',class_title,duration_minutes FROM public.video_class_occurrences WHERE video_class_id=c AND starts_at=t;
 INSERT INTO public.video_class_bookings SELECT '30000000-0000-4000-8000-000000000009',c,recipient,t+interval '1 hour','40000000-0000-4000-8000-000000000009','confirmed','not_requested',0,0,'not_required',NULL;
 INSERT INTO public.group_booking_reservations VALUES('40000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000009',c,t+interval '1 hour',recipient,'10000000-0000-4000-8000-000000000001','confirmed','not_requested',0,0,NULL);
 ASSERT public.claim_group_reminder(c,t+interval '1 hour',recipient,'participant',payload,token)->>'state'='claimed';
 -- Unknown provider outcome past its 24h idempotency retention is held, not resent.
 UPDATE public.group_reminder_deliveries SET state='pending',first_attempt_at=now()-interval '23 hours 1 minute',lease_token=NULL,lease_until=NULL WHERE occurrence_start=t+interval '1 hour';
 ASSERT public.claim_group_reminder(c,t+interval '1 hour',recipient,'participant',payload,next_token)->>'state'='held';
 -- Cancellation between scan and claim is denied; coach loses eligibility when last participant cancels.
 UPDATE public.video_class_bookings SET status='cancelled' WHERE occurrence_start=t+interval '1 hour';
 ASSERT NOT public.group_reminder_is_eligible(c,t+interval '1 hour',recipient,'participant');
 ASSERT NOT public.group_reminder_is_eligible(c,t+interval '1 hour','00000000-0000-4000-8000-000000000001','coach');
 -- Expired worker leases may be reclaimed; obsolete workers cannot complete them.
 recipient:='00000000-0000-4000-8000-000000000004';
 a:=public.claim_group_reminder(c,t,recipient,'participant',payload,token);
 UPDATE public.group_reminder_deliveries SET lease_until=now()-interval '1 second' WHERE id=(a->>'id')::uuid;
 b:=public.claim_group_reminder(c,t,recipient,'participant',payload,next_token);
 ASSERT b->>'state'='claimed' AND b->>'id'=a->>'id';
 ASSERT NOT public.complete_group_reminder((a->>'id')::uuid,token);
 ASSERT public.fail_group_reminder((a->>'id')::uuid,next_token);
END $$;
DO $$ DECLARE r text; signature text; BEGIN
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.group_reminder_deliveries'::regclass);
 FOR r IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
  ASSERT NOT has_table_privilege(r,'public.group_reminder_deliveries','SELECT,INSERT,UPDATE,DELETE');
  ASSERT NOT has_table_privilege(r,'public.group_reminder_recipients','SELECT');
  FOR signature IN SELECT unnest(ARRAY['public.group_reminder_is_eligible(uuid,timestamptz,uuid,text)','public.claim_group_reminder(uuid,timestamptz,uuid,text,jsonb,uuid)','public.complete_group_reminder(uuid,uuid)','public.fail_group_reminder(uuid,uuid)']) LOOP
   ASSERT NOT has_function_privilege(r,signature,'EXECUTE');
   ASSERT has_function_privilege('service_role',signature,'EXECUTE');
   ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid=signature::regprocedure),'No definer privilege bypass';
  END LOOP;
 END LOOP;
END $$;
