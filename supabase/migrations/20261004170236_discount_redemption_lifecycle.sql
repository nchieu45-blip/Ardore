-- No production discounts exist at deployment. Commercial amounts stay owned
-- by coaches; counters and fulfillment claims belong exclusively to the server.
ALTER TABLE public.discounts ADD COLUMN max_redemptions_per_user integer;
ALTER TABLE public.discounts ALTER COLUMN redemption_count SET NOT NULL;
ALTER TABLE public.discounts
 ADD CONSTRAINT discounts_percent_bounds CHECK (type <> 'percent' OR value BETWEEN 1 AND 100),
 ADD CONSTRAINT discounts_redemption_bounds CHECK (redemption_count >= 0 AND (max_redemptions IS NULL OR max_redemptions > 0)
   AND (max_redemptions_per_user IS NULL OR max_redemptions_per_user > 0)),
 ADD CONSTRAINT discounts_window_bounds CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at),
 ADD CONSTRAINT discounts_single_target CHECK (target_product_id IS NULL OR target_tier_id IS NULL);

CREATE TABLE public.discount_redemptions (
 id uuid PRIMARY KEY,
 discount_id uuid NOT NULL REFERENCES public.discounts(id) ON DELETE RESTRICT,
 buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 creator_id uuid NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK (kind IN ('products','subscriptions','sessions')),
 product_ids uuid[] NOT NULL DEFAULT '{}', tier_id uuid,
 original_cents integer NOT NULL CHECK (original_cents >= 0),
 savings_cents integer NOT NULL CHECK (savings_cents >= 0 AND savings_cents <= original_cents),
 final_cents integer NOT NULL CHECK (final_cents = original_cents - savings_cents),
 state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','consumed','released')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state = 'consumed') = (consumed_at IS NOT NULL))
);
CREATE INDEX discount_redemptions_limits ON public.discount_redemptions(discount_id,state,expires_at);
CREATE INDEX discount_redemptions_buyer ON public.discount_redemptions(discount_id,buyer_id,state);
CREATE INDEX discount_redemptions_buyer_fk ON public.discount_redemptions(buyer_id);
CREATE INDEX discount_redemptions_creator_fk ON public.discount_redemptions(creator_id);
ALTER TABLE public.discount_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_redemptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.discount_redemptions TO service_role;

CREATE FUNCTION public.guard_discount_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
  IF (TG_OP='INSERT' AND NEW.redemption_count<>0) OR
    (TG_OP='UPDATE' AND (NEW.redemption_count IS DISTINCT FROM OLD.redemption_count OR NEW.id<>OLD.id
      OR NEW.creator_id<>OLD.creator_id OR NEW.created_at<>OLD.created_at)) THEN
   RAISE EXCEPTION 'Discount authority fields are server-managed' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NEW.target_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=NEW.target_product_id AND creator_id=NEW.creator_id)
   OR NEW.target_tier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.subscription_tiers WHERE id=NEW.target_tier_id AND creator_id=NEW.creator_id) THEN
  RAISE EXCEPTION 'Discount target must belong to this coach' USING ERRCODE='23514';
 END IF;
 -- Commercial settings remain coach-editable; consumption rechecks capacity.
 RETURN NEW;
END; $$;
CREATE TRIGGER discounts_authority_guard BEFORE INSERT OR UPDATE ON public.discounts
 FOR EACH ROW EXECUTE FUNCTION public.guard_discount_configuration();

