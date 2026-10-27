-- Disposable SQL fixture: no auth.users table or GoTrue rows are created.
DO $$ BEGIN
  IF current_database() <> 'ardore_group_reminders_test'
    OR current_setting('ardore.isolated_sql_test', true) IS DISTINCT FROM 'true'
    OR to_regclass('public.video_classes') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL
  THEN RAISE EXCEPTION 'New isolated group reminders test database required'; END IF;
END $$;
CREATE TABLE public.fixture_users(id uuid PRIMARY KEY);
INSERT INTO public.fixture_users SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,12) i;
CREATE TABLE public.creator_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL,display_name text NOT NULL);
CREATE TABLE public.video_classes(id uuid PRIMARY KEY,creator_id uuid NOT NULL REFERENCES public.creator_profiles(id));
CREATE TABLE public.video_class_occurrences(video_class_id uuid NOT NULL REFERENCES public.video_classes(id),starts_at timestamptz NOT NULL,class_title text NOT NULL,duration_minutes integer NOT NULL,PRIMARY KEY(video_class_id,starts_at));
CREATE TABLE public.video_class_bookings(id uuid PRIMARY KEY,video_class_id uuid NOT NULL,user_id uuid NOT NULL,occurrence_start timestamptz NOT NULL,reservation_id uuid NOT NULL,status text NOT NULL,refund_status text NOT NULL DEFAULT 'not_requested',amount_refunded_cents integer NOT NULL DEFAULT 0,price_paid_cents integer NOT NULL DEFAULT 0,payment_status text NOT NULL DEFAULT 'not_required',stripe_livemode boolean);
CREATE TABLE public.group_booking_reservations(id uuid PRIMARY KEY,booking_id uuid NOT NULL,video_class_id uuid NOT NULL,occurrence_start timestamptz NOT NULL,buyer_id uuid NOT NULL,creator_id uuid NOT NULL,status text NOT NULL,refund_status text NOT NULL DEFAULT 'not_requested',amount_refunded_cents integer NOT NULL DEFAULT 0,price_cents integer NOT NULL DEFAULT 0,stripe_livemode boolean);
CREATE TABLE public.notification_preferences(user_id uuid PRIMARY KEY,email_session_reminder boolean NOT NULL DEFAULT true);
INSERT INTO public.creator_profiles VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Testcoach');
INSERT INTO public.video_classes VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.video_class_occurrences VALUES('20000000-0000-4000-8000-000000000001',date_trunc('minute',now()+interval '2 hours'),'Frozen group title',45);
-- Two free participants, a LIVE-paid participant, a paid TEST registration,
-- cancelled/refunding registrations and an unknown legacy payment.
INSERT INTO public.video_class_bookings
 SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,o.video_class_id,
 ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,o.starts_at,
 ('40000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=6 THEN 'cancelled' ELSE 'confirmed' END,
 CASE WHEN i=7 THEN 'pending' ELSE 'not_requested' END,0,
 CASE WHEN i IN(4,5) THEN 500 ELSE 0 END,
 CASE WHEN i IN(4,5) THEN 'paid' WHEN i=8 THEN 'unknown' ELSE 'not_required' END,
 CASE WHEN i=4 THEN true WHEN i=5 THEN false ELSE NULL END
 FROM public.video_class_occurrences o CROSS JOIN generate_series(2,8) i;
INSERT INTO public.group_booking_reservations
 SELECT b.reservation_id,b.id,b.video_class_id,b.occurrence_start,b.user_id,'10000000-0000-4000-8000-000000000001',
 CASE WHEN b.status='cancelled' THEN 'cancelled' ELSE 'confirmed' END,b.refund_status,0,b.price_paid_cents,b.stripe_livemode FROM public.video_class_bookings b;
ALTER TABLE public.fixture_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_class_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_class_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_booking_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
