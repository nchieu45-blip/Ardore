-- Migration 022: Isolate private chat by explicit conversation membership.

CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'legacy_archive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'direct' AND buyer_id IS NOT NULL)
    OR (kind = 'legacy_archive' AND buyer_id IS NULL)
  )
);

CREATE UNIQUE INDEX chat_conversations_direct_pair_idx
  ON public.chat_conversations (creator_id, buyer_id)
  WHERE kind = 'direct';
CREATE UNIQUE INDEX chat_conversations_legacy_archive_idx
  ON public.chat_conversations (creator_id)
  WHERE kind = 'legacy_archive';

CREATE TABLE public.chat_conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('buyer', 'creator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX chat_conversation_participants_user_idx
  ON public.chat_conversation_participants (user_id, conversation_id);

CREATE OR REPLACE FUNCTION public.add_chat_conversation_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  creator_user_id UUID;
BEGIN
  SELECT profile.user_id INTO creator_user_id
  FROM public.creator_profiles profile
  WHERE profile.id = NEW.creator_id;

  INSERT INTO public.chat_conversation_participants (conversation_id, user_id, participant_role)
  VALUES (NEW.id, creator_user_id, 'creator')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF NEW.kind = 'direct' THEN
    INSERT INTO public.chat_conversation_participants (conversation_id, user_id, participant_role)
    VALUES (NEW.id, NEW.buyer_id, 'buyer')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_chat_conversation_participants() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER chat_conversations_add_participants
AFTER INSERT ON public.chat_conversations
FOR EACH ROW EXECUTE FUNCTION public.add_chat_conversation_participants();

ALTER TABLE public.messages ADD COLUMN conversation_id UUID;

-- Direct conversations are unambiguous for buyer-sent messages and existing
-- creator/buyer read-state pairs.
INSERT INTO public.chat_conversations (creator_id, buyer_id, kind)
SELECT DISTINCT candidate.creator_id, candidate.buyer_id, 'direct'
FROM (
  SELECT message.creator_id, message.sender_id AS buyer_id
  FROM public.messages message
  JOIN public.creator_profiles creator ON creator.id = message.creator_id
  WHERE message.sender_id <> creator.user_id
  UNION
  SELECT read_state.creator_id, read_state.buyer_id
  FROM public.chat_last_read read_state
) candidate
ON CONFLICT DO NOTHING;

UPDATE public.messages message
SET conversation_id = conversation.id
FROM public.chat_conversations conversation
JOIN public.creator_profiles creator ON creator.id = conversation.creator_id
WHERE conversation.kind = 'direct'
  AND message.creator_id = conversation.creator_id
  AND message.sender_id = conversation.buyer_id
  AND message.sender_id <> creator.user_id;

-- A creator message can be assigned only when that creator has exactly one
-- direct conversation. Ambiguous legacy creator messages are preserved in a
-- creator-only archive and are never exposed to a buyer.
WITH single_conversation AS (
  SELECT creator_id, (array_agg(id ORDER BY id))[1] AS conversation_id
  FROM public.chat_conversations
  WHERE kind = 'direct'
  GROUP BY creator_id
  HAVING count(*) = 1
)
UPDATE public.messages message
SET conversation_id = single_conversation.conversation_id
FROM single_conversation
JOIN public.creator_profiles creator ON creator.id = single_conversation.creator_id
WHERE message.creator_id = single_conversation.creator_id
  AND message.sender_id = creator.user_id
  AND message.conversation_id IS NULL;

INSERT INTO public.chat_conversations (creator_id, kind)
SELECT DISTINCT message.creator_id, 'legacy_archive'
FROM public.messages message
WHERE message.conversation_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE public.messages message
SET conversation_id = conversation.id
FROM public.chat_conversations conversation
WHERE conversation.kind = 'legacy_archive'
  AND conversation.creator_id = message.creator_id
  AND message.conversation_id IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN conversation_id SET NOT NULL,
  ADD CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;

CREATE INDEX messages_conversation_created_idx
  ON public.messages (conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.validate_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_creator_id UUID;
BEGIN
  SELECT conversation.creator_id INTO conversation_creator_id
  FROM public.chat_conversations conversation
  WHERE conversation.id = NEW.conversation_id;

  IF conversation_creator_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.chat_conversation_participants participant
    WHERE participant.conversation_id = NEW.conversation_id
      AND participant.user_id = NEW.sender_id
  ) THEN
    RAISE EXCEPTION 'invalid chat conversation participant';
  END IF;

  NEW.creator_id := conversation_creator_id;
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_chat_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER messages_validate_conversation
BEFORE INSERT OR UPDATE OF conversation_id, sender_id, creator_id ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.validate_chat_message();

ALTER TABLE public.chat_last_read ADD COLUMN conversation_id UUID;
UPDATE public.chat_last_read read_state
SET conversation_id = conversation.id
FROM public.chat_conversations conversation
WHERE conversation.kind = 'direct'
  AND conversation.creator_id = read_state.creator_id
  AND conversation.buyer_id = read_state.buyer_id;
ALTER TABLE public.chat_last_read
  ALTER COLUMN conversation_id SET NOT NULL,
  ADD CONSTRAINT chat_last_read_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX chat_last_read_conversation_idx
  ON public.chat_last_read (conversation_id);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_chat_conversation_participant(
  requested_conversation_id UUID,
  requested_role TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_conversation_participants participant
    WHERE participant.conversation_id = requested_conversation_id
      AND participant.user_id = (SELECT auth.uid())
      AND (requested_role IS NULL OR participant.participant_role = requested_role)
  );
$$;

REVOKE ALL ON FUNCTION public.is_chat_conversation_participant(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_chat_conversation_participant(UUID, TEXT) TO authenticated;

CREATE POLICY "chat_conversations_participant_select" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (public.is_chat_conversation_participant(id));

CREATE POLICY "chat_participants_conversation_select" ON public.chat_conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_chat_conversation_participant(conversation_id));

REVOKE ALL ON public.chat_conversations FROM anon, authenticated;
REVOKE ALL ON public.chat_conversation_participants FROM anon, authenticated;
GRANT SELECT ON public.chat_conversations TO authenticated;
GRANT SELECT ON public.chat_conversation_participants TO authenticated;

DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_participant_select" ON public.messages;
CREATE POLICY "messages_participant_select" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_chat_conversation_participant(conversation_id));

REVOKE ALL ON public.messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.messages FROM authenticated;
GRANT SELECT ON public.messages TO authenticated;

DROP POLICY IF EXISTS "chat_last_read_select_own" ON public.chat_last_read;
DROP POLICY IF EXISTS "chat_last_read_upsert_own" ON public.chat_last_read;
DROP POLICY IF EXISTS "chat_last_read_update_own" ON public.chat_last_read;
CREATE POLICY "chat_last_read_creator_select" ON public.chat_last_read
  FOR SELECT TO authenticated
  USING (public.is_chat_conversation_participant(conversation_id, 'creator'));

REVOKE ALL ON public.chat_last_read FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.chat_last_read FROM authenticated;
GRANT SELECT ON public.chat_last_read TO authenticated;
