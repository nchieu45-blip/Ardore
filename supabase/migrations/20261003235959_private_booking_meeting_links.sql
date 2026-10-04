-- Private attendance data is separate from publicly readable offer/profile data.
CREATE TABLE public.booking_meeting_links (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  meeting_url text NOT NULL CHECK (
    length(meeting_url) BETWEEN 10 AND 2048
    AND meeting_url ~ '^https://[a-zA-Z0-9.-]+(/|:443/|$)'
    AND meeting_url !~ '[[:space:][:cntrl:]]'
  ),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_meeting_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_meeting_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_meeting_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_meeting_links TO service_role;

CREATE POLICY booking_meeting_participants_read ON public.booking_meeting_links
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.creator_profiles c ON c.id = b.creator_id
    WHERE b.id = booking_id
      AND (b.buyer_id = (SELECT auth.uid()) OR c.user_id = (SELECT auth.uid()))
      AND b.status = 'confirmed'
      AND (b.payment_status = 'not_required' OR (b.payment_status = 'paid' AND b.stripe_livemode IS TRUE))
      AND b.scheduled_at + make_interval(mins => b.duration_minutes) > now()
  )
);

-- Server-only, invoker permissions. The booking lock serializes against the
-- existing cancellation/rescheduling writes without changing their behavior.
CREATE FUNCTION public.set_booking_meeting_link(p_booking_id uuid, p_coach_user_id uuid, p_meeting_url text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE;
BEGIN
  SELECT booking.* INTO b FROM public.bookings booking
  JOIN public.creator_profiles c ON c.id = booking.creator_id
  WHERE booking.id = p_booking_id AND c.user_id = p_coach_user_id
  FOR UPDATE OF booking;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF b.status <> 'confirmed'
    OR NOT (b.payment_status = 'not_required' OR (b.payment_status = 'paid' AND b.stripe_livemode IS TRUE))
    OR b.scheduled_at + make_interval(mins => b.duration_minutes) <= now()
    THEN RETURN 'not_editable'; END IF;
  IF p_meeting_url IS NULL OR length(p_meeting_url) > 2048
    OR p_meeting_url !~ '^https://[a-zA-Z0-9.-]+(/|:443/|$)'
    OR p_meeting_url ~ '[[:space:][:cntrl:]]' THEN RETURN 'invalid_url'; END IF;
  INSERT INTO public.booking_meeting_links(booking_id, meeting_url) VALUES (b.id, p_meeting_url)
  ON CONFLICT (booking_id) DO UPDATE SET meeting_url = EXCLUDED.meeting_url, updated_at = now()
  WHERE booking_meeting_links.meeting_url IS DISTINCT FROM EXCLUDED.meeting_url;
  IF FOUND AND b.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, message, link)
    VALUES(b.buyer_id, 'booking_confirmed', 'Meeting-Link verfügbar',
      'Dein Coach hat den Meeting-Link für deine Session hinterlegt oder aktualisiert. Auf der Session-Seite findest du den aktuellen Link.', '/session/' || b.id::text);
  END IF;
  RETURN 'saved';
END;
$$;
REVOKE ALL ON FUNCTION public.set_booking_meeting_link(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_booking_meeting_link(uuid, uuid, text) TO service_role;

-- A booking does not grant the subscription-only chat entitlement. Instead a
-- buyer can request a missing link via one private, deduplicated coach notice.
CREATE FUNCTION public.request_booking_meeting_link(p_booking_id uuid, p_buyer_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; coach_user_id uuid;
BEGIN
  SELECT booking.* INTO b FROM public.bookings booking
  WHERE booking.id = p_booking_id AND booking.buyer_id = p_buyer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF b.status <> 'confirmed'
    OR NOT (b.payment_status = 'not_required' OR (b.payment_status = 'paid' AND b.stripe_livemode IS TRUE))
    OR b.scheduled_at + make_interval(mins => b.duration_minutes) <= now()
    THEN RETURN 'not_editable'; END IF;
  IF EXISTS(SELECT 1 FROM public.booking_meeting_links WHERE booking_id = b.id) THEN RETURN 'already_ready'; END IF;
  SELECT user_id INTO coach_user_id FROM public.creator_profiles WHERE id = b.creator_id;
  IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id = coach_user_id
    AND type = 'new_booking' AND title = 'Meeting-Link benötigt' AND link = '/session/' || b.id::text) THEN
    INSERT INTO public.notifications(user_id, type, title, message, link)
    VALUES(coach_user_id, 'new_booking', 'Meeting-Link benötigt',
      'Dein Kunde bittet um den Meeting-Link für eine bestätigte Session. Bitte öffne den Termin und hinterlege den Link.', '/session/' || b.id::text);
  END IF;
  RETURN 'requested';
END;
$$;
REVOKE ALL ON FUNCTION public.request_booking_meeting_link(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_booking_meeting_link(uuid, uuid) TO service_role;
