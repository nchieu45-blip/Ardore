import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWindowsForDate, generateSlots } from '@/lib/coaching-slots'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get('creatorId')
  const year      = Number(searchParams.get('year'))
  const month     = Number(searchParams.get('month')) // 0-based

  if (!creatorId || isNaN(year) || isNaN(month)) {
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
      .gte('date', `${year}-${String(month + 1).padStart(2, '0')}-01`)
      .lte('date', `${year}-${String(month + 1).padStart(2, '0')}-31`),
    supabase
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('creator_id', creatorId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00Z`)
      .lte('scheduled_at', `${year}-${String(month + 1).padStart(2, '0')}-31T23:59:59Z`),
  ])

  const offer = offerRes.data
  if (!offer?.is_enabled) return NextResponse.json({ days: [] })

  const durationMin   = offer.duration_minutes ?? 60
  const bufferMin     = offer.buffer_minutes ?? 0
  const minNoticeHrs  = offer.min_notice_hours ?? 24
  const horizonDays   = offer.max_horizon_days ?? 60
  const earliestUtcMs = Date.now() + minNoticeHrs * 3_600_000

  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + horizonDays)

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const availableDays: number[] = []

  const overrides = (overridesRes.data ?? []) as {
    date: string; type: 'available' | 'unavailable'; start_time: string | null; end_time: string | null
  }[]
  const bookings = (bookingsRes.data ?? []) as { scheduled_at: string; duration_minutes: number }[]
  const recurring = recurringRes.data ?? []

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    if (new Date(dateStr + 'T12:00:00Z') > maxDate) continue

    const dayBookings = bookings.filter(b =>
      b.scheduled_at.startsWith(dateStr.slice(0, 7)) &&
      new Date(b.scheduled_at).toISOString().slice(0, 10) === dateStr
    )

    const windows = getWindowsForDate(dateStr, recurring, overrides)
    const slots   = generateSlots(dateStr, windows, durationMin, bufferMin, dayBookings, earliestUtcMs)

    if (slots.length > 0) availableDays.push(day)
  }

  return NextResponse.json({ days: availableDays })
}
