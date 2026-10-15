import { randomUUID } from 'node:crypto'
import type { CreateEmailOptions } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { COACHING_PAYMENT_ELIGIBILITY_FILTER, hasValidCoachingPayment } from '@/lib/coaching-payment'
import { FROM, sendEmail } from '@/lib/email'
import {
  sessionReminderHtml, sessionReminderText,
  sessionReviewPromptHtml, sessionReviewPromptText,
} from '@/lib/email/templates'

type Service = Awaited<ReturnType<typeof createServiceClient>>
type Kind = 'session_reminder' | 'session_review_prompt'
type Channel = 'inapp' | 'email'
type Booking = {
  id: string; buyer_id: string; buyer_name: string | null; scheduled_at: string
  duration_minutes: number; status: string; payment_status: string; stripe_livemode: boolean | null
  creator_profiles: { user_id: string; display_name: string } | { user_id: string; display_name: string }[]
}
type InappPayload = { title: string; message: string; link: string }
type Claim = {
  state: 'claimed' | 'sent' | 'legacy_skipped' | 'busy' | 'held'
  id?: string; payload?: CreateEmailOptions | InappPayload
}
export type SessionCronResult = {
  sent: number; skipped: number; failed: number; legacySkipped: number; busy: number; held: number
}
const HOUR = 60 * 60_000
const REVIEW_CATCHUP = 7 * 24 * HOUR
const MAX_DURATION = 480 // Existing booking duration constraint.
const PAGE_SIZE = 200
const BOOKING_FIELDS = 'id,buyer_id,buyer_name,scheduled_at,duration_minutes,status,payment_status,stripe_livemode,creator_profiles!inner(user_id,display_name)'

function coachOf(booking: Booking) {
  return Array.isArray(booking.creator_profiles) ? booking.creator_profiles[0] : booking.creator_profiles
}

function eligible(booking: Booking, kind: Kind, now: Date): boolean {
  if (!hasValidCoachingPayment(booking)) return false
  const start = Date.parse(booking.scheduled_at)
  if (!Number.isFinite(start)) return false
  if (kind === 'session_reminder') {
    return booking.status === 'confirmed' && start > now.getTime() && start <= now.getTime() + 24 * HOUR
  }
  const end = start + booking.duration_minutes * 60_000
  return ['confirmed', 'completed'].includes(booking.status)
    && booking.duration_minutes > 0 && booking.duration_minutes <= MAX_DURATION
    && end <= now.getTime() && end >= now.getTime() - REVIEW_CATCHUP
}

async function candidates(service: Service, kind: Kind, now: Date): Promise<Booking[]> {
  const rows: Booking[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = service.from('bookings').select(BOOKING_FIELDS).or(COACHING_PAYMENT_ELIGIBILITY_FILTER)
    query = kind === 'session_reminder'
      ? query.eq('status', 'confirmed').gt('scheduled_at', now.toISOString())
        .lte('scheduled_at', new Date(now.getTime() + 24 * HOUR).toISOString())
      : query.in('status', ['confirmed', 'completed'])
        .gte('scheduled_at', new Date(now.getTime() - REVIEW_CATCHUP - MAX_DURATION * 60_000).toISOString())
        .lte('scheduled_at', now.toISOString())
    const { data, error } = await query.order('id').range(offset, offset + PAGE_SIZE - 1)
    if (error || !data) throw new Error('booking_read_failed')
    rows.push(...data as unknown as Booking[])
    if (data.length < PAGE_SIZE) return rows
  }
}

async function currentBooking(service: Service, previous: Booking, kind: Kind, now: Date) {
  const { data, error } = await service.from('bookings').select(BOOKING_FIELDS).eq('id', previous.id).maybeSingle()
  if (error) throw new Error('booking_refresh_failed')
  const current = data as unknown as Booking | null
  if (!current || Date.parse(current.scheduled_at) !== Date.parse(previous.scheduled_at)
    || !eligible(current, kind, now)) return null
  return current
}

