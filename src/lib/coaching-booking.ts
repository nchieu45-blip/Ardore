import { createServiceClient } from '@/lib/supabase/server'
import {
  addDaysToDateString,
  berlinDateTimeToIso,
  currentBerlinDateString,
  generateSlots,
  getWindowsForDate,
  isValidDateString,
  isValidTimeString,
  isWithinBookingHorizon,
} from '@/lib/coaching-slots'

export function isValidCoachingDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 5 && value <= 480
}

type Offer = {
  is_enabled: boolean
  duration_minutes: number
  buffer_minutes: number
  min_notice_hours: number
  max_horizon_days: number
}

type ValidationResult =
  | { ok: true; scheduledAt: string; bufferMinutes: number; offer: Offer }
  | { ok: false; status: number; error: string }

function dateBoundsUtc(date: string): { start: string; end: string } | null {
  const start = berlinDateTimeToIso(date, '00:00')
  const end = berlinDateTimeToIso(addDaysToDateString(date, 1), '00:00')
  return start && end ? { start, end } : null
}

export async function getAuthorizedExcludedBookingDuration({
  bookingId,
  creatorId,
  userId,
}: {
  bookingId: string
  creatorId: string
  userId: string
}): Promise<number | null> {
  const service = await createServiceClient()
  const { data } = await service
    .from('bookings')
    .select('buyer_id, creator_id, duration_minutes, creator_profiles!inner(user_id)')
    .eq('id', bookingId)
    .eq('creator_id', creatorId)
    .single()
  if (!data) return null
  const creator = Array.isArray(data.creator_profiles) ? data.creator_profiles[0] : data.creator_profiles
  return data.buyer_id === userId || creator?.user_id === userId ? data.duration_minutes : null
}

export async function validateCoachingSlot({
  creatorId,
  date,
  time,
  durationMinutes,
  excludeBookingId,
}: {
  creatorId: string
  date: string
  time: string
  durationMinutes: number
  excludeBookingId?: string
}): Promise<ValidationResult> {
  if (!isValidDateString(date) || !isValidTimeString(time)) {
    return { ok: false, status: 400, error: 'Ungültiges Datum oder Uhrzeit' }
  }
  if (!isValidCoachingDuration(durationMinutes)) {
    return { ok: false, status: 400, error: 'Ungültige Sitzungsdauer' }
  }

  const bounds = dateBoundsUtc(date)
  const scheduledAt = berlinDateTimeToIso(date, time)
  if (!bounds || !scheduledAt) {
    return { ok: false, status: 400, error: 'Diese Uhrzeit ist wegen der Zeitumstellung nicht buchbar.' }
  }

  const service = await createServiceClient()
  let bookingsQuery = service
    .from('bookings')
    .select('scheduled_at, duration_minutes')
    .eq('creator_id', creatorId)
    .in('status', ['pending_payment', 'confirmed'])
    .gte('scheduled_at', bounds.start)
    .lt('scheduled_at', bounds.end)
  if (excludeBookingId) bookingsQuery = bookingsQuery.neq('id', excludeBookingId)

  const [offerRes, recurringRes, overridesRes, bookingsRes] = await Promise.all([
    service
      .from('coaching_offers')
      .select('is_enabled, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days')
      .eq('creator_id', creatorId)
      .single(),
    service.from('availability_slots').select('day_of_week, start_time, end_time').eq('creator_id', creatorId),
    service.from('date_overrides').select('date, type, start_time, end_time').eq('creator_id', creatorId).eq('date', date),
    bookingsQuery,
  ])

  if (offerRes.error || recurringRes.error || overridesRes.error || bookingsRes.error) {
    return { ok: false, status: 500, error: 'Verfügbarkeit konnte nicht geprüft werden' }
  }
  const offer = offerRes.data as Offer | null
  if (!offer?.is_enabled) return { ok: false, status: 400, error: 'Videocoaching nicht verfügbar' }

  if (!isWithinBookingHorizon(date, currentBerlinDateString(), offer.max_horizon_days ?? 60)) {
    return { ok: false, status: 409, error: 'Der Termin liegt außerhalb des Buchungszeitraums.' }
  }

  const availableSlots = generateSlots(
    date,
    getWindowsForDate(date, recurringRes.data ?? [], (overridesRes.data ?? []) as Parameters<typeof getWindowsForDate>[2]),
    durationMinutes,
    offer.buffer_minutes ?? 0,
    bookingsRes.data ?? [],
    Date.now() + (offer.min_notice_hours ?? 24) * 3_600_000,
  )

  if (!availableSlots.includes(time)) {
    return { ok: false, status: 409, error: 'Dieser Zeitslot ist nicht verfügbar.' }
  }

  return { ok: true, scheduledAt, bufferMinutes: offer.buffer_minutes ?? 0, offer }
}
