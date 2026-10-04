import { isValidDateString, isValidTimeString } from './coaching-slots'

export function rescheduleDays(value: unknown, lastDay: number): number[] {
  const days = (value as { days?: unknown } | null)?.days
  if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 1 && d <= lastDay)) throw new Error('Invalid availability response')
  return [...new Set(days)]
}
export function rescheduleSlots(value: unknown): string[] {
  const slots = (value as { slots?: unknown } | null)?.slots
  if (!Array.isArray(slots) || !slots.every(s => typeof s === 'string' && isValidTimeString(s))) throw new Error('Invalid slots response')
  return [...new Set(slots)]
}
export type RescheduleResult = { ok: true } | { ok: false; message: string; conflict: boolean; uncertain: boolean }
export async function submitReschedule({ bookingId, date, time, signal, request = fetch }: {
  bookingId: string; date: string | null; time: string | null; signal: AbortSignal; request?: typeof fetch
}): Promise<RescheduleResult> {
  if (!date || !time || !isValidDateString(date) || !isValidTimeString(time)) return { ok: false, message: 'Bitte wähle ein gültiges Datum und eine Uhrzeit.', conflict: false, uncertain: false }
  try {
    const response = await request('/api/coaching/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, newDate: date, newTime: time }), signal })
    const body = await response.json().catch(() => null) as { ok?: unknown; error?: unknown; policyUnavailable?: boolean } | null
    if (response.ok && body?.ok === true) return { ok: true }
    if (response.ok) throw new Error('Unconfirmed response')
    if (response.status === 409) return { ok: false, conflict: !body?.policyUnavailable, uncertain: false,
      message: body?.policyUnavailable ? 'Die bei Buchung vereinbarte Frist ist nicht verfügbar. Bitte kontaktiere den Ardore-Support.'
        : `Die Buchung oder Verfügbarkeit wurde inzwischen geändert. ${typeof body?.error === 'string' ? body.error : 'Dieser Termin ist nicht mehr verfügbar.'} Bitte prüfe die aktuellen Zeiten und wähle gegebenenfalls einen anderen Termin.` }
    return { ok: false, conflict: false, uncertain: false, message: response.status === 401 ? 'Bitte melde dich erneut an, um den Termin zu verschieben.'
      : response.status === 403 ? (typeof body?.error === 'string' ? body.error : 'Du darfst diesen Termin nicht verschieben.')
        : response.status === 400 ? 'Bitte prüfe Datum, Uhrzeit und die vereinbarte Verschiebungsfrist. Die Verschiebung wurde nicht bestätigt.'
          : 'Der Termin konnte nicht verschoben werden. Bitte versuche es erneut. Deine Auswahl bleibt erhalten.' }
  } catch {
    // No blind POST retry after a lost response: the existing API may already
    // have committed. Reload the actual booking before any further request.
    return { ok: false, conflict: false, uncertain: true, message: 'Die Antwort konnte nicht empfangen werden. Dein Termin wurde möglicherweise bereits geändert. Bitte lade die Buchung neu, bevor du es erneut versuchst.' }
  }
}
