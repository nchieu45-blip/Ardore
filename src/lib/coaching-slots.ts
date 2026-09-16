// Shared slot-generation logic for coaching availability.
// All times are Europe/Berlin unless noted as UTC.

export const BOOKING_TIME_ZONE = 'Europe/Berlin'

const BERLIN_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOOKING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function berlinParts(timestampMs: number) {
  const parts = BERLIN_PARTS.formatToParts(new Date(timestampMs))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

export function utcToBerlinDateString(value: string | number | Date): string {
  return berlinParts(new Date(value).getTime()).date
}

export function currentBerlinDateString(): string {
  return utcToBerlinDateString(Date.now())
}

export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isValidTimeString(time: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false
  return true
}

// Converts an unambiguous Europe/Berlin wall time to UTC. Spring-forward gaps and
// fall-back times that occur twice are rejected instead of silently shifting.
export function berlinToUtcMs(dateStr: string, berlinHHMM: string): number | null {
  if (!isValidDateString(dateStr) || !isValidTimeString(berlinHHMM)) return null

  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = berlinHHMM.split(':').map(Number)
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute)
  const matches: number[] = []

  // Berlin is UTC+1/+2, but scanning a wider offset range makes the conversion
  // independent of the server runtime timezone and resilient to rule changes.
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    const candidate = naiveUtc - offsetMinutes * 60_000
    const local = berlinParts(candidate)
    if (local.date === dateStr && local.time === berlinHHMM) matches.push(candidate)
  }

  return matches.length === 1 ? matches[0] : null
}

export function berlinDateTimeToIso(dateStr: string, berlinHHMM: string): string | null {
  const timestamp = berlinToUtcMs(dateStr, berlinHHMM)
  return timestamp === null ? null : new Date(timestamp).toISOString()
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function isWithinBookingHorizon(date: string, today: string, horizonDays: number): boolean {
  return isValidDateString(date) && date >= today && date <= addDaysToDateString(today, horizonDays)
}

// Returns day-of-week (0=Sun … 6=Sat) in Berlin local time for a YYYY-MM-DD string.
export function berlinDayOfWeek(dateStr: string): number {
  // Noon UTC is always the same calendar day as Berlin (UTC+1/+2).
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay()
}

export function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export interface RecurringSlot {
  day_of_week: number
  start_time: string
  end_time: string
}

export interface DateOverride {
  date: string
  type: 'available' | 'unavailable'
  start_time: string | null
  end_time: string | null
}

export interface Booking {
  scheduled_at: string
  duration_minutes: number
}

export interface TimeWindow {
  start: string
  end: string
}

export function getWindowsForDate(
  dateStr: string,
  recurringSlots: RecurringSlot[],
  dateOverrides: DateOverride[],
): TimeWindow[] {
  const dow = berlinDayOfWeek(dateStr)
  const dayOverrides = dateOverrides.filter(o => o.date === dateStr)

  if (dayOverrides.some(o => o.type === 'unavailable' && !o.start_time)) return []

  let windows: TimeWindow[] = recurringSlots
    .filter(s => s.day_of_week === dow)
    .map(s => ({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) }))

  for (const ov of dayOverrides.filter(o => o.type === 'unavailable' && o.start_time)) {
    const bStart = timeToMin(ov.start_time!.slice(0, 5))
    const bEnd   = timeToMin(ov.end_time!.slice(0, 5))
    windows = windows.flatMap(w => {
      const ws = timeToMin(w.start), we = timeToMin(w.end)
      const result: TimeWindow[] = []
      if (ws < bStart) result.push({ start: w.start, end: minToTime(Math.min(we, bStart)) })
      if (we > bEnd)   result.push({ start: minToTime(Math.max(ws, bEnd)), end: w.end })
      return result
    }).filter(w => timeToMin(w.start) < timeToMin(w.end))
  }

  for (const ov of dayOverrides.filter(o => o.type === 'available' && o.start_time)) {
    windows.push({ start: ov.start_time!.slice(0, 5), end: ov.end_time!.slice(0, 5) })
  }

  return windows.sort((a, b) => a.start.localeCompare(b.start))
}

export function generateSlots(
  dateStr: string,
  windows: TimeWindow[],
  durationMin: number,
  bufferMin: number,
  bookings: Booking[],
  earliestUtcMs: number,
): string[] {
  const slots: string[] = []

  for (const w of windows) {
    let cur = timeToMin(w.start)
    const end = timeToMin(w.end)

    while (cur + durationMin <= end) {
      const slotHHMM    = minToTime(cur)
      const slotStartMs = berlinToUtcMs(dateStr, slotHHMM)
      if (slotStartMs === null) {
        cur += durationMin + bufferMin
        continue
      }
      const slotEndMs   = slotStartMs + durationMin * 60_000

      if (slotStartMs >= earliestUtcMs) {
        const conflict = bookings.some(b => {
          const bStart = new Date(b.scheduled_at).getTime()
          const bEnd   = bStart + b.duration_minutes * 60_000
          return slotStartMs < bEnd + bufferMin * 60_000
              && slotEndMs   > bStart - bufferMin * 60_000
        })
        if (!conflict) slots.push(slotHHMM)
      }

      cur += durationMin + bufferMin
    }
  }

  return slots
}
