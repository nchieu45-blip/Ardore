-- Additive, service-only reminder delivery. No historical email is backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE INDEX video_class_occurrences_reminder_time_idx
  ON public.video_class_occurrences(starts_at, video_class_id);

-- Both sides of the immutable booking agreement must still grant attendance.
-- Historical registrations without an occurrence/reservation are not guessed.
CREATE VIEW public.group_reminder_recipients WITH (security_invoker = true) AS
WITH attendees AS NOT MATERIALIZED (
  SELECT o.video_class_id, o.starts_at AS occurrence_start, b.user_id,
    c.user_id AS coach_id, o.class_title, o.duration_minutes, c.display_name AS coach_name
  FROM public.video_class_occurrences o
  JOIN public.video_classes v ON v.id = o.video_class_id
  JOIN public.creator_profiles c ON c.id = v.creator_id
  JOIN public.video_class_bookings b ON b.video_class_id = o.video_class_id AND b.occurrence_start = o.starts_at
  JOIN public.group_booking_reservations r ON r.id = b.reservation_id AND r.booking_id = b.id
    AND r.video_class_id = o.video_class_id AND r.occurrence_start = o.starts_at
    AND r.buyer_id = b.user_id AND r.creator_id = v.creator_id
  WHERE o.starts_at > now() AND o.starts_at <= now() + interval '24 hours'
    AND b.status = 'confirmed' AND r.status = 'confirmed'
    AND b.refund_status = 'not_requested' AND r.refund_status = 'not_requested'
    AND b.amount_refunded_cents = 0 AND r.amount_refunded_cents = 0
    AND ((b.price_paid_cents = 0 AND r.price_cents = 0 AND b.payment_status = 'not_required')
      OR (b.price_paid_cents > 0 AND b.price_paid_cents = r.price_cents
        AND b.payment_status = 'paid' AND b.stripe_livemode IS TRUE AND r.stripe_livemode IS TRUE))
)
SELECT video_class_id, occurrence_start, user_id AS recipient_id, 'participant'::text AS recipient_role,
  class_title, duration_minutes, coach_name FROM attendees WHERE user_id <> coach_id
UNION
SELECT video_class_id, occurrence_start, coach_id, 'coach'::text,
  class_title, duration_minutes, coach_name FROM attendees;
REVOKE ALL ON public.group_reminder_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.group_reminder_recipients TO service_role;

CREATE TABLE public.group_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_class_id uuid NOT NULL,
  occurrence_start timestamptz NOT NULL CHECK (isfinite(occurrence_start)),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role text NOT NULL CHECK (recipient_role IN ('participant', 'coach')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'sent', 'held')),
  lease_token uuid,
  lease_until timestamptz,
  first_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  FOREIGN KEY (video_class_id, occurrence_start)
    REFERENCES public.video_class_occurrences(video_class_id, starts_at) ON DELETE RESTRICT,
  UNIQUE (video_class_id, occurrence_start, recipient_id),
  CHECK (state <> 'processing' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND first_attempt_at IS NOT NULL)),
  CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX group_reminder_deliveries_recipient_idx ON public.group_reminder_deliveries(recipient_id);
ALTER TABLE public.group_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_reminder_deliveries TO service_role;

