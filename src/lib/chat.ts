import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureDirectConversation({
  service,
  creatorId,
  buyerId,
}: {
  service: SupabaseClient
  creatorId: string
  buyerId: string
}): Promise<string> {
  const existing = await service
    .from('chat_conversations')
    .select('id')
    .eq('creator_id', creatorId)
    .eq('buyer_id', buyerId)
    .eq('kind', 'direct')
    .maybeSingle()

  if (existing.data?.id) return existing.data.id
  if (existing.error) throw existing.error

  const inserted = await service
    .from('chat_conversations')
    .insert({ creator_id: creatorId, buyer_id: buyerId, kind: 'direct' })
    .select('id')
    .single()

  if (inserted.data?.id) return inserted.data.id

  // A concurrent request may have created the unique creator/buyer pair.
  const concurrent = await service
    .from('chat_conversations')
    .select('id')
    .eq('creator_id', creatorId)
    .eq('buyer_id', buyerId)
    .eq('kind', 'direct')
    .single()

  if (concurrent.error || !concurrent.data?.id) {
    throw inserted.error ?? concurrent.error ?? new Error('Conversation could not be created')
  }
  return concurrent.data.id
}
