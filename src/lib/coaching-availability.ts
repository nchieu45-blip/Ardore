import { z } from 'zod'
import { isValidDateString, isValidTimeString, timeToMin, getWindowsForDate } from '@/lib/coaching-slots'

const time = z.string().refine(isValidTimeString)
const interval = z.object({ day_of_week: z.number().int().min(0).max(6), start_time: time, end_time: time }).strict()
const override = z.object({ date: z.string().refine(isValidDateString), type: z.enum(['available', 'unavailable']), start_time: time.nullable(), end_time: time.nullable() }).strict()
// These are existing commercial settings, still chosen entirely by the coach.
const integer = z.number().int().min(0).max(2_147_483_647)
export const availabilityInput = z.object({
  slots: z.array(interval).max(1000),
  dateOverrides: z.array(override).max(1000),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  offer: z.object({
    is_enabled: z.boolean(), price_cents: integer,
    duration_minutes: z.number().int().min(5).max(480), description: z.string().nullable(),
    buffer_minutes: z.union([z.literal(0), z.literal(15), z.literal(30)]),
    min_notice_hours: integer, max_horizon_days: integer.min(1),
    cancellation_policy_hours: z.number().int().min(0).max(168),
  }).strict().optional(),
}).strict()

export type AvailabilityInput = z.infer<typeof availabilityInput>
export type AvailabilitySnapshot = {
  revision: number
  slots: AvailabilityInput['slots']
  dateOverrides: AvailabilityInput['dateOverrides']
  offer: NonNullable<AvailabilityInput['offer']> | null
}

export function availabilityValidationError(input: AvailabilityInput): string | null {
  const invalid = input.slots.some(s => s.start_time >= s.end_time) || input.dateOverrides.some(o =>
    o.start_time === null ? o.end_time !== null || o.type === 'available' : o.end_time === null || o.start_time >= o.end_time)
  if (invalid) return 'Bitte gib gültige Zeitfenster mit einer Endzeit nach der Startzeit an.'
  const overlap = (a: { start_time: string | null; end_time: string | null }, b: { start_time: string | null; end_time: string | null }) =>
    a.start_time === null || b.start_time === null || (a.start_time < b.end_time! && b.start_time < a.end_time!)
  if (input.slots.some((s, i) => input.slots.slice(i + 1).some(t => s.day_of_week === t.day_of_week && overlap(s, t))) ||
      input.dateOverrides.some((s, i) => input.dateOverrides.slice(i + 1).some(t => s.date === t.date && overlap(s, t)))) {
    return 'Zeitfenster dürfen sich nicht überschneiden oder widersprechen.'
  }
  for (const date of new Set(input.dateOverrides.map(o => o.date))) {
    const windows = getWindowsForDate(date, input.slots, input.dateOverrides)
    if (windows.some((w, i) => windows.slice(i + 1).some(t => timeToMin(w.end) > timeToMin(t.start)))) {
      return 'Zusätzliche Verfügbarkeit darf bestehende Zeitfenster nicht überschneiden.'
    }
  }
  return null
}

export function availabilitySaveError(error: { code?: string; message?: string }) {
  if ((error.code === '40001' || error.code === 'PT409')) return { status: 409, error: 'Die Einstellungen wurden inzwischen geändert. Bitte lade die Seite neu und prüfe deine Änderungen.', reloadRequired: true }
  if (error.code === '23P01') return { status: 409, error: 'Diese Änderung würde eine bestehende Buchung oder Reservierung ausschließen. Bitte behalte deren Zeitfenster bei.' }
  if (error.code === '22023' || error.code === '22007' || error.code === '22008') return { status: 400, error: 'Ungültige oder überlappende Verfügbarkeit. Bitte prüfe alle Zeitfenster.' }
  if (error.code === '42501') return { status: 403, error: 'Du darfst diese Verfügbarkeit nicht ändern.' }
  return { status: 503, error: 'Speichern konnte nicht bestätigt werden. Bitte lade den gespeicherten Stand neu, bevor du es erneut versuchst.', reloadRequired: true }
}
