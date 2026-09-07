import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureDirectConversation } from '@/lib/chat'
import ChatWindow from './ChatWindow'

export default async function ChatPage({
  params,
}: {
  params: Promise<{ creatorId: string }>
}) {
  const { creatorId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Active entitlement allows sending and may create the first conversation.
  // Existing participants retain read-only access to their own history.
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('creator_id', creatorId)
    .eq('status', 'active')
    .maybeSingle()

  // Also allow the creator themselves
  const { data: creatorProfile } = await supabase
    .from('creator_profiles')
    .select('id, display_name, slug, avatar_url, user_id')
    .eq('id', creatorId)
    .single()

  if (!creatorProfile) redirect('/creators')

  const isCreatorOwner = creatorProfile.user_id === user.id

  if (isCreatorOwner) redirect('/creator/chat')

  const { data: existingConversation } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('creator_id', creatorId)
    .eq('buyer_id', user.id)
    .eq('kind', 'direct')
    .maybeSingle()

  let conversationId = existingConversation?.id
  if (!conversationId && subscription) {
    const service = await createServiceClient()
    conversationId = await ensureDirectConversation({ service, creatorId, buyerId: user.id })
  }

  if (!conversationId) redirect(`/creators/${creatorProfile.slug}`)

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(100)

  const initialMessages = (messages ?? []).map((message) => ({
    ...message,
    sender: message.sender_id === creatorProfile.user_id
      ? { id: creatorProfile.user_id, full_name: creatorProfile.display_name, avatar_url: creatorProfile.avatar_url }
      : profile,
  }))

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <ChatWindow
        conversationId={conversationId}
        creator={creatorProfile}
        currentUser={profile}
        initialMessages={initialMessages}
        canSend={Boolean(subscription)}
      />
    </div>
  )
}
