import { z } from 'zod'
import { MAX_GROUP_PARTICIPANTS } from '@/lib/group-schedule'

const input = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional().default(null),
  schedule_type: z.enum(['once', 'recurring']),
  starts_at: z.iso.datetime({ offset: true }).nullable().optional().default(null),
  recurring_weekday: z.number().int().min(0).max(6).nullable().optional().default(null),
  recurring_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::00(?:\.0{1,6})?)?$/).nullable().optional().default(null),
  duration_minutes: z.number().int().min(5).max(480),
  max_participants: z.number().int().min(1).max(MAX_GROUP_PARTICIPANTS).nullable().optional().transform(value => value ?? MAX_GROUP_PARTICIPANTS),
  price_cents: z.number().int().min(0).max(2_000_000_000).refine(value => value === 0 || value >= 50),
  included_in_subscription: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
}).strict()

const keys = new Set(Object.keys(input.shape))
export function groupClassBodyKeysValid(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.keys(value).every(key => keys.has(key)))
}

export function parseGroupClassInput(value: unknown) {
  const parsed = input.safeParse(value)
  if (!parsed.success) return null
  const course = parsed.data
  if (course.schedule_type === 'once' && (!course.starts_at || !Number.isFinite(Date.parse(course.starts_at)))) return null
  if (course.schedule_type === 'recurring' && (course.recurring_weekday === null || !course.recurring_time)) return null
  return {
    ...course,
    starts_at: course.schedule_type === 'once' ? course.starts_at : null,
    recurring_weekday: course.schedule_type === 'recurring' ? course.recurring_weekday : null,
    recurring_time: course.schedule_type === 'recurring' ? course.recurring_time : null,
  }
}

export function groupClassMutationError(error: { code?: string }) {
  if (error.code === '23514' || error.code === '23503') return {
    status: 409,
    error: 'Für diesen Kurs bestehen Terminvereinbarungen oder Buchungen. Bereits gebuchte Termine bleiben erhalten. Verwalte die Anmeldungen einzeln oder erstelle einen neuen Kurs mit den neuen Zeiten.',
  }
  return { status: 503, error: 'Die Änderung konnte nicht bestätigt werden. Bitte lade den gespeicherten Stand erneut.' }
}
