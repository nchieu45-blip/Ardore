import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWindowsForDate, generateSlots } from '@/lib/coaching-slots'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get('creatorId')
  const date      = searchParams.get('date') // YYYY-MM-DD

  if (!creatorId || !date) {
    return NextResponse.json({ error: 'Fehlende Parameter' }, { status: 400 })
  }

  const supabase = await createClient()

  const [offerRes, recurringRes, overridesRes, bookingsRes] = await Promise.all([
    supabase
      .from('coaching_offers')
      .select('is_enabled, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days')
      .eq('creator_id', creatorId)
      .single(),
    supabase
      .from('availability_slots')
      .select('day_of_week, start_time, end_time')
      .eq('creator_id', creatorId),
    supabase
      .from('date_overrides')
      .select('date, type, start_time, end_time')
      .eq('creator_id', creatorId)
      .eq('date', date),
    supabase
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('creator_id', creatorId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', `${date}T00:00:00Z`)
      .lte('scheduled_at', `${date}T23:59:59Z`),
  ])

  const offer = offerRes.data
  if (!offer?.is_enabled) return NextResponse.json({ slots: [] })

  // Enforce max horizon
  const horizonDays = offer.max_horizon_days ?? 60
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + horizonDays)
  if (new Date(date + 'T12:00:00Z') > maxDate) return NextResponse.json({ slots: [] })

  const durationMin   = offer.duration_minutes ?? 60
  const bufferMin     = offer.buffer_minutes ?? 0
  const minNoticeHrs  = offer.min_notice_hours ?? 24
  const earliestUtcMs = Date.now() + minNoticeHrs * 3_600_000

  const windows = getWindowsForDate(
    date,
    recurringRes.data ?? [],
    (overridesRes.data ?? []) as { date: string; type: 'available' | 'unavailable'; start_time: string | null; end_time: string | null }[],
  )

  const slots = generateSlots(
    date,
    windows,
    durationMin,
    bufferMin,
    (bookingsRes.data ?? []) as { scheduled_at: string; duration_minutes: number }[],
    earliestUtcMs,
  )

  return NextResponse.json({ slots })
}
