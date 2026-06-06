// Shared slot-generation logic for coaching availability.
// All times are Europe/Berlin unless noted as UTC.

export function berlinToUtcMs(dateStr: string, berlinHHMM: string): number {
  // "Naive-then-correct" method: treats the time as UTC first, reads what Berlin
  // clock shows for that UTC moment, then subtracts the difference. Handles DST.
  const naive = new Date(`${dateStr}T${berlinHHMM}:00Z`)
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(naive)
  const bh = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const bm = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  const diffMs = ((bh * 60 + bm) - timeToMin(berlinHHMM)) * 60_000
  return naive.getTime() - diffMs
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