CREATE FUNCTION public.reserve_discount_redemption(p_id uuid,p_discount_id uuid,p_buyer_id uuid,p_creator_id uuid,
 p_kind text,p_original_cents integer,p_product_ids uuid[] DEFAULT '{}',p_tier_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.discounts%ROWTYPE; r public.discount_redemptions%ROWTYPE; held integer; user_used integer; savings integer;
BEGIN
 SELECT * INTO d FROM public.discounts WHERE id=p_discount_id FOR UPDATE;
 IF d.id IS NULL OR p_id IS NULL OR p_buyer_id IS NULL OR d.creator_id IS DISTINCT FROM p_creator_id
   OR p_original_cents IS NULL OR p_original_cents<=0 OR p_kind NOT IN ('products','subscriptions','sessions') THEN
  RETURN jsonb_build_object('error','invalid_discount');
 END IF;
 UPDATE public.discount_redemptions SET state='released' WHERE discount_id=d.id AND state='held' AND expires_at<=now();
 SELECT * INTO r FROM public.discount_redemptions WHERE id=p_id FOR UPDATE;
 IF r.id IS NOT NULL THEN
  IF r.discount_id<>d.id OR r.buyer_id<>p_buyer_id OR r.creator_id<>p_creator_id OR r.kind<>p_kind
    OR r.original_cents<>p_original_cents OR r.product_ids IS DISTINCT FROM p_product_ids OR r.tier_id IS DISTINCT FROM p_tier_id THEN
   RETURN jsonb_build_object('error','discount_request_mismatch');
  END IF;
  IF r.state IN ('held','consumed') THEN RETURN to_jsonb(r); END IF;
 END IF;
 IF r.id IS NULL AND (d.active IS DISTINCT FROM true OR (d.starts_at IS NOT NULL AND d.starts_at>now()) OR (d.ends_at IS NOT NULL AND d.ends_at<now())) THEN RETURN jsonb_build_object('error','invalid_discount'); END IF;
 IF r.id IS NULL AND ((p_kind='products' AND (d.target_tier_id IS NOT NULL OR
     (d.target_product_id IS NOT NULL AND p_product_ids IS DISTINCT FROM ARRAY[d.target_product_id]) OR
     (d.target_product_id IS NULL AND d.applies_to NOT IN ('all','products')) OR cardinality(p_product_ids)=0 OR
     EXISTS(SELECT 1 FROM unnest(p_product_ids) pid WHERE NOT EXISTS(SELECT 1 FROM public.products WHERE id=pid AND creator_id=p_creator_id))))
   OR (p_kind='subscriptions' AND (d.target_product_id IS NOT NULL OR
     (d.target_tier_id IS NOT NULL AND d.target_tier_id IS DISTINCT FROM p_tier_id) OR
     (d.target_tier_id IS NULL AND d.applies_to NOT IN ('all','subscriptions')) OR
     NOT EXISTS(SELECT 1 FROM public.subscription_tiers WHERE id=p_tier_id AND creator_id=p_creator_id)))
   OR (p_kind='sessions' AND (d.target_product_id IS NOT NULL OR d.target_tier_id IS NOT NULL OR d.applies_to NOT IN ('all','sessions')))) THEN
  RETURN jsonb_build_object('error','wrong_discount_scope');
 END IF;
 SELECT count(*) INTO held FROM public.discount_redemptions WHERE discount_id=d.id AND state='held';
 SELECT count(*) INTO user_used FROM public.discount_redemptions WHERE discount_id=d.id AND buyer_id=p_buyer_id AND state IN ('held','consumed');
 IF (d.max_redemptions IS NOT NULL AND d.redemption_count+held>=d.max_redemptions)
   OR (d.max_redemptions_per_user IS NOT NULL AND user_used>=d.max_redemptions_per_user) THEN
  RETURN jsonb_build_object('error','discount_limit_reached');
 END IF;
 savings:=least(p_original_cents,CASE WHEN d.type='percent' THEN round(p_original_cents::numeric*d.value/100)::integer ELSE d.value END);
 -- Existing requests retain the commercial snapshot already agreed at checkout.
 IF r.id IS NOT NULL THEN
  UPDATE public.discount_redemptions SET state='held',expires_at=now()+interval '45 minutes' WHERE id=r.id RETURNING * INTO r;
 ELSE
  INSERT INTO public.discount_redemptions(id,discount_id,buyer_id,creator_id,kind,original_cents,savings_cents,final_cents,product_ids,tier_id,expires_at)
   VALUES(p_id,d.id,p_buyer_id,p_creator_id,p_kind,p_original_cents,savings,p_original_cents-savings,p_product_ids,p_tier_id,now()+interval '45 minutes') RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END; $$;

CREATE FUNCTION public.consume_discount_redemption(p_id uuid,p_buyer_id uuid,p_creator_id uuid,p_kind text,p_final_cents integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.discounts%ROWTYPE; r public.discount_redemptions%ROWTYPE; did uuid; held integer; user_used integer;
BEGIN
 SELECT discount_id INTO did FROM public.discount_redemptions WHERE id=p_id;
 SELECT * INTO d FROM public.discounts WHERE id=did FOR UPDATE;
 SELECT * INTO r FROM public.discount_redemptions WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL OR d.id IS NULL OR r.buyer_id IS DISTINCT FROM p_buyer_id OR r.creator_id IS DISTINCT FROM p_creator_id
   OR r.kind IS DISTINCT FROM p_kind OR r.final_cents IS DISTINCT FROM p_final_cents THEN RETURN false; END IF;
 IF r.state='consumed' THEN RETURN true; END IF;
 UPDATE public.discount_redemptions SET state='released' WHERE discount_id=d.id AND state='held' AND expires_at<=now();
 -- Late successful payments may reclaim unused capacity, but never steal a
 -- currently held last redemption. Existing reconciliation refunds losers.
 SELECT count(*) INTO held FROM public.discount_redemptions WHERE discount_id=d.id AND state='held' AND id<>r.id;
 SELECT count(*) INTO user_used FROM public.discount_redemptions WHERE discount_id=d.id AND buyer_id=r.buyer_id AND state IN ('held','consumed') AND id<>r.id;
 IF (d.max_redemptions IS NOT NULL AND d.redemption_count+held>=d.max_redemptions)
   OR (d.max_redemptions_per_user IS NOT NULL AND user_used>=d.max_redemptions_per_user) THEN RETURN false; END IF;
 UPDATE public.discount_redemptions SET state='consumed',consumed_at=now() WHERE id=r.id;
 UPDATE public.discounts SET redemption_count=redemption_count+1 WHERE id=d.id;
 RETURN true;
END; $$;

CREATE FUNCTION public.release_discount_redemption(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 SELECT discount_id INTO did FROM public.discount_redemptions WHERE id=p_id;
 PERFORM 1 FROM public.discounts WHERE id=did FOR UPDATE;
 UPDATE public.discount_redemptions SET state='released' WHERE id=p_id AND state='held';
 RETURN jsonb_build_object('released',true);
END; $$;

CREATE FUNCTION public.complete_free_discount_subscription(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.discount_redemptions%ROWTYPE; s public.subscriptions%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.discount_redemptions WHERE id=p_id;
 IF r.id IS NULL OR r.kind<>'subscriptions' OR r.final_cents<>0 OR NOT EXISTS(
   SELECT 1 FROM public.subscription_tiers WHERE id=r.tier_id AND creator_id=r.creator_id AND is_active) THEN
  RAISE EXCEPTION 'Invalid free subscription snapshot' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.buyer_id::text||':'||r.creator_id::text,0));
 SELECT * INTO s FROM public.subscriptions WHERE buyer_id=r.buyer_id AND creator_id=r.creator_id
   AND status='active' AND current_period_end>now() AND
    ((stripe_subscription_id LIKE 'free_%' AND stripe_livemode IS NULL) OR (stripe_subscription_id LIKE 'sub_%' AND stripe_livemode=true)) LIMIT 1;
 IF s.id IS NOT NULL THEN
  PERFORM public.release_discount_redemption(r.id);
  RETURN jsonb_build_object('subscription_id',s.id,'newly_created',false);
 END IF;
 IF NOT public.consume_discount_redemption(r.id,r.buyer_id,r.creator_id,'subscriptions',0) THEN
  RAISE EXCEPTION 'Discount capacity unavailable' USING ERRCODE='P0003'; END IF;
 INSERT INTO public.subscriptions(buyer_id,creator_id,tier_id,stripe_subscription_id,stripe_livemode,status,current_period_end)
  VALUES(r.buyer_id,r.creator_id,r.tier_id,'free_discount_'||r.id::text,NULL,'active',now()+interval '100 years') RETURNING * INTO s;
 RETURN jsonb_build_object('subscription_id',s.id,'newly_created',true);
END; $$;

CREATE FUNCTION public.consume_free_booking_discount() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.discount_id IS NOT NULL AND NEW.price_cents=0 AND NEW.status='confirmed' AND NEW.payment_status='not_required' THEN
  IF NOT EXISTS(SELECT 1 FROM public.discount_redemptions WHERE id=NEW.booking_request_key AND discount_id=NEW.discount_id)
   OR NOT public.consume_discount_redemption(NEW.booking_request_key,NEW.buyer_id,NEW.creator_id,'sessions',0) THEN
   RAISE EXCEPTION 'Discount capacity unavailable' USING ERRCODE='P0003'; END IF;
  NEW.discount_redeemed_at:=now();
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER bookings_free_discount BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.consume_free_booking_discount();

-- Preserve the complete existing payment/fulfillment transaction, extending it
-- only with the discount claim. A losing late payment uses its existing refund.
ALTER FUNCTION public.fulfill_payment_order(uuid,uuid,timestamptz,text) RENAME TO fulfill_payment_order_without_discount;
CREATE FUNCTION public.fulfill_payment_order(p_order_id uuid,p_settlement_id uuid DEFAULT NULL,p_period_end timestamptz DEFAULT NULL,p_subscription_status text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.payment_orders%ROWTYPE; result jsonb; rid uuid;
BEGIN
 SELECT * INTO o FROM public.payment_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order missing'; END IF;
 rid:=nullif(o.reference->>'discountRedemptionId','')::uuid;
 BEGIN
  result:=public.fulfill_payment_order_without_discount(p_order_id,p_settlement_id,p_period_end,p_subscription_status);
  IF rid IS NOT NULL AND (result->>'newly_fulfilled')::boolean AND NOT public.consume_discount_redemption(
    rid,o.buyer_id,o.creator_id,CASE WHEN o.kind='subscription' THEN 'subscriptions' ELSE o.kind END,o.gross_cents) THEN
   RAISE EXCEPTION 'Discount capacity unavailable' USING ERRCODE='P0003';
  END IF;
 EXCEPTION WHEN SQLSTATE 'P0003' THEN
  UPDATE public.payment_orders SET state='refund_required',updated_at=now() WHERE id=o.id;
  IF p_settlement_id IS NOT NULL THEN UPDATE public.payment_settlements SET fulfillment_state='refund_required',state='refund_pending'
   WHERE id=p_settlement_id AND order_id=o.id; END IF;
  RETURN jsonb_build_object('newly_fulfilled',false,'refund_required',true);
 END;
 RETURN result;
END; $$;

-- The original booking observer already wraps confirmation in a savepoint.
-- Replace its non-atomic counter with a claim inside that same transaction.
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.observe_coaching_payment_attempt(uuid,jsonb)'::regprocedure);
 IF position('UPDATE public.discounts SET redemption_count = redemption_count + 1 WHERE id = b.discount_id;' in definition)=0 THEN
  RAISE EXCEPTION 'Unexpected booking discount observer; review required'; END IF;
 definition:=replace(definition,'UPDATE public.discounts SET redemption_count = redemption_count + 1 WHERE id = b.discount_id;',
  'IF NOT public.consume_discount_redemption(b.booking_request_key,b.buyer_id,b.creator_id,''sessions'',b.price_cents) THEN RAISE EXCEPTION ''Discount capacity unavailable'' USING ERRCODE=''P0003''; END IF; PERFORM 1;');
 definition:=replace(definition,'EXCEPTION WHEN exclusion_violation THEN reason := ''slot_unavailable''; END;',
  'EXCEPTION WHEN exclusion_violation THEN reason := ''slot_unavailable''; WHEN SQLSTATE ''P0003'' THEN reason := ''discount_unavailable''; END;');
 definition:=replace(definition,'RETURN jsonb_build_object(''booking'', to_jsonb(b), ''attempt'', to_jsonb(a), ''applied'', true,
    ''newly_confirmed'', newly_confirmed',
  'IF observed_state IN (''failed'',''expired'',''canceled'') AND b.current_payment_attempt_id=a.id AND b.discount_redeemed_at IS NULL THEN PERFORM public.release_discount_redemption(b.booking_request_key); END IF;
  RETURN jsonb_build_object(''booking'', to_jsonb(b), ''attempt'', to_jsonb(a), ''applied'', true,
    ''newly_confirmed'', newly_confirmed');
 EXECUTE definition;
END; $$;

REVOKE ALL ON FUNCTION public.guard_discount_configuration(),public.consume_free_booking_discount(),
 public.reserve_discount_redemption(uuid,uuid,uuid,uuid,text,integer,uuid[],uuid),
 public.consume_discount_redemption(uuid,uuid,uuid,text,integer),public.release_discount_redemption(uuid),
 public.complete_free_discount_subscription(uuid),public.fulfill_payment_order(uuid,uuid,timestamptz,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_discount_redemption(uuid,uuid,uuid,uuid,text,integer,uuid[],uuid),
 public.consume_discount_redemption(uuid,uuid,uuid,text,integer),public.release_discount_redemption(uuid),
 public.complete_free_discount_subscription(uuid),public.fulfill_payment_order(uuid,uuid,timestamptz,text) TO service_role;
