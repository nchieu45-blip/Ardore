import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const BUFFER_MINUTES = 15

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get('creatorId')
  const date = searchParams.get('date') // YYYY-MM-DD

  if (!creatorId || !date) {
    return NextResponse.json({ error: 'Fehlende Parameter' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: offer } = await supabase
    .from('coaching_offers')
    .select('is_enabled, duration_minutes')
    .eq('creator_id', creatorId)
    .single()

  if (!offer?.is_enabled) return NextResponse.json({ slots: [] })

  const dayDate = new Date(date + 'T12:00:00Z')
  const dayOfWeek = dayDate.getUTCDay()

  const { data: avail } = await supabase
    .from('availability_slots')
    .select('start_time, end_time')
    .eq('creator_id', creatorId)
    .eq('day_of_week', dayOfWeek)

  if (!avail?.length) return NextResponse.json({ slots: [] })

  const startOfDay = `${date}T00:00:00+00:00`
  const endOfDay   = `${date}T23:59:59+00:00`

  const { data: existingBookings } = await supabase
    .from('bookings')
    .select('scheduled_at, duration_minutes')
    .eq('creator_id', creatorId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay)

  const duration = offer.duration_minutes
  const slots: string[] = []

  for (const window of avail) {
    const [startH, startM] = window.start_time.split(':').map(Number)
    const [endH, endM]     = window.end_time.split(':').map(Number)

    let slotStartMin       = startH * 60 + startM
    const windowEndMin     = endH * 60 + endM

    while (slotStartMin + duration <= windowEndMin) {
      const hh       = String(Math.floor(slotStartMin / 60)).padStart(2, '0')
      const mm       = String(slotStartMin % 60).padStart(2, '0')
      const slotTime = `${hh}:${mm}`
      const slotTs   = new Date(`${date}T${slotTime}:00`)

      const isConflict = (existingBookings ?? []).some(b => {
        const bStart = new Date(b.scheduled_at).getTime()
        const bEnd   = bStart + (b.duration_minutes + BUFFER_MINUTES) * 60_000
        const sStart = slotTs.getTime()
        const sEnd   = sStart + duration * 60_000
        return sStart < bEnd && sEnd > bStart
      })

      const oneHourFromNow = Date.now() + 60 * 60_000
      if (!isConflict && slotTs.getTime() > oneHourFromNow) {
        slots.push(slotTime)
      }

      slotStartMin += duration
    }
  }

  return NextResponse.json({ slots })
}
