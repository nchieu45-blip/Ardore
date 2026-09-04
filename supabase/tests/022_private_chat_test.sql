BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(24);

SELECT has_table('public', 'chat_conversations', 'conversation table exists');
SELECT has_table('public', 'chat_conversation_participants', 'participant table exists');
SELECT col_not_null('public', 'messages', 'conversation_id', 'every message requires a conversation');
SELECT col_not_null('public', 'chat_last_read', 'conversation_id', 'read state requires a conversation');
SELECT fk_ok('public', 'messages', 'conversation_id', 'public', 'chat_conversations', 'id', 'messages reference conversations');
SELECT fk_ok('public', 'chat_conversation_participants', 'conversation_id', 'public', 'chat_conversations', 'id', 'participants reference conversations');

SELECT policies_are(
  'public', 'messages', ARRAY['messages_participant_select'],
  'messages have only participant-scoped read policy'
);
SELECT policies_are(
  'public', 'chat_conversations', ARRAY['chat_conversations_participant_select'],
  'conversations are participant-readable only'
);
SELECT policies_are(
  'public', 'chat_conversation_participants', ARRAY['chat_participants_conversation_select'],
  'participant lists are conversation-scoped'
);
SELECT policies_are(
  'public', 'chat_last_read', ARRAY['chat_last_read_creator_select'],
  'read state is creator-participant scoped'
);

SELECT ok(NOT has_table_privilege('anon', 'public.messages', 'SELECT'), 'anonymous users cannot read messages');
SELECT ok(has_table_privilege('authenticated', 'public.messages', 'SELECT'), 'authenticated participants may query messages through RLS');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'INSERT'), 'browser users cannot insert messages directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'UPDATE'), 'browser users cannot update messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'DELETE'), 'browser users cannot delete messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'TRUNCATE'), 'browser users cannot truncate messages');

SELECT ok(NOT has_table_privilege('anon', 'public.chat_conversations', 'SELECT'), 'anonymous users cannot read conversations');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_conversations', 'INSERT'), 'browser users cannot create conversations directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_conversation_participants', 'INSERT'), 'browser users cannot add participants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_last_read', 'UPDATE'), 'browser users cannot manipulate read state directly');

SELECT trigger_is('public', 'chat_conversations', 'chat_conversations_add_participants', 'public', 'add_chat_conversation_participants', 'conversation inserts register participants');
SELECT trigger_is('public', 'messages', 'messages_validate_conversation', 'public', 'validate_chat_message', 'message writes validate membership and conversation creator');
SELECT ok(
  NOT has_function_privilege('anon', 'public.add_chat_conversation_participants()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.add_chat_conversation_participants()', 'EXECUTE'),
  'participant trigger is not directly executable'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.is_chat_conversation_participant(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.is_chat_conversation_participant(uuid,text)', 'EXECUTE'),
  'membership helper is available only to authenticated RLS evaluation'
);

SELECT * FROM finish();
ROLLBACK;
