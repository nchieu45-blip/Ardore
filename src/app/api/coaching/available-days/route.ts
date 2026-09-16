import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { addDaysToDateString, berlinDateTimeToIso, currentBerlinDateString, getWindowsForDate, generateSlots, utcToBerlinDateString } from '@/lib/coaching-slots'
import { getAuthorizedExcludedBookingDuration } from '@/lib/coaching-booking'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get('creatorId')
  const year      = Number(searchParams.get('year'))
  const month     = Number(searchParams.get('month')) // 0-based
  const excludeBookingId = searchParams.get('excludeBookingId')

  if (!creatorId || !Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    return NextResponse.json({ error: 'Fehlende Parameter' }, { status: 400 })
  }

  const supabase = await createClient()
  let excludedBookingDuration: number | null = null
  if (excludeBookingId) {
    const { data: { user } } = await supabase.auth.getUser()
    excludedBookingDuration = user
      ? await getAuthorizedExcludedBookingDuration({ bookingId: excludeBookingId, creatorId, userId: user.id })
      : null
    if (excludedBookingDuration === null) {
      return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
    }
  }
  const service = await createServiceClient()

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const nextMonthStart = month === 11
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 2).padStart(2, '0')}-01`
  const utcStart = berlinDateTimeToIso(monthStart, '00:00')
  const utcEnd = berlinDateTimeToIso(nextMonthStart, '00:00')
  if (!utcStart || !utcEnd) return NextResponse.json({ error: 'Ungültiger Monat' }, { status: 400 })

  let bookingsQuery = service
    .from('bookings')
    .select('scheduled_at, duration_minutes')
    .eq('creator_id', creatorId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', utcStart)
    .lt('scheduled_at', utcEnd)
  if (excludeBookingId) bookingsQuery = bookingsQuery.neq('id', excludeBookingId)

  const [offerRes, recurringRes, overridesRes, bookingsRes] = await Promise.all([
    service
      .from('coaching_offers')
      .select('is_enabled, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days')
      .eq('creator_id', creatorId)
      .single(),
    service
      .from('availability_slots')
      .select('day_of_week, start_time, end_time')
      .eq('creator_id', creatorId),
    service
      .from('date_overrides')
      .select('date, type, start_time, end_time')
      .eq('creator_id', creatorId)
      .gte('date', monthStart)
      .lt('date', nextMonthStart),
    bookingsQuery,
  ])

  if (offerRes.error || recurringRes.error || overridesRes.error || bookingsRes.error) {
    return NextResponse.json({ error: 'Verfügbarkeit konnte nicht geladen werden' }, { status: 500 })
  }
  const offer = offerRes.data
  if (!offer?.is_enabled) return NextResponse.json({ days: [] })

  const durationMin   = excludedBookingDuration ?? offer.duration_minutes ?? 60
  const bufferMin     = offer.buffer_minutes ?? 0
  const minNoticeHrs  = offer.min_notice_hours ?? 24
  const horizonDays   = offer.max_horizon_days ?? 60
  const earliestUtcMs = Date.now() + minNoticeHrs * 3_600_000

  const maxDate = addDaysToDateString(currentBerlinDateString(), horizonDays)

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const availableDays: number[] = []

  const overrides = (overridesRes.data ?? []) as {
    date: string; type: 'available' | 'unavailable'; start_time: string | null; end_time: string | null
  }[]
  const bookings = (bookingsRes.data ?? []) as { scheduled_at: string; duration_minutes: number }[]
  const recurring = recurringRes.data ?? []

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    if (dateStr > maxDate) continue

    const dayBookings = bookings.filter(b =>
      utcToBerlinDateString(b.scheduled_at) === dateStr
    )

    const windows = getWindowsForDate(dateStr, recurring, overrides)
    const slots   = generateSlots(dateStr, windows, durationMin, bufferMin, dayBookings, earliestUtcMs)

    if (slots.length > 0) availableDays.push(day)
  }

  return NextResponse.json({ days: availableDays })
}
