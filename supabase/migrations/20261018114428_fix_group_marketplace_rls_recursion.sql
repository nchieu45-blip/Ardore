-- Preserve the existing class visibility rules while breaking the RLS cycle:
-- video_classes -> video_class_bookings -> video_classes.
-- This private lookup returns only whether the current caller has a booking.
-- It accepts no caller-selected user identity and exposes no enrollment data.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.has_own_video_class_booking(p_video_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.video_class_bookings AS booking
      WHERE booking.video_class_id = p_video_class_id
        AND booking.user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.has_own_video_class_booking(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_own_video_class_booking(uuid)
  TO anon, authenticated, service_role;

-- Booking status intentionally remains unrestricted, as in the prior policy:
-- existing participants retain access to their class after changes/cancellation.
-- Creator management and booking SELECT/write policies are left intact.
ALTER POLICY "Public can view active video classes" ON public.video_classes
  USING (
    (active AND private.coach_is_public(creator_id))
    OR private.has_own_video_class_booking(id)
  );

COMMENT ON FUNCTION private.has_own_video_class_booking(uuid) IS
  'RLS-only current-user enrollment lookup; breaks class/booking policy recursion without exposing booking rows.';

NOTIFY pgrst, 'reload schema';

COMMIT;
