BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.payment_orders ADD COLUMN subscription_checkout_closed_at timestamptz;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_orders WHERE kind = 'subscription'
    AND stripe_checkout_session_id IS NULL) THEN
    RAISE EXCEPTION 'Unbound legacy subscription orders must be reconciled before release';
  END IF;
END;
$$;
CREATE UNIQUE INDEX payment_orders_one_open_subscription
  ON public.payment_orders (buyer_id, creator_id)
  WHERE kind = 'subscription' AND subscription_checkout_closed_at IS NULL;

-- Retire old writers during deploy and rollback. Webhook fulfillment still
-- updates existing orders and issues provider-backed subscriptions.
CREATE FUNCTION private.require_subscription_checkout_protocol()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_setting('ardore.subscription_checkout', true) IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'Subscription checkout protocol required' USING ERRCODE = 'PT503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_subscription_checkout_order_protocol
  BEFORE INSERT ON public.payment_orders FOR EACH ROW
  WHEN (NEW.kind = 'subscription') EXECUTE FUNCTION private.require_subscription_checkout_protocol();
CREATE TRIGGER require_free_subscription_checkout_protocol
  BEFORE INSERT ON public.subscriptions FOR EACH ROW
  WHEN (left(NEW.stripe_subscription_id, 5) = 'free_')
  EXECUTE FUNCTION private.require_subscription_checkout_protocol();

CREATE FUNCTION public.prepare_subscription_checkout(
  p_id uuid, p_buyer_id uuid, p_creator_id uuid, p_tier_id uuid,
  p_discount_id uuid, p_account_id text, p_livemode boolean, p_app_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  tier public.subscription_tiers%ROWTYPE;
  existing public.payment_orders%ROWTYPE;
  redemption jsonb;
  cents integer;
  fee integer;
  expires_at timestamptz;
BEGIN
  -- Same lock as the existing discounted free-subscription RPC.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_buyer_id::text || ':' || p_creator_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE buyer_id = p_buyer_id AND creator_id = p_creator_id
      AND status <> 'canceled' AND (
        (left(stripe_subscription_id, 5) = 'free_' AND stripe_livemode IS NULL
          AND current_period_end > now())
        OR ((stripe_subscription_id IS NULL OR left(stripe_subscription_id, 5) <> 'free_')
          AND (stripe_livemode = p_livemode OR stripe_livemode IS NULL))
      )
  ) THEN
    RETURN jsonb_build_object('state', 'already_subscribed', 'active', EXISTS (
      SELECT 1 FROM public.subscriptions WHERE buyer_id = p_buyer_id AND creator_id = p_creator_id
        AND status = 'active' AND current_period_end > now()
        AND (stripe_livemode = p_livemode OR (stripe_livemode IS NULL AND left(stripe_subscription_id, 5) = 'free_'))
    ));
  END IF;

  SELECT * INTO existing FROM public.payment_orders
  WHERE kind = 'subscription' AND buyer_id = p_buyer_id AND creator_id = p_creator_id
    AND subscription_checkout_closed_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'checkout', 'order', to_jsonb(existing));
  END IF;

  SELECT * INTO tier FROM public.subscription_tiers
    WHERE id = p_tier_id AND creator_id = p_creator_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'tier_unavailable'); END IF;
  cents := round(tier.price_monthly * 100);
  IF cents IS NULL OR cents < 0 OR cents > 2000000000 THEN
    RAISE EXCEPTION 'Invalid subscription price' USING ERRCODE = '23514';
  END IF;

  IF p_discount_id IS NOT NULL AND cents > 0 THEN
    redemption := public.reserve_discount_redemption(p_id, p_discount_id, p_buyer_id,
      p_creator_id, 'subscriptions', cents, '{}', p_tier_id);
    IF redemption IS NULL OR redemption ? 'error' THEN
      RETURN jsonb_build_object('state', 'invalid_discount');
    END IF;
    cents := (redemption->>'final_cents')::integer;
  END IF;

  PERFORM set_config('ardore.subscription_checkout', 'v1', true);
  IF cents = 0 THEN
    IF redemption IS NOT NULL THEN
      redemption := public.complete_free_discount_subscription(p_id);
      RETURN jsonb_build_object('state', 'free', 'newly_created', redemption->'newly_created');
    END IF;
    INSERT INTO public.subscriptions
      (buyer_id, creator_id, tier_id, stripe_subscription_id, stripe_livemode, status, current_period_end)
      VALUES (p_buyer_id, p_creator_id, p_tier_id, 'free_' || p_id, NULL, 'active', now() + interval '100 years');
    RETURN jsonb_build_object('state', 'free', 'newly_created', true);
  END IF;
  -- Errors roll back any held discount in the same transaction.
  IF cents < 50 THEN RAISE EXCEPTION 'Subscription below minimum' USING ERRCODE = 'PT422'; END IF;
  IF p_account_id IS NULL OR p_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Subscription payout not ready' USING ERRCODE = 'PT424';
  END IF;
  expires_at := coalesce((redemption->>'expires_at')::timestamptz, now() + interval '45 minutes');
  fee := floor(cents::numeric / 10 + 0.5)::integer;
  INSERT INTO public.payment_orders
    (id, kind, buyer_id, creator_id, account_id, gross_cents, platform_fee_cents, coach_net_cents,
     stripe_livemode, reference)
  VALUES (p_id, 'subscription', p_buyer_id, p_creator_id, p_account_id, cents, fee, cents - fee,
    p_livemode,
    jsonb_build_object('tierId', p_tier_id, 'tierName', tier.name, 'appUrl', p_app_url,
      'checkoutExpiresAt', floor(extract(epoch FROM expires_at))) ||
    CASE WHEN redemption IS NULL THEN '{}'::jsonb ELSE
      jsonb_build_object('discountRedemptionId', p_id, 'discountId', p_discount_id) END)
  RETURNING * INTO existing;
  RETURN jsonb_build_object('state', 'checkout', 'order', to_jsonb(existing));
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_subscription_checkout(uuid,uuid,uuid,uuid,uuid,text,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_subscription_checkout(uuid,uuid,uuid,uuid,uuid,text,boolean,text)
  TO service_role;
COMMIT;
