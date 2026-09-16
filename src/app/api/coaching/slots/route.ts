import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { addDaysToDateString, berlinDateTimeToIso, currentBerlinDateString, getWindowsForDate, generateSlots, isValidDateString } from '@/lib/coaching-slots'
import { getAuthorizedExcludedBookingDuration } from '@/lib/coaching-booking'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId = searchParams.get('creatorId')
  const date      = searchParams.get('date') // YYYY-MM-DD
  const excludeBookingId = searchParams.get('excludeBookingId')

  if (!creatorId || !date || !isValidDateString(date)) {
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
  const utcStart = berlinDateTimeToIso(date, '00:00')
  const utcEnd = berlinDateTimeToIso(addDaysToDateString(date, 1), '00:00')
  if (!utcStart || !utcEnd) return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 })

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
      .eq('date', date),
    bookingsQuery,
  ])

  if (offerRes.error || recurringRes.error || overridesRes.error || bookingsRes.error) {
    return NextResponse.json({ error: 'Verfügbarkeit konnte nicht geladen werden' }, { status: 500 })
  }
  const offer = offerRes.data
  if (!offer?.is_enabled) return NextResponse.json({ slots: [] })

  // Enforce max horizon
  const horizonDays = offer.max_horizon_days ?? 60
  const maxDate = addDaysToDateString(currentBerlinDateString(), horizonDays)
  if (date > maxDate) return NextResponse.json({ slots: [] })

  const durationMin   = excludedBookingDuration ?? offer.duration_minutes ?? 60
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