async function preferences(service: Service, userId: string, kind: Kind) {
  // Review prompts have no configurable columns in the existing preference UI/schema.
  if (kind === 'session_review_prompt') return { inapp: true, email: true }
  const { data, error } = await service.from('notification_preferences')
    .select('inapp_session_reminder,email_session_reminder').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('preferences_read_failed')
  return { inapp: data?.inapp_session_reminder !== false, email: data?.email_session_reminder !== false }
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

async function payloads(service: Service, booking: Booking, userId: string, kind: Kind, emailEnabled: boolean) {
  const coach = coachOf(booking)
  if (!coach?.user_id || !booking.buyer_id) throw new Error('booking_participant_missing')
  const isCoach = userId === coach.user_id
  const recipientName = isCoach ? coach.display_name : booking.buyer_name ?? 'Teilnehmer'
  const otherName = isCoach ? booking.buyer_name ?? 'Teilnehmer' : coach.display_name
  const date = new Date(booking.scheduled_at)
  const scheduledDate = date.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'long', year: 'numeric' })
  const scheduledTime = date.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
  const link = kind === 'session_reminder' ? `/session/${booking.id}` : `/buyer/sessions?review=${booking.id}`
  const inapp: InappPayload = kind === 'session_reminder'
    ? { title: 'Erinnerung an deine Session', message: `Deine Session mit ${otherName} findet am ${scheduledDate} um ${scheduledTime} Uhr (Europe/Berlin) statt.`, link }
    : { title: 'Wie war deine Session?', message: `Bewerte jetzt deine Session mit ${coach.display_name}.`, link }
  if (!emailEnabled) return { inapp, email: null }
  const { data, error } = await service.auth.admin.getUserById(userId)
  if (error || !data.user?.email) throw new Error('recipient_read_failed')
  let email: CreateEmailOptions
  if (kind === 'session_reminder') {
    const { data: meeting, error: meetingError } = await service.from('booking_meeting_links')
      .select('booking_id').eq('booking_id', booking.id).maybeSingle()
    if (meetingError) throw new Error('meeting_read_failed')
    const details = {
      recipientName, coachName: otherName, scheduledDate, scheduledTime,
      minutesUntil: 0, // Absolute date/time below avoids a stale countdown in frozen retries.
      sessionUrl: `${appOrigin()}${link}`, role: isCoach ? 'creator' as const : 'buyer' as const,
      meetingReady: Boolean(meeting),
    }
    email = { from: FROM, to: data.user.email,
      subject: `Session-Erinnerung: ${scheduledDate}, ${scheduledTime} Uhr`,
      html: sessionReminderHtml({ ...details, recipientName: escapeHtml(recipientName), coachName: escapeHtml(otherName) }),
      text: sessionReminderText(details) }
  } else {
    const details = { buyerName: recipientName, coachName: coach.display_name, reviewUrl: `${appOrigin()}${link}` }
    email = { from: FROM, to: data.user.email, subject: `Wie war deine Session mit ${coach.display_name}?`,
      html: sessionReviewPromptHtml({ ...details, buyerName: escapeHtml(recipientName), coachName: escapeHtml(coach.display_name) }),
      text: sessionReviewPromptText(details) }
  }
  return { inapp, email }
}

async function deliver(service: Service, booking: Booking, userId: string, kind: Kind, channel: Channel,
  payload: CreateEmailOptions | InappPayload, result: SessionCronResult) {
  const token = randomUUID()
  const { data, error } = await service.rpc('claim_session_notification', {
    p_booking_id: booking.id, p_recipient_id: userId, p_type: kind, p_channel: channel,
    p_occurrence: booking.scheduled_at, p_payload: payload, p_token: token,
  })
  if (error || !data) throw new Error('delivery_claim_failed')
  const claim = data as Claim
  if (claim.state === 'sent' || claim.state === 'legacy_skipped') {
    result.skipped++
    if (claim.state === 'legacy_skipped') result.legacySkipped++
    return
  }
  if (claim.state === 'busy' || claim.state === 'held') {
    result[claim.state]++
    throw new Error('delivery_not_available')
  }
  if (claim.state !== 'claimed' || !claim.id || !claim.payload) throw new Error('invalid_delivery_claim')
  try {
    if (channel === 'email') {
      await sendEmail(claim.payload as CreateEmailOptions, { idempotencyKey: `session-notification/${claim.id}` })
    }
    const completed = await service.rpc('complete_session_notification', { p_id: claim.id, p_token: token })
    if (completed.error || completed.data !== true) throw new Error('delivery_completion_failed')
    result.sent++ // Confirmed channel, not a booking count or proof of inbox delivery.
  } catch {
    const released = await service.rpc('fail_session_notification', { p_id: claim.id, p_token: token })
    if (released.error || released.data !== true) throw new Error('delivery_retry_record_failed')
    throw new Error('delivery_failed')
  }
}

export async function runSessionNotifications(kind: Kind, now = new Date()): Promise<SessionCronResult> {
  const started = Date.now()
  const currentTime = () => new Date(now.getTime() + Date.now() - started)
  const service = await createServiceClient()
  const result: SessionCronResult = { sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }
  const bookings = await candidates(service, kind, now)
  for (const candidate of bookings) {
    if (!eligible(candidate, kind, now)) continue
    const coach = coachOf(candidate)
    const recipients = kind === 'session_reminder' ? [coach?.user_id, candidate.buyer_id] : [candidate.buyer_id]
    for (const userId of new Set(recipients)) {
      if (!userId) { result.failed++; continue }
      try {
        const booking = await currentBooking(service, candidate, kind, currentTime())
        if (!booking) { result.skipped++; continue }
        if (userId !== booking.buyer_id && userId !== coachOf(booking)?.user_id) {
          result.skipped++
          continue
        }
        if (kind === 'session_review_prompt') {
          const { count, error } = await service.from('session_reviews')
            .select('id', { count: 'exact', head: true }).eq('booking_id', booking.id)
          if (error) throw new Error('review_read_failed')
          if ((count ?? 0) > 0) { result.skipped++; continue }
        }
        const prefs = await preferences(service, userId, kind)
        const { inapp } = await payloads(service, booking, userId, kind, false)
        if (prefs.inapp) {
          try { await deliver(service, booking, userId, kind, 'inapp', inapp, result) }
          catch { result.failed++ }
        } else result.skipped++
        if (prefs.email) {
          try {
            const fresh = await currentBooking(service, booking, kind, currentTime())
            if (!fresh || (userId !== fresh.buyer_id && userId !== coachOf(fresh)?.user_id)) {
              result.skipped++
              continue
            }
            const { email } = await payloads(service, fresh, userId, kind, true)
            if (email) await deliver(service, fresh, userId, kind, 'email', email, result)
          } catch { result.failed++ }
        } else result.skipped++
      } catch { result.failed++ }
    }
  }
  return result
}
