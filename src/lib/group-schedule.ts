import {
  addDaysToDateString,
  berlinDayOfWeek,
  berlinToUtcMs,
  isValidDateString,
  utcToBerlinDateString,
} from '@/lib/coaching-slots'

// One host plus at most 199 attendees fit the configured 200-person rooms.
export const MAX_GROUP_PARTICIPANTS = 199
export const GROUP_BOOKING_HORIZON_DAYS = 90
const MAX_OCCURRENCE_OPTIONS = 12
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export interface GroupSchedule {
  schedule_type: 'once' | 'recurring'
  starts_at: string | null
  recurring_weekday: number | null
  recurring_time: string | null
  duration_minutes: number
  active?: boolean
}

export interface GroupOccurrence {
  startsAt: string
  endsAt: string
}

// Stored timestamps must identify an absolute instant, independent of the
// browser/server timezone. Reject normalized impossible calendar dates as well.
function timestamp(value: unknown): number | null {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !isValidDateString(value.slice(0, 10))
  ) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function occurrence(startsAt: number, durationMinutes: number, subMillisecond = ''): GroupOccurrence | null {
  const endsAt = startsAt + durationMinutes * MINUTE_MS
  if (!Number.isFinite(new Date(endsAt).getTime())) return null
  const iso = (value: number) => new Date(value).toISOString().replace(/Z$/, `${subMillisecond}Z`)
  return { startsAt: iso(startsAt), endsAt: iso(endsAt) }
}

/** Upcoming selectable sessions only; payment/availability RPCs remain authoritative. */
export function nextGroupOccurrences(
  schedule: GroupSchedule | null | undefined,
  now: number,
  limit = 8,
): GroupOccurrence[] {
  if (
    !schedule || schedule.active === false
    || !Number.isFinite(new Date(now).getTime())
    || !Number.isInteger(schedule.duration_minutes)
    || schedule.duration_minutes < 5 || schedule.duration_minutes > 480
    || !Number.isFinite(limit)
  ) return []

  const count = Math.max(0, Math.min(MAX_OCCURRENCE_OPTIONS, Math.floor(limit)))
  if (count === 0) return []
  const latest = now + GROUP_BOOKING_HORIZON_DAYS * DAY_MS
  if (schedule.schedule_type === 'once') {
    const start = timestamp(schedule.starts_at)
    if (start === null || start <= now || start > latest) return []
    // PostgreSQL can retain microseconds beyond Date's millisecond precision.
    // Keep that remainder in the selected identity so exact once-occurrence
    // checks in the booking RPC do not reject an otherwise valid stored time.
    const remainder = schedule.starts_at?.match(/\.\d{3}(\d{1,3})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? ''
    const value = occurrence(start, schedule.duration_minutes, remainder)
    return value ? [value] : []
  }

  if (
    schedule.schedule_type !== 'recurring'
    || !Number.isInteger(schedule.recurring_weekday)
    || schedule.recurring_weekday! < 0 || schedule.recurring_weekday! > 6
    || typeof schedule.recurring_time !== 'string'
    || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00(?:\.0{1,6})?)?$/.test(schedule.recurring_time)
  ) return []

  const today = utcToBerlinDateString(now)
  const offset = (schedule.recurring_weekday! - berlinDayOfWeek(today) + 7) % 7
  const results: GroupOccurrence[] = []
  // Work in Berlin calendar weeks, not fixed UTC intervals. The shared converter
  // deliberately rejects both nonexistent and ambiguous wall times during DST.
  for (let day = offset; day <= GROUP_BOOKING_HORIZON_DAYS && results.length < count; day += 7) {
    const start = berlinToUtcMs(addDaysToDateString(today, day), schedule.recurring_time.slice(0, 5))
    if (start === null || start <= now || start > latest) continue
    const value = occurrence(start, schedule.duration_minutes)
    if (value) results.push(value)
  }
  return results
}

const occurrenceFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const compactOccurrenceFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit',
  year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function formatGroupOccurrence(iso: string, style: 'full' | 'compact' = 'full'): string {
  const value = timestamp(iso)
  if (value === null) return 'Termin nicht verfügbar'
  return style === 'compact' ? `${compactOccurrenceFormatter.format(value)} Uhr` : `${occurrenceFormatter.format(value)} Uhr (Berlin)`
}
