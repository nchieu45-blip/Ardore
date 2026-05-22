import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

  // Check if user has active subscription to this creator
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('creator_id', creatorId)
    .eq('status', 'active')
    .single()

  // Also allow the creator themselves
  const { data: creatorProfile } = await supabase
    .from('creator_profiles')
    .select('id, display_name, slug, avatar_url, user_id')
    .eq('id', creatorId)
    .single()

  if (!creatorProfile) redirect('/creators')

  const isCreatorOwner = creatorProfile.user_id === user.id

  if (!subscription && !isCreatorOwner) {
    redirect(`/creators/${creatorProfile.slug}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: messages } = await supabase
    .from('messages')
    .select('*, sender:profiles(id, full_name, avatar_url)')
    .eq('creator_id', creatorId)
    .or(`sender_id.eq.${user.id},sender_id.eq.${creatorProfile.user_id}`)
    .order('created_at', { ascending: true })
    .limit(100)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <ChatWindow
        creatorId={creatorId}
        creator={creatorProfile}
        currentUser={profile}
        initialMessages={messages ?? []}
      />
    </div>
  )
}
