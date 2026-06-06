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

  const { slots, dateOverrides } = await req.json() as {
    slots: { day_of_week: number; start_time: string; end_time: string }[]
    dateOverrides: { date: string; type: string; start_time: string | null; end_time: string | null }[]
  }

  await Promise.all([
    supabase.from('availability_slots').delete().eq('creator_id', creator.id),
    supabase.from('date_overrides').delete().eq('creator_id', creator.id),
  ])

  try {
    if (slots.length > 0) {
      const { error } = await supabase.from('availability_slots').insert(
        slots.map(s => ({
          creator_id:  creator.id,
          day_of_week: Number(s.day_of_week),
          start_time:  s.start_time,
          end_time:    s.end_time,
        }))
      )
      if (error) throw new Error(error.message)
    }

    if (dateOverrides.length > 0) {
      const { error } = await supabase.from('date_overrides').insert(
        dateOverrides.map(o => ({
          creator_id: creator.id,
          date:       o.date,
          type:       o.type,
          start_time: o.start_time || null,
          end_time:   o.end_time || null,
        }))
      )
      if (error) throw new Error(error.message)
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
