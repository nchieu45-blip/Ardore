import { randomUUID } from 'node:crypto'
import type { CreateEmailOptions } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { FROM, sendEmail } from '@/lib/email'
import { coachingUpdateHtml, coachingUpdateText, type CoachingUpdateData } from '@/lib/email/templates'
import type { SessionCronResult } from '@/lib/session-cron'

type Service = Awaited<ReturnType<typeof createServiceClient>>
type Delivery = {
  id: string; booking_kind: 'individual' | 'group'; booking_id: string
  event_kind: 'cancellation' | 'refund'; recipient_id: string; recipient_role: 'customer' | 'coach'
  payload: CreateEmailOptions | null
  details: { customer_id: string | null; coach_name: string; title: string; scheduled_at: string
    amount_cents: number; total_refunded_cents: number }
}
async function user(service: Service, id: string) {
  const result = await service.auth.admin.getUserById(id)
  if (result.error || !result.data.user?.email) throw new Error('coaching_email_recipient_failed')
  return result.data.user
}
async function payload(service: Service, row: Delivery): Promise<CreateEmailOptions> {
  if (row.payload) return row.payload // Retry the exact frozen request, including address and copy.
  const recipient = await user(service, row.recipient_id)
  let customer = row.recipient_role === 'customer' ? recipient : null
  if (row.details.customer_id && row.details.customer_id !== row.recipient_id) {
    try { customer = await user(service, row.details.customer_id) }
    catch { /* A deleted customer must not suppress the coach's transactional notice. */ }
  }
  const name = (u: typeof recipient, fallback: string) => typeof u.user_metadata?.full_name === 'string'
    ? u.user_metadata.full_name : fallback
  const details: CoachingUpdateData = {
    recipientName: name(recipient, row.recipient_role === 'coach' ? row.details.coach_name : 'Kunde'),
    customerName: customer ? name(customer, 'Kunde') : 'Kunde', coachName: row.details.coach_name,
    title: row.details.title, scheduleLabel: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(row.details.scheduled_at)) + ' Uhr', role: row.recipient_role, event: row.event_kind,
    amountCents: row.details.amount_cents, totalRefundedCents: row.details.total_refunded_cents,
    bookingsUrl: `${appOrigin()}${row.booking_kind === 'group'
      ? row.recipient_role === 'coach' ? '/creator/settings/video-classes' : '/buyer/video-classes'
      : row.recipient_role === 'coach' ? '/creator/sessions' : '/buyer/sessions'}`,
  }
  return { from: FROM, to: recipient.email!,
    subject: `${row.event_kind === 'refund' ? 'Erstattung bestätigt' : 'Buchung storniert'}: ${row.details.title}`,
    html: coachingUpdateHtml(details), text: coachingUpdateText(details) }
}

/** Durable transitions come from DB triggers, including webhook/recovery observations.
 * Transactional notices do not use the optional reminder/marketing preference. */
export async function runCoachingEmails(bookingId?: string): Promise<SessionCronResult> {
  const service = await createServiceClient()
  const result: SessionCronResult = { sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }
  // Keyset pagination prevents a failed first page starving later recipients.
  let cursor: string | null = null
  for (;;) {
    let query = service.from('coaching_email_deliveries').select('*').in('state', ['pending', 'processing']).order('id').limit(100)
    if (bookingId) query = query.eq('booking_id', bookingId)
    if (cursor) query = query.gt('id', cursor)
    const page = await query
    if (page.error || !page.data) throw new Error('coaching_email_read_failed')
    for (const row of page.data as Delivery[]) {
      const token = randomUUID()
      let claimed = false
      try {
        const frozen = await payload(service, row)
        const claim = await service.rpc('claim_coaching_email', { p_id: row.id, p_payload: frozen, p_token: token })
        if (claim.error || !claim.data) throw new Error('coaching_email_claim_failed')
        const state = claim.data as { state: string; payload?: CreateEmailOptions }
        if (state.state === 'sent' || state.state === 'missing') { result.skipped++; continue }
        if (state.state === 'held' || state.state === 'busy') { result[state.state]++; result.failed++; continue }
        if (state.state !== 'claimed' || !state.payload) throw new Error('coaching_email_invalid_claim')
        claimed = true
        await sendEmail(state.payload, { idempotencyKey: `coaching-update/${row.id}` })
        const complete = await service.rpc('complete_coaching_email', { p_id: row.id, p_token: token })
        if (complete.error || complete.data !== true) throw new Error('coaching_email_completion_failed')
        result.sent++
      } catch {
        if (claimed) {
          try { await service.rpc('fail_coaching_email', { p_id: row.id, p_token: token }) }
          catch { /* The lease will expire; another recipient can still be delivered. */ }
        }
        result.failed++
      }
    }
    if (page.data.length < 100) break
    cursor = page.data.at(-1)!.id
  }
  const held = await service.from('coaching_email_deliveries').select('id', { count: 'exact', head: true })
    .eq('state', 'held')
  if (held.error) result.failed++
  else { result.held = Math.max(result.held, held.count ?? 0); if (held.count) result.failed++ }
  return result
}
