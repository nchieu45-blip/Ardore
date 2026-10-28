import { after, NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validGroupId, validGroupInstant } from '@/lib/group-booking-validation'
import { groupRequestError, GROUP_PRIVATE_HEADERS } from '@/lib/group-booking-http'
import { berlinDateTimeToIso, isValidDateString, isValidTimeString } from '@/lib/coaching-slots'
import { runCoachingEmails } from '@/lib/coaching-emails'

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: GROUP_PRIVATE_HEADERS })
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const invalid = groupRequestError(request)
  if (invalid) return invalid
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!validGroupId(id) || !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'expectedStart,newDate,newTime,occurrenceStart,requestId'
    || !validGroupId(body.requestId) || !validGroupInstant(body.occurrenceStart) || !validGroupInstant(body.expectedStart)
    || !isValidDateString(body.newDate) || !isValidTimeString(body.newTime)) return reply({ error: 'Ungültige Termindaten.' }, 400)
  const newStart = berlinDateTimeToIso(body.newDate, body.newTime)
  if (!newStart) return reply({ error: 'Diese Uhrzeit ist wegen der Zeitumstellung nicht eindeutig. Bitte wähle eine andere Uhrzeit.' }, 400)
  try {
    const client = await createClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) return reply({ error: 'Nicht angemeldet.' }, 401)
    const service = await createServiceClient()
    const { data, error } = await service.rpc('reschedule_group_occurrence', {
      p_class_id: id, p_occurrence: body.occurrenceStart, p_expected_start: body.expectedStart,
      p_new_start: newStart, p_actor_id: user.id, p_request_id: body.requestId,
    })
    if (error || !data) return reply({ error: 'Die Verschiebung konnte nicht bestätigt werden. Bitte lade den Termin neu, bevor du es erneut versuchst.' }, 503)
    if (data.error) {
      const refusals: Record<string, [number, string]> = {
        forbidden: [403, 'Nur der Coach kann den gemeinsamen Gruppentermin verschieben.'],
        not_found: [404, 'Gruppentermin nicht gefunden.'],
        stale: [409, 'Der Termin wurde inzwischen geändert. Bitte lade die Seite neu.'],
        request_conflict: [409, 'Diese Anfrage gehört zu einer anderen Terminänderung. Bitte lade die Seite neu.'],
        time: [409, 'Termine können nur vor Öffnung des Videoraums und auf die nächsten 90 Tage verschoben werden.'],
        conflict: [409, 'Der Coach hat zu dieser Zeit bereits einen Termin. Bitte wähle eine andere Zeit.'],
        busy: [409, 'Eine Benachrichtigung wird gerade verarbeitet. Bitte versuche es in Kürze erneut.'],
        payment_pending: [409, 'Für diesen Termin läuft noch eine Zahlungs- oder Erstattungsprüfung. Bitte warte deren Abschluss ab.'],
      }
      const [status, message] = refusals[data.error] ?? [400, 'Ungültige Termindaten.']
      return reply({ error: message }, status)
    }
    if (typeof data.eventId === 'string') after(async () => { await runCoachingEmails(data.eventId) })
    return reply({ ok: true, scheduledAt: data.scheduledAt, unchanged: data.unchanged })
  } catch {
    return reply({ error: 'Die Antwort ist unklar. Bitte lade den Termin neu, bevor du es erneut versuchst.' }, 503)
  }
}
