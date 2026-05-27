import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { buyerUserId } = await req.json()

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!creator) return NextResponse.json({ error: 'Not a creator' }, { status: 403 })

  await supabase.from('chat_last_read').upsert(
    { creator_id: creator.id, buyer_id: buyerUserId, last_read_at: new Date().toISOString() },
    { onConflict: 'creator_id,buyer_id' }
  )

  return NextResponse.json({ ok: true })
}
