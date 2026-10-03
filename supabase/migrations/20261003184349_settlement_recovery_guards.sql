-- A disappeared offer cannot leave a newly paid cycle without fulfillment or
-- reconciliation. Historical fulfilled cycles and their Stripe charges stay untouched.
CREATE OR REPLACE FUNCTION public.fulfill_payment_order(p_order_id uuid,p_settlement_id uuid DEFAULT NULL,p_period_end timestamptz DEFAULT NULL,p_subscription_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE; s public.payment_settlements%ROWTYPE; item jsonb; newly boolean:=false; new_sub boolean:=false; total integer; b public.bookings%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order missing'; END IF;
 IF p_settlement_id IS NOT NULL THEN
  SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id AND order_id=o.id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Settlement missing'; END IF;
  IF s.fulfillment_state='fulfilled' THEN RETURN jsonb_build_object('newly_fulfilled',false); END IF;
  IF s.fulfillment_state IN ('refund_required','refunded') THEN RETURN jsonb_build_object('refund_required',s.fulfillment_state='refund_required','newly_fulfilled',false); END IF;
 ELSE
  IF o.gross_cents<>0 OR o.kind<>'products' THEN RAISE EXCEPTION 'Paid fulfillment requires settlement'; END IF;
  IF o.state='fulfilled' THEN RETURN jsonb_build_object('newly_fulfilled',false); END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.buyer_id::text||':'||o.creator_id::text,0));
 IF o.kind='booking' THEN
  SELECT * INTO b FROM public.bookings WHERE id=(o.reference->>'bookingId')::uuid FOR UPDATE;
  IF b.id IS NULL OR b.buyer_id<>o.buyer_id OR b.creator_id<>o.creator_id OR b.fulfilled_payment_attempt_id IS DISTINCT FROM o.id
   OR b.status NOT IN ('confirmed','completed') OR b.payment_status<>'paid' OR b.refund_status<>'not_requested'
   OR b.stripe_payment_intent_id IS DISTINCT FROM s.stripe_payment_intent_id THEN
    UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending' WHERE id=s.id;
    RETURN jsonb_build_object('refund_required',true,'newly_fulfilled',false);
  END IF;
 ELSIF o.kind='products' THEN
  IF jsonb_typeof(o.reference->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(o.reference->'items')=0 THEN RAISE EXCEPTION 'Invalid product snapshot'; END IF;
  SELECT sum((i->>'amountCents')::integer) INTO total FROM jsonb_array_elements(o.reference->'items') i;
  IF total<>o.gross_cents THEN RAISE EXCEPTION 'Product amount snapshot mismatch'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(o.reference->'items') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=(item->>'productId')::uuid AND creator_id=o.creator_id)
     OR EXISTS(SELECT 1 FROM public.purchases WHERE buyer_id=o.buyer_id AND product_id=(item->>'productId')::uuid
      AND payment_status='paid' AND stripe_payment_intent_id IS DISTINCT FROM s.stripe_payment_intent_id) THEN
    IF s.id IS NOT NULL THEN
     UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending' WHERE id=s.id;
     UPDATE public.payment_orders SET state='refund_required' WHERE id=o.id;
     RETURN jsonb_build_object('refund_required',true,'newly_fulfilled',false);
    ELSE
     UPDATE public.payment_orders SET state='fulfilled' WHERE id=o.id;
     RETURN jsonb_build_object('newly_fulfilled',false);
    END IF;
   END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(o.reference->'items') LOOP
   INSERT INTO public.purchases(buyer_id,product_id,amount_paid,stripe_payment_intent_id,stripe_checkout_session_id,stripe_livemode,payment_status,amount_refunded,withdrawal_consent_at,withdrawal_consent_version)
   VALUES(o.buyer_id,(item->>'productId')::uuid,(item->>'amountCents')::numeric/100,s.stripe_payment_intent_id,o.stripe_checkout_session_id,o.stripe_livemode,'paid',0,
    nullif(o.reference->>'withdrawalConsentAt','')::timestamptz,o.reference->>'withdrawalConsentVersion')
   ON CONFLICT(buyer_id,product_id) DO UPDATE SET amount_paid=excluded.amount_paid,stripe_payment_intent_id=excluded.stripe_payment_intent_id,
    stripe_checkout_session_id=excluded.stripe_checkout_session_id,stripe_livemode=excluded.stripe_livemode,payment_status='paid',amount_refunded=0,
    withdrawal_consent_at=excluded.withdrawal_consent_at,withdrawal_consent_version=excluded.withdrawal_consent_version,updated_at=now();
  END LOOP;
 ELSIF o.kind='subscription' THEN
  IF o.stripe_subscription_id IS NULL OR p_period_end IS NULL OR p_subscription_status NOT IN ('active','past_due','canceled','trialing') THEN RAISE EXCEPTION 'Invalid paid subscription cycle'; END IF;
  IF p_subscription_status='canceled' OR NOT EXISTS(SELECT 1 FROM public.subscription_tiers WHERE id=(o.reference->>'tierId')::uuid AND creator_id=o.creator_id) THEN
   UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending' WHERE id=s.id;
   RETURN jsonb_build_object('refund_required',true,'newly_fulfilled',false);
  END IF;
  new_sub:=NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE stripe_subscription_id=o.stripe_subscription_id);
  INSERT INTO public.subscriptions(buyer_id,creator_id,tier_id,stripe_subscription_id,stripe_livemode,status,current_period_end)
  VALUES(o.buyer_id,o.creator_id,(o.reference->>'tierId')::uuid,o.stripe_subscription_id,o.stripe_livemode,p_subscription_status,p_period_end)
  ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=excluded.status,current_period_end=greatest(public.subscriptions.current_period_end,excluded.current_period_end);
 END IF;
 newly:=true;
 UPDATE public.payment_orders SET state='fulfilled',updated_at=now() WHERE id=o.id;
 IF s.id IS NOT NULL THEN UPDATE public.payment_settlements SET fulfillment_state='fulfilled',state='pending',updated_at=now() WHERE id=s.id; END IF;
 RETURN jsonb_build_object('newly_fulfilled',newly,'is_new_subscription',new_sub);
END; $$;


-- Minimal private audit tombstones let queued signed TEST webhooks settle cleanly
-- after disposable test users/orders are removed. No customer data is retained.
CREATE TABLE public.retired_stripe_test_runs (
 id uuid PRIMARY KEY,
 object_ids text[] NOT NULL,
 retired_at timestamptz NOT NULL DEFAULT now(),
 CHECK (cardinality(object_ids)>0)
);
ALTER TABLE public.retired_stripe_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retired_stripe_test_runs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.retired_stripe_test_runs TO service_role;
CREATE INDEX retired_stripe_test_runs_objects_idx ON public.retired_stripe_test_runs USING gin(object_ids);
REVOKE ALL ON FUNCTION public.fulfill_payment_order(uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_order(uuid,uuid,timestamptz,text) TO service_role;
