-- Isolated synthetic application fixture, never a linked/production database.
-- Existing Supabase roles required. No auth.users table or GoTrue records.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $$ BEGIN
 IF current_database()<>'ardore_group_payments_test' OR current_setting('ardore.isolated_sql_test',true) IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Explicit disposable ardore_group_payments_test database required'; END IF;
 IF to_regnamespace('auth') IS NOT NULL OR to_regnamespace('private') IS NOT NULL OR to_regclass('public.video_classes') IS NOT NULL
 THEN RAISE EXCEPTION 'New empty fixture database required'; END IF;
END; $$;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,private,public TO anon,authenticated,service_role;
CREATE TABLE public.creator_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL UNIQUE,is_published boolean NOT NULL,slug text NOT NULL);
CREATE TABLE public.subscription_tiers(id uuid PRIMARY KEY,creator_id uuid NOT NULL REFERENCES public.creator_profiles(id));
CREATE TABLE public.subscriptions(id uuid PRIMARY KEY,buyer_id uuid NOT NULL,creator_id uuid NOT NULL,tier_id uuid NOT NULL REFERENCES public.subscription_tiers(id),status text NOT NULL,current_period_end timestamptz NOT NULL,stripe_subscription_id text NOT NULL,stripe_livemode boolean);
CREATE TABLE public.video_classes(id uuid PRIMARY KEY,creator_id uuid NOT NULL REFERENCES public.creator_profiles(id),title text NOT NULL,description text,schedule_type text NOT NULL,starts_at timestamptz,recurring_weekday smallint,recurring_time text,duration_minutes integer NOT NULL DEFAULT 60,max_participants integer,price_cents integer NOT NULL DEFAULT 0,included_in_subscription boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.video_class_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),video_class_id uuid NOT NULL REFERENCES public.video_classes(id) ON DELETE CASCADE,user_id uuid NOT NULL,subscription_id uuid REFERENCES public.subscriptions(id),price_paid_cents integer NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'confirmed' CHECK(status IN('confirmed','cancelled')),daily_room_url text,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT video_class_bookings_video_class_id_user_id_key UNIQUE(video_class_id,user_id));
CREATE TABLE public.payment_orders(id uuid PRIMARY KEY,kind text NOT NULL CONSTRAINT payment_orders_kind_check CHECK(kind IN('booking','products','subscription')),buyer_id uuid NOT NULL,creator_id uuid NOT NULL,account_id text,gross_cents integer NOT NULL,platform_fee_cents integer NOT NULL,coach_net_cents integer NOT NULL,currency text NOT NULL DEFAULT'eur',stripe_livemode boolean NOT NULL,reference jsonb NOT NULL,stripe_checkout_session_id text,stripe_subscription_id text,state text NOT NULL DEFAULT'created',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.payment_settlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.payment_orders(id),kind text NOT NULL CONSTRAINT payment_settlements_kind_check CHECK(kind IN('booking','products','subscription')),buyer_id uuid NOT NULL,creator_id uuid NOT NULL,account_id text NOT NULL,gross_cents integer NOT NULL,platform_fee_cents integer NOT NULL,coach_net_cents integer NOT NULL,stripe_livemode boolean NOT NULL,stripe_payment_intent_id text NOT NULL,fulfillment_state text NOT NULL DEFAULT'awaiting',state text NOT NULL DEFAULT'awaiting_fulfillment',amount_refunded_cents integer NOT NULL DEFAULT 0,refund_requested_cents integer NOT NULL DEFAULT 0,stripe_transfer_id text,updated_at timestamptz NOT NULL DEFAULT now());
-- Stubs model the pre-existing wrapped function contracts only. Their original
-- financial behavior has separate repository regressions; this fixture proves
-- group dispatch and that non-group calls still delegate to those contracts.
CREATE FUNCTION public.fulfill_payment_order(p_order_id uuid,p_settlement_id uuid DEFAULT NULL,p_period_end timestamptz DEFAULT NULL,p_subscription_status text DEFAULT'active') RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT jsonb_build_object('legacy_delegate',true,'order',p_order_id) $$;
CREATE FUNCTION public.claim_settlement_action(p_settlement_id uuid,p_kind text,p_target_cents integer,p_amount_cents integer,p_lease_token uuid) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT jsonb_build_object('legacy_delegate',true) $$;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_class_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_public ON public.creator_profiles FOR SELECT USING(is_published OR user_id=(SELECT auth.uid()));
CREATE POLICY class_public ON public.video_classes FOR SELECT USING(active);
CREATE POLICY class_owner ON public.video_classes FOR ALL TO authenticated USING(creator_id IN(SELECT id FROM public.creator_profiles WHERE user_id=(SELECT auth.uid()))) WITH CHECK(creator_id IN(SELECT id FROM public.creator_profiles WHERE user_id=(SELECT auth.uid())));
CREATE POLICY booking_owner ON public.video_class_bookings FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON public.payment_orders,public.payment_settlements FROM PUBLIC,anon,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.creator_profiles,public.video_classes,public.video_class_bookings TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.video_classes TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
INSERT INTO public.creator_profiles VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',true,'fixture-coach');
INSERT INTO public.video_classes(id,creator_id,title,schedule_type,starts_at,recurring_weekday,recurring_time,max_participants,price_cents) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic single-capacity class','once',date_trunc('minute',now()+interval'2 days'),NULL,NULL,1,500),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Synthetic free recurring class','recurring',NULL,2,'18:00',9,0),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Synthetic late-payment class','once',date_trunc('minute',now()+interval'3 days'),NULL,NULL,1,500);
COMMIT;
