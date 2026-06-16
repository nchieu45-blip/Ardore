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

export async function GET() {
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { data, error } = await supabase
    .from('video_classes')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const classes = data ?? []
  const classIds = classes.map((c: { id: string }) => c.id)

  const participantCounts: Record<string, number> = {}
  if (classIds.length > 0) {
    const { data: bookings } = await supabase
      .from('video_class_bookings')
      .select('video_class_id')
      .eq('status', 'confirmed')
      .in('video_class_id', classIds)
    for (const b of (bookings ?? []) as { video_class_id: string }[]) {
      participantCounts[b.video_class_id] = (participantCounts[b.video_class_id] ?? 0) + 1
    }
  }

  return NextResponse.json({ classes, participantCounts })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await req.json()
  const {
    title, description, schedule_type,
    starts_at, recurring_weekday, recurring_time,
    duration_minutes, max_participants, price_cents, included_in_subscription,
  } = body

  if (!title?.trim()) return NextResponse.json({ error: 'Titel fehlt' }, { status: 400 })
  if (!['once', 'recurring'].includes(schedule_type)) {
    return NextResponse.json({ error: 'Ungültiger Termintyp' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('video_classes')
    .insert({
      creator_id:               creatorId,
      title:                    title.trim(),
      description:              description?.trim() || null,
      schedule_type,
      starts_at:                schedule_type === 'once'      ? (starts_at ?? null)          : null,
      recurring_weekday:        schedule_type === 'recurring' ? (recurring_weekday ?? null)   : null,
      recurring_time:           schedule_type === 'recurring' ? (recurring_time   ?? null)   : null,
      duration_minutes:         Number(duration_minutes)  || 60,
      max_participants:         max_participants !== null && max_participants !== undefined ? Number(max_participants) : null,
      price_cents:              Number(price_cents)       || 0,
      included_in_subscription: Boolean(included_in_subscription),
      active:                   true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ videoClass: data })
}
