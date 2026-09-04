import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId } = await req.json()
  if (!conversationId) return NextResponse.json({ error: 'Missing conversation' }, { status: 400 })

  const { data: conversation } = await supabase
    .from('chat_conversations')
    .select('id, creator_id, buyer_id, creator:creator_profiles!inner(user_id)')
    .eq('id', conversationId)
    .single()

  const creator = Array.isArray(conversation?.creator) ? conversation.creator[0] : conversation?.creator
  if (!conversation?.buyer_id || creator?.user_id !== user.id) {
    return NextResponse.json({ error: 'Not a conversation creator' }, { status: 403 })
  }

  const service = await createServiceClient()
  const { error } = await service.from('chat_last_read').upsert(
    {
      conversation_id: conversation.id,
      creator_id: conversation.creator_id,
      buyer_id: conversation.buyer_id,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'conversation_id' }
  )

  if (error) return NextResponse.json({ error: 'Read state could not be updated' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
