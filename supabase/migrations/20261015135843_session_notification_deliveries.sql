-- Durable per-recipient, per-occurrence notification delivery. Preparing this
-- file does not authorize applying it to production. No historical rows are
-- backfilled and no Auth identities are inserted or modified.
BEGIN;

CREATE TABLE public.session_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('session_reminder', 'session_review_prompt')),
  channel text NOT NULL CHECK (channel IN ('inapp', 'email')),
  occurrence timestamptz NOT NULL CHECK (isfinite(occurrence)),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'sent', 'legacy_skipped', 'held')),
  lease_token uuid,
  lease_until timestamptz,
  first_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (booking_id, recipient_id, type, channel, occurrence),
  CHECK (state <> 'processing' OR
    (lease_token IS NOT NULL AND lease_until IS NOT NULL AND first_attempt_at IS NOT NULL)),
  CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);

-- The unique key already indexes booking_id for its FK; index the other FK too.
CREATE INDEX session_notification_deliveries_recipient_idx
  ON public.session_notification_deliveries(recipient_id);

ALTER TABLE public.session_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_notification_deliveries TO service_role;

-- Freeze the real migration-application time once, not the source-file date or
-- each cron invocation. This private constant bounds uncertain pre-outbox mail
-- without backfilling any customer records or adding configuration/state rows.
DO $rollout$
BEGIN
  EXECUTE format($definition$
    CREATE FUNCTION public.session_notification_rollout_at() RETURNS timestamptz
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
    AS $constant$ SELECT %L::timestamptz $constant$;
  $definition$, clock_timestamp());
END;
$rollout$;
REVOKE ALL ON FUNCTION public.session_notification_rollout_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_notification_rollout_at() TO service_role;

-- Match the existing application NotificationType union. This changes neither
-- notifications' policies nor browser grants.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'new_booking', 'booking_confirmed', 'new_subscriber', 'new_message',
  'session_reminder', 'new_review', 'session_review_prompt', 'new_video_class_booking'
));

