-- Future transitions only: do not backfill historical cancellations/refunds.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.coaching_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_kind text NOT NULL CHECK (booking_kind IN ('individual','group')),
 booking_id uuid NOT NULL,
 event_kind text NOT NULL CHECK (event_kind IN ('cancellation','refund')),
 event_version integer NOT NULL CHECK (event_version >= 0),
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 recipient_role text NOT NULL CHECK (recipient_role IN ('customer','coach')),
 details jsonb NOT NULL,
 payload jsonb,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','sent','held')),
 lease_token uuid, lease_until timestamptz, first_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE (booking_kind, booking_id, event_kind, event_version, recipient_id),
 CHECK (state <> 'processing' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND first_attempt_at IS NOT NULL)),
 CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX coaching_email_pending_idx ON public.coaching_email_deliveries(id) WHERE state IN ('pending','processing');
CREATE INDEX coaching_email_recipient_idx ON public.coaching_email_deliveries(recipient_id);
ALTER TABLE public.coaching_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coaching_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.coaching_email_deliveries TO service_role;

-- Invoker permissions preserve the existing service-only mutation boundary.
CREATE FUNCTION private.queue_coaching_emails() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE customer uuid; coach uuid; coach_name text; title text; scheduled timestamptz;
 kind text; details jsonb; refund_delta integer; recipient record; event record;
BEGIN
 IF NOT (NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
   AND NEW.amount_refunded_cents <= OLD.amount_refunded_cents THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='bookings' THEN
  kind := 'individual'; customer := NEW.buyer_id; scheduled := NEW.scheduled_at; title := '1:1-Coaching';
  SELECT c.user_id,c.display_name INTO coach,coach_name FROM public.creator_profiles c WHERE c.id=NEW.creator_id;
 ELSE
  kind := 'group'; customer := NEW.user_id; scheduled := NEW.occurrence_start; title := coalesce(NEW.class_title,'Gruppencoaching');
  SELECT c.user_id,c.display_name INTO coach,coach_name FROM public.video_classes v
   JOIN public.creator_profiles c ON c.id=v.creator_id WHERE v.id=NEW.video_class_id;
 END IF;
 -- Legacy group registrations have no trustworthy occurrence snapshot.
 IF scheduled IS NULL THEN RETURN NEW; END IF;
 refund_delta := NEW.amount_refunded_cents - OLD.amount_refunded_cents;
 details := jsonb_build_object('title',title,'scheduled_at',scheduled,'coach_name',coalesce(coach_name,'Dein Coach'),
  'customer_id',customer,'coach_id',coach,'amount_cents',refund_delta,
  'total_refunded_cents',NEW.amount_refunded_cents);
 FOR event IN
  SELECT 'cancellation'::text AS kind,0 AS version WHERE NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
  UNION ALL SELECT 'refund',NEW.amount_refunded_cents WHERE refund_delta>0
    AND NEW.payment_status IN ('refunded','partially_refunded')
 LOOP
  FOR recipient IN SELECT customer AS id,'customer'::text AS role WHERE customer IS NOT NULL
   UNION ALL SELECT coach,'coach' WHERE coach IS NOT NULL AND coach IS DISTINCT FROM customer
  LOOP
   INSERT INTO public.coaching_email_deliveries(booking_kind,booking_id,event_kind,event_version,recipient_id,recipient_role,details)
    VALUES(kind,NEW.id,event.kind,event.version,recipient.id,recipient.role,details)
    ON CONFLICT (booking_kind,booking_id,event_kind,event_version,recipient_id) DO NOTHING;
  END LOOP;
 END LOOP;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.queue_coaching_emails() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.queue_coaching_emails() TO service_role;
CREATE TRIGGER queue_individual_coaching_emails AFTER UPDATE OF status,amount_refunded_cents ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION private.queue_coaching_emails();
CREATE TRIGGER queue_group_coaching_emails AFTER UPDATE OF status,amount_refunded_cents ON public.video_class_bookings
 FOR EACH ROW EXECUTE FUNCTION private.queue_coaching_emails();

CREATE FUNCTION public.claim_coaching_email(p_id uuid,p_payload jsonb,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.coaching_email_deliveries%ROWTYPE; observed timestamptz;
BEGIN
 IF p_token IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
  OR jsonb_typeof(p_payload->'from') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'to') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'to'))=0
  OR jsonb_typeof(p_payload->'subject') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'html') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'text') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'Invalid coaching email input' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM public.coaching_email_deliveries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
 observed := clock_timestamp();
 IF d.state IN ('sent','held') THEN RETURN jsonb_build_object('state',d.state); END IF;
 IF d.state='processing' AND d.lease_until>observed THEN RETURN jsonb_build_object('state','busy'); END IF;
 -- Resend guarantees idempotency for 24h. Hold ambiguous outcomes before expiry.
 IF d.first_attempt_at <= observed-interval '23 hours' THEN
  UPDATE public.coaching_email_deliveries SET state='held',lease_token=NULL,lease_until=NULL WHERE id=d.id;
  RETURN jsonb_build_object('state','held');
 END IF;
 UPDATE public.coaching_email_deliveries SET state='processing',lease_token=p_token,
  lease_until=observed+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,observed),
  payload=coalesce(payload,p_payload) WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('state','claimed','payload',d.payload);
END; $$;
CREATE FUNCTION public.complete_coaching_email(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.coaching_email_deliveries SET state='sent',sent_at=clock_timestamp(),lease_until=NULL,
  payload=NULL,details='{}'::jsonb WHERE id=p_id AND state='processing' AND lease_token=p_token AND lease_until>clock_timestamp();
 RETURN FOUND;
END; $$;
CREATE FUNCTION public.fail_coaching_email(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.coaching_email_deliveries SET state='pending',lease_token=NULL,lease_until=NULL
  WHERE id=p_id AND state='processing' AND lease_token=p_token AND lease_until>clock_timestamp();
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.claim_coaching_email(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_coaching_email(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_coaching_email(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coaching_email(uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_coaching_email(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_coaching_email(uuid,uuid) TO service_role;
COMMIT;