CREATE FUNCTION public.group_reminder_is_eligible(p_class_id uuid, p_occurrence timestamptz, p_recipient_id uuid, p_role text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_occurrence > clock_timestamp() AND p_occurrence <= clock_timestamp() + interval '24 hours'
    AND EXISTS (SELECT 1 FROM public.group_reminder_recipients r
      WHERE r.video_class_id = p_class_id AND r.occurrence_start = p_occurrence
        AND r.recipient_id = p_recipient_id AND r.recipient_role = p_role)
    AND NOT EXISTS (SELECT 1 FROM public.notification_preferences p
      WHERE p.user_id = p_recipient_id AND p.email_session_reminder IS FALSE);
$$;

CREATE FUNCTION public.claim_group_reminder(p_class_id uuid, p_occurrence timestamptz, p_recipient_id uuid,
  p_role text, p_payload jsonb, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.group_reminder_deliveries%ROWTYPE; observed timestamptz;
BEGIN
  IF p_class_id IS NULL OR p_recipient_id IS NULL OR p_token IS NULL OR p_occurrence IS NULL
    OR NOT isfinite(p_occurrence) OR p_role IS NULL OR p_role NOT IN ('participant', 'coach')
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR jsonb_typeof(p_payload->'from') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'from')) = 0
    OR jsonb_typeof(p_payload->'to') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'to')) = 0
    OR jsonb_typeof(p_payload->'subject') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'subject')) = 0
    OR jsonb_typeof(p_payload->'html') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'text') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'Invalid group reminder input' USING ERRCODE = '23514'; END IF;
  IF NOT public.group_reminder_is_eligible(p_class_id, p_occurrence, p_recipient_id, p_role) THEN
    RETURN jsonb_build_object('state', 'ineligible');
  END IF;
  INSERT INTO public.group_reminder_deliveries(video_class_id, occurrence_start, recipient_id, recipient_role, payload)
    VALUES (p_class_id, p_occurrence, p_recipient_id, p_role, p_payload)
    ON CONFLICT (video_class_id, occurrence_start, recipient_id) DO NOTHING;
  SELECT * INTO STRICT d FROM public.group_reminder_deliveries
    WHERE video_class_id = p_class_id AND occurrence_start = p_occurrence AND recipient_id = p_recipient_id FOR UPDATE;
  observed := clock_timestamp();
  IF d.recipient_role IS DISTINCT FROM p_role THEN RETURN jsonb_build_object('state', 'ineligible'); END IF;
  IF d.state IN ('sent', 'held') THEN RETURN jsonb_build_object('state', d.state); END IF;
  IF d.state = 'processing' AND d.lease_until > observed THEN RETURN jsonb_build_object('state', 'busy'); END IF;
  IF NOT public.group_reminder_is_eligible(p_class_id, p_occurrence, p_recipient_id, p_role) THEN
    RETURN jsonb_build_object('state', 'ineligible');
  END IF;
  -- Resend retains idempotency keys for 24h. Do not risk resending an ambiguous
  -- provider outcome after that window; require operator reconciliation instead.
  IF d.first_attempt_at <= observed - interval '23 hours' THEN
    UPDATE public.group_reminder_deliveries SET state = 'held', lease_token = NULL, lease_until = NULL WHERE id = d.id;
    RETURN jsonb_build_object('state', 'held');
  END IF;
  UPDATE public.group_reminder_deliveries SET state = 'processing', lease_token = p_token,
    lease_until = observed + interval '5 minutes', first_attempt_at = coalesce(first_attempt_at, observed) WHERE id = d.id;
  RETURN jsonb_build_object('state', 'claimed', 'id', d.id, 'payload', d.payload);
END;
$$;

CREATE FUNCTION public.complete_group_reminder(p_id uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.group_reminder_deliveries%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
  SELECT * INTO d FROM public.group_reminder_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR d.lease_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
  IF d.state = 'sent' THEN RETURN true; END IF;
  IF d.state <> 'processing' OR d.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  UPDATE public.group_reminder_deliveries SET state = 'sent', sent_at = clock_timestamp(),
    lease_until = NULL, payload = '{}'::jsonb WHERE id = d.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_group_reminder(p_id uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
  UPDATE public.group_reminder_deliveries SET state = 'pending', lease_token = NULL, lease_until = NULL
    WHERE id = p_id AND state = 'processing' AND lease_token = p_token AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.group_reminder_is_eligible(uuid, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_group_reminder(uuid, timestamptz, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_group_reminder(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_group_reminder(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_reminder_is_eligible(uuid, timestamptz, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_group_reminder(uuid, timestamptz, uuid, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_group_reminder(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_group_reminder(uuid, uuid) TO service_role;
COMMIT;