CREATE FUNCTION public.claim_session_notification(
  p_booking_id uuid,
  p_recipient_id uuid,
  p_type text,
  p_channel text,
  p_occurrence timestamptz,
  p_payload jsonb,
  p_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  delivery public.session_notification_deliveries%ROWTYPE;
  expected_link text;
  observed timestamptz;
  rollout_at timestamptz := public.session_notification_rollout_at();
BEGIN
  IF p_booking_id IS NULL OR p_recipient_id IS NULL OR p_token IS NULL
    OR p_occurrence IS NULL OR NOT isfinite(p_occurrence)
    OR p_type IS NULL OR p_type NOT IN ('session_reminder', 'session_review_prompt')
    OR p_channel IS NULL OR p_channel NOT IN ('inapp', 'email')
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
  THEN RAISE EXCEPTION 'Invalid session notification input' USING ERRCODE = '23514'; END IF;

  expected_link := CASE p_type
    WHEN 'session_reminder' THEN '/session/' || p_booking_id::text
    ELSE '/buyer/sessions?review=' || p_booking_id::text END;
  IF p_channel = 'inapp' THEN
    IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
      OR length(btrim(p_payload->>'title')) = 0
      OR jsonb_typeof(p_payload->'message') IS DISTINCT FROM 'string'
      OR length(btrim(p_payload->>'message')) = 0
      OR p_payload->>'link' IS DISTINCT FROM expected_link
    THEN RAISE EXCEPTION 'Invalid in-app notification payload' USING ERRCODE = '23514'; END IF;
  ELSE
    IF jsonb_typeof(p_payload->'from') IS DISTINCT FROM 'string'
      OR length(btrim(p_payload->>'from')) = 0
      OR jsonb_typeof(p_payload->'to') IS DISTINCT FROM 'string'
      OR length(btrim(p_payload->>'to')) = 0
      OR jsonb_typeof(p_payload->'subject') IS DISTINCT FROM 'string'
      OR length(btrim(p_payload->>'subject')) = 0
      OR jsonb_typeof(p_payload->'html') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'text') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'Invalid email notification payload' USING ERRCODE = '23514'; END IF;
  END IF;

  INSERT INTO public.session_notification_deliveries
    (booking_id, recipient_id, type, channel, occurrence, payload)
  VALUES (p_booking_id, p_recipient_id, p_type, p_channel, p_occurrence, p_payload)
  ON CONFLICT (booking_id, recipient_id, type, channel, occurrence) DO NOTHING;

  -- INSERT ON CONFLICT serializes simultaneous first claims; the row lock also
  -- serializes retries/completions without holding a DB lock across HTTP calls.
  SELECT * INTO STRICT delivery FROM public.session_notification_deliveries
  WHERE booking_id = p_booking_id AND recipient_id = p_recipient_id
    AND type = p_type AND channel = p_channel AND occurrence = p_occurrence
  FOR UPDATE;
  observed := clock_timestamp();

  IF delivery.state IN ('sent', 'legacy_skipped', 'held') THEN
    RETURN jsonb_build_object('state', delivery.state);
  END IF;

  -- The old handler has no email ledger (including email-only preferences).
  -- Skip ended pre-rollout sessions and existing bookings in the old reminder
  -- horizon. This intentionally prioritizes avoiding ambiguous duplicate mail
  -- over catching up uncertain first-day reminders. New bookings are unaffected.
  -- Known old inbox markers also protect future/rescheduled historical work.
  -- Exclude this outbox's own successful in-app rows, including an earlier
  -- occurrence after rescheduling, so they never suppress the email channel.
  IF delivery.first_attempt_at IS NULL AND (EXISTS (
    SELECT 1 FROM public.bookings booking WHERE booking.id = p_booking_id AND (
      (p_type = 'session_review_prompt'
        AND p_occurrence + make_interval(mins => booking.duration_minutes) <= rollout_at)
      OR (p_type = 'session_reminder' AND booking.created_at < rollout_at
        AND p_occurrence <= rollout_at + interval '25 hours')
    )
  ) OR EXISTS (
    SELECT 1 FROM public.notifications notification
    WHERE notification.user_id = p_recipient_id AND notification.type = p_type
      AND notification.link = expected_link
      AND NOT EXISTS (
        SELECT 1 FROM public.session_notification_deliveries owned
        WHERE owned.id = notification.id AND owned.booking_id = p_booking_id
          AND owned.recipient_id = p_recipient_id AND owned.type = p_type
          AND owned.channel = 'inapp' AND owned.state = 'sent'
      )
  )) THEN
    UPDATE public.session_notification_deliveries SET state = 'legacy_skipped', payload = '{}'::jsonb
      WHERE id = delivery.id;
    RETURN jsonb_build_object('state', 'legacy_skipped');
  END IF;

  IF delivery.state = 'processing' AND delivery.lease_until > observed THEN
    RETURN jsonb_build_object('state', 'busy');
  END IF;

  -- Resend idempotency keys expire. An ambiguous delivery older than 23h needs
  -- human/provider reconciliation, never another potentially duplicate email.
  IF p_channel = 'email' AND delivery.first_attempt_at <= observed - interval '23 hours' THEN
    UPDATE public.session_notification_deliveries
      SET state = 'held', lease_token = NULL, lease_until = NULL
      WHERE id = delivery.id;
    RETURN jsonb_build_object('state', 'held');
  END IF;

  UPDATE public.session_notification_deliveries
    SET state = 'processing', lease_token = p_token,
      lease_until = observed + interval '5 minutes',
      first_attempt_at = coalesce(first_attempt_at, observed)
    WHERE id = delivery.id;
  RETURN jsonb_build_object('state', 'claimed', 'id', delivery.id, 'payload', delivery.payload);
END;
$$;

CREATE FUNCTION public.complete_session_notification(p_id uuid, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE delivery public.session_notification_deliveries%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
  SELECT * INTO delivery FROM public.session_notification_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR delivery.lease_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
  IF delivery.state = 'sent' THEN RETURN true; END IF;
  IF delivery.state <> 'processing' OR delivery.lease_until <= clock_timestamp() THEN RETURN false; END IF;

  IF delivery.channel = 'inapp' THEN
    INSERT INTO public.notifications(id, user_id, type, title, message, link)
    VALUES (delivery.id, delivery.recipient_id, delivery.type,
      delivery.payload->>'title', delivery.payload->>'message', delivery.payload->>'link');
  END IF;
  UPDATE public.session_notification_deliveries
    SET state = 'sent', sent_at = clock_timestamp(), lease_until = NULL, payload = '{}'::jsonb
    WHERE id = delivery.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_session_notification(p_id uuid, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
  UPDATE public.session_notification_deliveries
    SET state = 'pending', lease_token = NULL, lease_until = NULL
    WHERE id = p_id AND state = 'processing' AND lease_token = p_token
      AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_session_notification(uuid, uuid, text, text, timestamptz, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_session_notification(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_session_notification(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_session_notification(uuid, uuid, text, text, timestamptz, jsonb, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_session_notification(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_session_notification(uuid, uuid) TO service_role;

COMMIT;
