import { addDaysToDateString, berlinDayOfWeek, berlinToUtcMs, getWindowsForDate, timeToMin, BOOKING_TIME_ZONE, utcToBerlinDateString } from './coaching-slots'
import type { AvailabilitySnapshot } from './coaching-availability'

export type CalendarBooking = {
  id: string; buyer_name: string; scheduled_at: string; duration_minutes: number; buffer_minutes: number
  status: string; payment_status: string; price_cents: number; is_subscription_session: boolean
}
export type CalendarData = { availability: AvailabilitySnapshot; bookings: CalendarBooking[]; loadedAt: number }
export type CalendarSegment = { start: number; end: number; kind: 'available' | 'unavailable' | 'buffer' | 'booking'; bookingIds: string[] }

export function calendarDates(date: string, view: 'day' | 'week') {
  const start = view === 'week' ? addDaysToDateString(date, -((berlinDayOfWeek(date) + 6) % 7)) : date
  return Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDaysToDateString(start, i))
}
export function calendarTime(ms: number) {
  // Include the offset so repeated autumn wall times cannot be mistaken for one another.
  return new Date(ms).toLocaleTimeString('de-DE', { timeZone: BOOKING_TIME_ZONE, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
}
export function calendarDateLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: BOOKING_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
export function bookingsForDate(date: string, bookings: CalendarBooking[]) {
  const start = berlinToUtcMs(date, '00:00')!, end = berlinToUtcMs(addDaysToDateString(date, 1), '00:00')!
  return bookings.filter(b => Date.parse(b.scheduled_at) < end && Date.parse(b.scheduled_at) + b.duration_minutes * 60_000 > start)
}

// Read-only projection of actual instants. A DST day has 23/25 hours; no invented
// spring times or collapsed repeated autumn hours. Nothing here grants a slot.
export function calendarSegments(date: string, data: CalendarData): CalendarSegment[] {
  const start = berlinToUtcMs(date, '00:00')!, end = berlinToUtcMs(addDaysToDateString(date, 1), '00:00')!
  const windows = getWindowsForDate(date, data.availability.slots, data.availability.dateOverrides)
  const offer = data.availability.offer
  const protectedBookings = data.bookings.filter(b => ['confirmed', 'pending_payment'].includes(b.status))
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: BOOKING_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const earliest = data.loadedAt + (offer?.min_notice_hours ?? 24) * 3_600_000
  const horizon = addDaysToDateString(utcToBerlinDateString(data.loadedAt), offer?.max_horizon_days ?? 60)
  const segments: CalendarSegment[] = []
  for (let instant = start; instant < end; instant += 60_000) {
    const active = protectedBookings.filter(b => instant < Date.parse(b.scheduled_at) + b.duration_minutes * 60_000 && instant + 60_000 > Date.parse(b.scheduled_at))
    const buffer = protectedBookings.some(b => {
      const bs = Date.parse(b.scheduled_at), be = bs + b.duration_minutes * 60_000
      return instant < be + Math.max(offer?.buffer_minutes ?? 0, b.buffer_minutes ?? 0) * 60_000 && instant + 60_000 > bs - (offer?.buffer_minutes ?? 0) * 60_000
    })
    const minute = timeToMin(localTime.format(instant))
    const inWindow = windows.some(w => minute >= timeToMin(w.start) && minute < timeToMin(w.end))
    const kind = active.length ? 'booking' : buffer ? 'buffer' : offer?.is_enabled && inWindow && instant >= earliest && date <= horizon ? 'available' : 'unavailable'
    const bookingIds = active.map(b => b.id).sort()
    const previous = segments.at(-1)
    if (previous?.kind === kind && previous.bookingIds.join() === bookingIds.join()) previous.end = Math.min(instant + 60_000, end)
    else segments.push({ start: instant, end: Math.min(instant + 60_000, end), kind, bookingIds })
  }
  return segments
}
