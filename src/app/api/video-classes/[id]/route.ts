import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function getCreatorId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  return creator?.id ?? null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await req.json()
  const allowedKeys = [
    'title', 'description', 'schedule_type',
    'starts_at', 'recurring_weekday', 'recurring_time',
    'duration_minutes', 'max_participants', 'price_cents',
    'included_in_subscription', 'active',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (key in body) patch[key] = body[key]
  }
  if (typeof patch.title === 'string') patch.title = patch.title.trim()

  const { data, error } = await supabase
    .from('video_classes')
    .update(patch)
    .eq('id', id)
    .eq('creator_id', creatorId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ videoClass: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { error } = await supabase
    .from('video_classes')
    .delete()
    .eq('id', id)
    .eq('creator_id', creatorId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
