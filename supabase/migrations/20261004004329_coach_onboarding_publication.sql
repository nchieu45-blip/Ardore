-- New coaches start private. Preserve all complete existing profiles and data.
ALTER TABLE public.creator_profiles
  ADD COLUMN is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN onboarding_step smallint NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 5);
CREATE UNIQUE INDEX creator_profiles_one_per_user ON public.creator_profiles(user_id);

CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.coach_profile_complete(p_name text, p_slug text, p_categories text[], p_category text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(length(btrim(p_name)) BETWEEN 2 AND 50
    AND p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND (EXISTS (SELECT 1 FROM unnest(p_categories) c WHERE nullif(btrim(c),'') IS NOT NULL)
      OR nullif(btrim(p_category),'') IS NOT NULL), false);
$$;
REVOKE ALL ON FUNCTION private.coach_profile_complete(text,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.coach_profile_complete(text,text,text[],text) TO service_role;
UPDATE public.creator_profiles SET is_published=true, onboarding_step=5
WHERE private.coach_profile_complete(display_name,slug,categories,category);
-- New authority fields are service-controlled, never coach-writable.
REVOKE INSERT (is_published,onboarding_step), UPDATE (is_published,onboarding_step)
  ON public.creator_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT (is_published,onboarding_step) ON public.creator_profiles TO anon,authenticated;

-- Reject invalid required edits instead of silently unpublishing an existing coach.
CREATE FUNCTION private.guard_coach_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_published AND (NEW.onboarding_step <> 5 OR NOT private.coach_profile_complete(NEW.display_name,NEW.slug,NEW.categories,NEW.category)) THEN
    RAISE EXCEPTION 'Veröffentlichtes Profil benötigt einen Namen (2–50 Zeichen), eine gültige Profiladresse und mindestens eine Kategorie.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_coach_publication() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_coach_publication BEFORE INSERT OR UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_coach_publication();

-- Internal boolean lookup avoids recursive creator -> booking -> creator RLS.
-- It exposes no profile fields and accepts no caller-selected user identity.
CREATE FUNCTION private.can_read_coach(p_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.creator_profiles c WHERE c.id=p_creator_id
    AND (c.is_published OR ((SELECT auth.uid()) IS NOT NULL AND (
      c.user_id=(SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.creator_id=c.id AND b.buyer_id=(SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.creator_id=c.id AND s.buyer_id=(SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.purchases p JOIN public.products product ON product.id=p.product_id
        WHERE product.creator_id=c.id AND p.buyer_id=(SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.chat_conversations chat WHERE chat.creator_id=c.id AND chat.buyer_id=(SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.video_class_bookings vb JOIN public.video_classes vc ON vc.id=vb.video_class_id
        WHERE vc.creator_id=c.id AND vb.user_id=(SELECT auth.uid()))
    ))));
$$;
CREATE FUNCTION private.coach_is_public(p_creator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.creator_profiles WHERE id=p_creator_id AND is_published);
$$;
REVOKE ALL ON FUNCTION private.can_read_coach(uuid), private.coach_is_public(uuid) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO anon,authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_coach(uuid), private.coach_is_public(uuid) TO anon,authenticated,service_role;
ALTER POLICY creator_profiles_select_all ON public.creator_profiles USING (private.can_read_coach(id));
ALTER POLICY products_select_published ON public.products USING (
  (is_published AND private.coach_is_public(creator_id))
  OR (SELECT auth.uid())=(SELECT c.user_id FROM public.creator_profiles c WHERE c.id=creator_id)
  OR EXISTS (SELECT 1 FROM public.purchases p WHERE p.product_id=products.id AND p.buyer_id=(SELECT auth.uid()))
);
ALTER POLICY tiers_select_active ON public.subscription_tiers USING (
  (is_active AND private.coach_is_public(creator_id))
  OR (SELECT auth.uid())=(SELECT c.user_id FROM public.creator_profiles c WHERE c.id=creator_id)
  OR EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.tier_id=subscription_tiers.id AND s.buyer_id=(SELECT auth.uid()))
);
ALTER POLICY coaching_offers_select ON public.coaching_offers USING (private.can_read_coach(creator_id));
ALTER POLICY availability_slots_select ON public.availability_slots USING (private.can_read_coach(creator_id));
ALTER POLICY "Public can read date overrides" ON public.date_overrides USING (private.can_read_coach(creator_id));
ALTER POLICY "Public can view active video classes" ON public.video_classes USING (
  (active AND private.coach_is_public(creator_id))
  OR EXISTS (SELECT 1 FROM public.video_class_bookings vb WHERE vb.video_class_id=video_classes.id AND vb.user_id=(SELECT auth.uid()))
);

-- One locked transaction creates the optional offer and advances the step.
-- Retrying a completed step returns current progress without duplicate offers.
CREATE FUNCTION public.advance_coach_onboarding(p_user_id uuid,p_expected_step integer,p_data jsonb DEFAULT '{}',p_publish boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.creator_profiles; profile_slug text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('coach-onboarding:'||p_user_id::text,0));
  SELECT * INTO c FROM public.creator_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF c.id IS NULL THEN
    IF p_expected_step<>1 OR p_publish THEN RAISE EXCEPTION 'Bitte zuerst Profilangaben speichern.' USING ERRCODE='22023'; END IF;
    profile_slug:=p_data->>'slug';
    IF NOT private.coach_profile_complete(p_data->>'display_name',profile_slug,ARRAY(SELECT jsonb_array_elements_text(p_data->'categories')),p_data->>'category') THEN
      RAISE EXCEPTION 'Name und mindestens eine Kategorie sind erforderlich.' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.creator_profiles(user_id,display_name,slug,bio,category,categories,onboarding_step)
      VALUES(p_user_id,p_data->>'display_name',profile_slug,nullif(p_data->>'bio',''),p_data->>'category',ARRAY(SELECT jsonb_array_elements_text(p_data->'categories')),2) RETURNING * INTO c;
  ELSIF p_publish THEN
    IF c.onboarding_step<>5 OR NOT private.coach_profile_complete(c.display_name,c.slug,c.categories,c.category) THEN
      RAISE EXCEPTION 'Bitte vervollständige dein Profil und die Einrichtung vor der Veröffentlichung.' USING ERRCODE='22023';
    END IF;
    UPDATE public.creator_profiles SET is_published=true WHERE id=c.id RETURNING * INTO c;
  ELSIF c.onboarding_step>p_expected_step THEN
    NULL; -- successful retry; never overwrite already saved fields
  ELSIF c.onboarding_step<>p_expected_step OR p_expected_step NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Der Einrichtungsschritt hat sich geändert. Bitte lade die Seite neu.' USING ERRCODE='40001';
  ELSE
    IF p_expected_step=1 THEN
      UPDATE public.creator_profiles SET display_name=p_data->>'display_name',bio=nullif(p_data->>'bio',''),
        slug=CASE WHEN slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN slug ELSE p_data->>'slug' END,
        categories=ARRAY(SELECT jsonb_array_elements_text(p_data->'categories')),category=p_data->>'category' WHERE id=c.id;
    ELSIF p_expected_step=2 THEN
      UPDATE public.creator_profiles SET avatar_url=coalesce(p_data->>'avatar_url',avatar_url),banner_url=coalesce(p_data->>'banner_url',banner_url) WHERE id=c.id;
    ELSIF p_expected_step=3 AND p_data ? 'name' THEN
      INSERT INTO public.subscription_tiers(creator_id,name,description,price_monthly,features,is_active)
        VALUES(c.id,p_data->>'name',nullif(p_data->>'description',''),(p_data->>'price_monthly')::numeric,'{}',true);
    ELSIF p_expected_step=4 AND p_data ? 'title' THEN
      INSERT INTO public.products(creator_id,title,description,type,price,is_published)
        VALUES(c.id,p_data->>'title',nullif(p_data->>'description',''),p_data->>'type',(p_data->>'price')::numeric,false);
    END IF;
    UPDATE public.creator_profiles SET onboarding_step=p_expected_step+1 WHERE id=c.id RETURNING * INTO c;
  END IF;
  RETURN jsonb_build_object('id',c.id,'display_name',c.display_name,'slug',c.slug,'bio',c.bio,'categories',c.categories,'category',c.category,
    'avatar_url',c.avatar_url,'banner_url',c.banner_url,'is_published',c.is_published,'onboarding_step',c.onboarding_step);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_coach_onboarding(uuid,integer,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.advance_coach_onboarding(uuid,integer,jsonb,boolean) TO service_role;
