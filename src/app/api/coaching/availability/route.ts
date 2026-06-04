import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!creator) return NextResponse.json({ error: 'Creator nicht gefunden' }, { status: 404 })

  const { slots } = await req.json() as {
    slots: { day_of_week: number; start_time: string; end_time: string }[]
  }

  await supabase.from('availability_slots').delete().eq('creator_id', creator.id)

  if (slots.length > 0) {
    const { error } = await supabase.from('availability_slots').insert(
      slots.map(s => ({
        creator_id: creator.id,
        day_of_week: Number(s.day_of_week),
        start_time: s.start_time,
        end_time: s.end_time,
      }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
