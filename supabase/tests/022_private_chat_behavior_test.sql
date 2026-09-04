BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE TEMP TABLE chat_test_context AS
WITH selected_creator AS (
  SELECT id AS creator_id, user_id AS creator_user_id
  FROM public.creator_profiles ORDER BY id LIMIT 1
), candidates AS (
  SELECT profile.id, row_number() OVER (ORDER BY profile.id) AS position
  FROM public.profiles profile, selected_creator creator
  WHERE profile.id <> creator.creator_user_id
), unrelated_creator AS (
  SELECT profile.user_id
  FROM public.creator_profiles profile, selected_creator creator
  WHERE profile.user_id <> creator.creator_user_id
    AND profile.user_id NOT IN (SELECT id FROM candidates WHERE position <= 2)
  ORDER BY profile.id LIMIT 1
)
SELECT creator.creator_id, creator.creator_user_id,
       (SELECT id FROM candidates WHERE position = 1) AS buyer_a,
       (SELECT id FROM candidates WHERE position = 2) AS buyer_b,
       (SELECT user_id FROM unrelated_creator) AS unrelated_creator
FROM selected_creator creator;

DO $fixtures$
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_test_context
    WHERE creator_id IS NULL OR buyer_a IS NULL OR buyer_b IS NULL OR unrelated_creator IS NULL
  ) THEN
    RAISE EXCEPTION 'Chat RLS behavior tests require one creator and three distinct existing profiles';
  END IF;
END
$fixtures$;

INSERT INTO public.chat_conversations (creator_id, buyer_id, kind)
SELECT creator_id, buyer_a, 'direct' FROM chat_test_context
UNION ALL
SELECT creator_id, buyer_b, 'direct' FROM chat_test_context;

ALTER TABLE chat_test_context ADD COLUMN conversation_a UUID;
ALTER TABLE chat_test_context ADD COLUMN conversation_b UUID;
UPDATE chat_test_context context
SET conversation_a = (SELECT id FROM public.chat_conversations WHERE creator_id=context.creator_id AND buyer_id=context.buyer_a),
    conversation_b = (SELECT id FROM public.chat_conversations WHERE creator_id=context.creator_id AND buyer_id=context.buyer_b);

INSERT INTO public.messages (conversation_id, creator_id, sender_id, content)
SELECT conversation_a, creator_id, buyer_a, 'transactional security test' FROM chat_test_context
UNION ALL
SELECT conversation_b, creator_id, buyer_b, 'transactional security test' FROM chat_test_context;

CREATE TEMP TABLE chat_test_observations (
  observer TEXT PRIMARY KEY,
  conversations_visible BIGINT NOT NULL,
  messages_visible BIGINT NOT NULL
);
GRANT SELECT ON chat_test_context TO authenticated;
GRANT INSERT ON chat_test_observations TO authenticated;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', buyer_a::text, true) FROM chat_test_context;
SET LOCAL ROLE authenticated;
INSERT INTO chat_test_observations SELECT 'buyer_a',
  (SELECT count(*) FROM public.chat_conversations),
  (SELECT count(*) FROM public.messages);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', buyer_b::text, true) FROM chat_test_context;
SET LOCAL ROLE authenticated;
INSERT INTO chat_test_observations SELECT 'buyer_b',
  (SELECT count(*) FROM public.chat_conversations),
  (SELECT count(*) FROM public.messages);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', creator_user_id::text, true) FROM chat_test_context;
SET LOCAL ROLE authenticated;
INSERT INTO chat_test_observations SELECT 'creator',
  (SELECT count(*) FROM public.chat_conversations),
  (SELECT count(*) FROM public.messages);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', unrelated_creator::text, true) FROM chat_test_context;
SET LOCAL ROLE authenticated;
INSERT INTO chat_test_observations SELECT 'unrelated_creator',
  (SELECT count(*) FROM public.chat_conversations),
  (SELECT count(*) FROM public.messages);
RESET ROLE;

SELECT plan(8);
SELECT is((SELECT conversations_visible FROM chat_test_observations WHERE observer='buyer_a'), 1::BIGINT, 'buyer A sees only conversation A');
SELECT is((SELECT messages_visible FROM chat_test_observations WHERE observer='buyer_a'), 1::BIGINT, 'buyer A sees only conversation A messages');
SELECT is((SELECT conversations_visible FROM chat_test_observations WHERE observer='buyer_b'), 1::BIGINT, 'buyer B sees only conversation B');
SELECT is((SELECT messages_visible FROM chat_test_observations WHERE observer='buyer_b'), 1::BIGINT, 'buyer B sees only conversation B messages');
SELECT is((SELECT conversations_visible FROM chat_test_observations WHERE observer='creator'), 2::BIGINT, 'participating coach sees both own conversations');
SELECT is((SELECT messages_visible FROM chat_test_observations WHERE observer='creator'), 2::BIGINT, 'participating coach sees both own message threads');
SELECT is((SELECT conversations_visible FROM chat_test_observations WHERE observer='unrelated_creator'), 0::BIGINT, 'unrelated coach sees no conversations');
SELECT is((SELECT messages_visible FROM chat_test_observations WHERE observer='unrelated_creator'), 0::BIGINT, 'unrelated coach sees no messages');
SELECT * FROM finish();
ROLLBACK;
