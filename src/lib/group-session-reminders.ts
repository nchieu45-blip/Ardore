import { randomUUID } from 'node:crypto'
import type { CreateEmailOptions } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { FROM, sendEmail } from '@/lib/email'
import { groupSessionReminderHtml, groupSessionReminderText } from '@/lib/email/templates'
import type { SessionCronResult } from '@/lib/session-cron'

type Service = Awaited<ReturnType<typeof createServiceClient>>
type Recipient = {
  video_class_id: string; occurrence_start: string; recipient_id: string
  recipient_role: 'participant' | 'coach'; class_title: string
  duration_minutes: number; coach_name: string; scheduled_at?: string
}
type Claim = { state: 'claimed' | 'sent' | 'busy' | 'held' | 'ineligible'; id?: string; payload?: CreateEmailOptions }
const PAGE_SIZE = 200
const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

function identity(row: Recipient) {
  return { p_class_id: row.video_class_id, p_occurrence: row.occurrence_start,
    p_recipient_id: row.recipient_id, p_role: row.recipient_role }
}

async function eligible(service: Service, row: Recipient) {
  const result = await service.rpc('group_reminder_is_eligible', identity(row))
  if (result.error || typeof result.data !== 'boolean') throw new Error('group_reminder_eligibility_failed')
  return result.data
}

async function deliver(service: Service, row: Recipient, result: SessionCronResult) {
  if (!await eligible(service, row)) { result.skipped++; return }
  const user = await service.auth.admin.getUserById(row.recipient_id)
  if (user.error || !user.data.user?.email) throw new Error('group_reminder_recipient_failed')
  const name = typeof user.data.user.user_metadata?.full_name === 'string'
    ? user.data.user.user_metadata.full_name : row.recipient_role === 'coach' ? row.coach_name : 'Teilnehmer'
  const scheduleLabel = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(row.scheduled_at ?? row.occurrence_start)) + ' Uhr'
  const details = { recipientName: name, coachName: row.coach_name, classTitle: row.class_title,
    scheduleLabel, durationMinutes: row.duration_minutes, role: row.recipient_role,
    sessionUrl: `${appOrigin()}/group-session/${row.video_class_id}?occurrenceStart=${encodeURIComponent(row.occurrence_start)}` }
  const payload: CreateEmailOptions = { from: FROM, to: user.data.user.email,
    subject: `Gruppencoaching-Erinnerung: ${row.class_title} · ${scheduleLabel}`,
    html: groupSessionReminderHtml({ ...details, recipientName: escapeHtml(name),
      coachName: escapeHtml(row.coach_name), classTitle: escapeHtml(row.class_title) }),
    text: groupSessionReminderText(details) }
  const token = randomUUID()
  const claimResult = await service.rpc(row.scheduled_at ? 'claim_current_group_reminder' : 'claim_group_reminder', { ...identity(row), p_payload: payload, p_token: token, ...(row.scheduled_at ? { p_expected_start: row.scheduled_at } : {}) })
  if (claimResult.error || !claimResult.data) throw new Error('group_reminder_claim_failed')
  const claim = claimResult.data as Claim
  if (claim.state === 'sent' || claim.state === 'ineligible') { result.skipped++; return }
  if (claim.state === 'busy' || claim.state === 'held') {
    result[claim.state]++
    throw new Error('group_reminder_unavailable')
  }
  if (claim.state !== 'claimed' || !claim.id || !claim.payload) throw new Error('group_reminder_invalid_claim')
  try {
    // Recheck membership, refunds, time and preferences immediately before SMTP.
    // A cancellation racing the external provider cannot be made transactional.
    if (!await eligible(service, row)) {
      const released = await service.rpc('fail_group_reminder', { p_id: claim.id, p_token: token })
      if (released.error || released.data !== true) throw new Error('group_reminder_release_failed')
      result.skipped++
      return
    }
    await sendEmail(claim.payload, { idempotencyKey: `group-reminder/${claim.id}` })
    const completed = await service.rpc('complete_group_reminder', { p_id: claim.id, p_token: token })
    if (completed.error || completed.data !== true) throw new Error('group_reminder_completion_failed')
    result.sent++
  } catch {
    const released = await service.rpc('fail_group_reminder', { p_id: claim.id, p_token: token })
    if (released.error || released.data !== true) throw new Error('group_reminder_retry_failed')
    throw new Error('group_reminder_delivery_failed')
  }
}

export async function runGroupSessionReminders(now = new Date()): Promise<SessionCronResult> {
  const service = await createServiceClient()
  const result: SessionCronResult = { sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await service.from('group_reminder_recipients')
      .select('video_class_id,occurrence_start,recipient_id,recipient_role,class_title,duration_minutes,coach_name,scheduled_at')
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', new Date(now.getTime() + 24 * 3_600_000).toISOString())
      .order('video_class_id').order('occurrence_start').order('recipient_id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (page.error || !page.data) throw new Error('group_reminder_read_failed')
    for (const row of page.data as Recipient[]) {
      try { await deliver(service, row, result) } catch { result.failed++ }
    }
    if (page.data.length < PAGE_SIZE) return result
  }
}
