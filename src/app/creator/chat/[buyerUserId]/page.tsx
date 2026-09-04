import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureDirectConversation } from '@/lib/chat'
import CreatorChatWindow from './CreatorChatWindow'

export default async function CreatorChatThreadPage({
  params,
}: {
  params: Promise<{ buyerUserId: string }>
}) {
  const { buyerUserId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id, user_id')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  // Verify buyer has/had an active subscription
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('creator_id', creator.id)
    .eq('buyer_id', buyerUserId)
    .eq('status', 'active')
    .maybeSingle()

  if (!subscription) redirect('/creator/chat')

  const service = await createServiceClient()
  const conversationId = await ensureDirectConversation({
    service,
    creatorId: creator.id,
    buyerId: buyerUserId,
  })

  const [profileRes, messagesRes] = await Promise.all([
    supabase.from('public_profiles').select('id, full_name, avatar_url').eq('id', buyerUserId).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100),
  ])

  const buyer = profileRes.data ?? { id: buyerUserId, full_name: null, avatar_url: null }
  const currentProfile = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single()
  const creatorIdentity = {
    id: user.id,
    full_name: currentProfile.data?.full_name ?? null,
    avatar_url: currentProfile.data?.avatar_url ?? null,
  }
  const initialMessages = (messagesRes.data ?? []).map((message) => ({
    ...message,
    sender: message.sender_id === buyerUserId ? buyer : creatorIdentity,
  }))

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <CreatorChatWindow
        conversationId={conversationId}
        buyer={buyer}
        currentUserId={user.id}
        currentUserName={currentProfile.data?.full_name ?? null}
        currentUserAvatar={currentProfile.data?.avatar_url ?? null}
        initialMessages={initialMessages}
      />
    </div>
  )
}
