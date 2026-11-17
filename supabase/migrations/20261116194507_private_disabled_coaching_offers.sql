BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER POLICY coaching_offers_select ON public.coaching_offers USING (
  (is_enabled AND private.can_read_coach(creator_id))
  OR creator_id IN (
    SELECT c.id FROM public.creator_profiles c WHERE c.user_id = (SELECT auth.uid())
  )
);

-- An enabled offer must also be visible under its own SELECT policy.
ALTER POLICY availability_slots_select ON public.availability_slots USING (
  creator_id IN (
    SELECT c.id FROM public.creator_profiles c WHERE c.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.coaching_offers o
    WHERE o.creator_id = availability_slots.creator_id AND o.is_enabled
  )
);

ALTER POLICY "Public can read date overrides" ON public.date_overrides USING (
  creator_id IN (
    SELECT c.id FROM public.creator_profiles c WHERE c.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.coaching_offers o
    WHERE o.creator_id = date_overrides.creator_id AND o.is_enabled
  )
);

COMMIT;
