import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isValidCoachingDuration, validateCoachingSlot } from '@/lib/coaching-booking'
import { provisionConfirmedCoachingBooking } from '@/lib/coaching-confirmation'
import { randomUUID } from 'node:crypto'
import { berlinDateTimeToIso } from '@/lib/coaching-slots'
import { COACHING_RESERVATION_MINUTES, startOrResumeCoachingCheckout } from '@/lib/coaching-checkout'
import { hasActiveSubscriptionEntitlement } from '@/lib/subscription-entitlement'
import { ConnectReadinessError, requirePublishedCoach, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null)
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  const { creatorId, date, time, name, email, notes, subscriptionId, discountId, expectedCancellationPolicyHours, requestId } = payload
  if (![creatorId, date, time, name, email].every(value => typeof value === 'string' && value.trim())) return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Die E-Mail-Adresse stimmt nicht mit deinem Konto überein.' }, { status: 400 })
  }

  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) {
    return NextResponse.json({ error: 'Ungültige Buchungsanfrage' }, { status: 400 })
  }
  const bookingRequestKey = requestId ?? randomUUID()
  const service = await createServiceClient()
  const scheduledAt = berlinDateTimeToIso(date, time)
  async function resumeRequest() {
    const { data: existing, error: existingError } = await service.from('bookings')
      .select('id, creator_id, scheduled_at, buyer_name, buyer_email, notes, status, payment_status, cancellation_policy_hours')
      .eq('buyer_id', user!.id).eq('booking_request_key', bookingRequestKey).maybeSingle()
    if (existingError) return NextResponse.json({ error: 'Buchungsstatus konnte nicht geprüft werden.' }, { status: 503 })
    if (!existing) return null
    if (existing.creator_id !== creatorId || !scheduledAt || new Date(existing.scheduled_at).getTime() !== new Date(scheduledAt).getTime()
      || existing.buyer_name !== name.trim() || existing.buyer_email.toLowerCase() !== email.trim().toLowerCase()
      || (existing.notes ?? null) !== (typeof notes === 'string' ? notes.trim() || null : null)
      || (expectedCancellationPolicyHours !== undefined && expectedCancellationPolicyHours !== existing.cancellation_policy_hours)) {
      return NextResponse.json({ error: 'Diese Buchungsanfrage wurde bereits für einen anderen Termin oder andere Angaben verwendet.' }, { status: 409 })
    }
    if (existing.payment_status === 'not_required' && existing.status === 'confirmed') {
      return NextResponse.json({ bookingId: existing.id, cancellationPolicyHours: existing.cancellation_policy_hours })
    }
    const result = await startOrResumeCoachingCheckout({ service, bookingId: existing.id, buyerId: user!.id })
    const { status, ...body } = result
    return NextResponse.json(body, { status })
  }
  const resumed = await resumeRequest()
  if (resumed) return resumed

  try {
    await requirePublishedCoach(service, creatorId)
  } catch (error) {
    if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Coach-Profil momentan nicht verfügbar.' }, { status: 503 })
  }

  let isSubscriptionSession = false
  let resolvedSubscriptionId: string | null = null
  let tierDurationMinutes: number | null = null
  if (subscriptionId) {
    const { data: sub } = await supabase.from('subscriptions')
      .select('id, buyer_id, creator_id, status, current_period_end, stripe_subscription_id, stripe_livemode, subscription_tiers(creator_id, included_video_sessions, video_session_period, included_session_duration_minutes)')
      .eq('id', subscriptionId).single()
    if (sub && sub.buyer_id === user.id && sub.creator_id === creatorId && hasActiveSubscriptionEntitlement(sub)) {
      const tier = Array.isArray(sub.subscription_tiers) ? sub.subscription_tiers[0] : sub.subscription_tiers
      const total = (tier as { included_video_sessions: number } | null)?.included_video_sessions ?? 0
      const period = (tier as { video_session_period: string | null } | null)?.video_session_period ?? 'month'
      const now = new Date()
      const periodStart = period === 'week'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
        : new Date(now.getFullYear(), now.getMonth(), 1)
      periodStart.setHours(0, 0, 0, 0)
      const { count } = await supabase.from('bookings').select('*', { count: 'exact', head: true })
        .eq('subscription_id', subscriptionId).in('status', ['confirmed', 'completed']).gte('created_at', periodStart.toISOString())
      if (total > 0 && (count ?? 0) < total) {
        isSubscriptionSession = true
        resolvedSubscriptionId = subscriptionId
        tierDurationMinutes = (tier as { included_session_duration_minutes: number | null } | null)?.included_session_duration_minutes ?? null
      }
    }
  }

  const { data: offer } = await supabase.from('coaching_offers')
    .select('is_enabled, price_cents, duration_minutes, cancellation_policy_hours').eq('creator_id', creatorId).single()
  if (!offer?.is_enabled) return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })
  const cancellationPolicyHours = offer.cancellation_policy_hours ?? 24
  if (expectedCancellationPolicyHours !== undefined && expectedCancellationPolicyHours !== cancellationPolicyHours) {
    return NextResponse.json({ error: 'Die Stornierungsfrist wurde geändert. Bitte lade die Buchung neu.', policyChanged: true }, { status: 409 })
  }
  const effectiveDuration = isSubscriptionSession && tierDurationMinutes !== null ? tierDurationMinutes : offer.duration_minutes
  if (!isValidCoachingDuration(effectiveDuration)) return NextResponse.json({ error: 'Ungültige Sitzungsdauer' }, { status: 400 })

  let discountedPriceCents = offer.price_cents
  let discountRowId: string | null = null
  if (!isSubscriptionSession && discountId) {
    const { data: disc } = await supabase.from('discounts')
      .select('id, creator_id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to, target_product_id, target_tier_id')
      .eq('id', discountId).single()
    const now = new Date()
    const valid = disc && disc.creator_id === creatorId && disc.active && (disc.applies_to === 'all' || disc.applies_to === 'sessions')
      && !disc.target_product_id && !disc.target_tier_id
      && (!disc.starts_at || new Date(disc.starts_at) <= now) && (!disc.ends_at || new Date(disc.ends_at) >= now)
      && (disc.max_redemptions === null || disc.redemption_count < disc.max_redemptions)
    if (valid) {
      discountRowId = disc.id
      const savings = disc.type === 'percent' ? Math.round(offer.price_cents * disc.value / 100) : Math.min(disc.value, offer.price_cents)
      discountedPriceCents = Math.max(0, offer.price_cents - savings)
    }
  }
  if (!isSubscriptionSession && discountedPriceCents > 0 && discountedPriceCents < 50) {
    return NextResponse.json({ error: 'Der Buchungsbetrag liegt unter dem Stripe-Mindestbetrag.' }, { status: 400 })
  }

  const slotValidation = await validateCoachingSlot({ creatorId, date, time, durationMinutes: effectiveDuration })
  if (!slotValidation.ok) {
    if (slotValidation.status === 409) {
      const concurrentRequest = await resumeRequest()
      if (concurrentRequest) return concurrentRequest
    }
    return NextResponse.json({ error: slotValidation.error }, { status: slotValidation.status })
  }

  const requiresPayment = !isSubscriptionSession && discountedPriceCents > 0
  let stripeLivemode: boolean | null = null
  if (requiresPayment) {
    try {
      stripeLivemode = (await requirePayoutReadyCoach(service, creatorId)).livemode
    } catch (error) {
      if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
      return NextResponse.json({ error: 'Der Auszahlungsstatus konnte nicht geprüft werden.' }, { status: 503 })
    }
  }

  const reservationExpiresAt = requiresPayment ? new Date(Date.now() + COACHING_RESERVATION_MINUTES * 60_000) : null
  const { data: booking, error } = await service.from('bookings').insert({
    creator_id: creatorId, buyer_id: user.id, booking_request_key: bookingRequestKey, scheduled_at: slotValidation.scheduledAt,
    cancellation_policy_hours: cancellationPolicyHours,
    duration_minutes: effectiveDuration, status: requiresPayment ? 'pending_payment' : 'confirmed',
    payment_status: requiresPayment ? 'pending' : 'not_required', buyer_email: user.email,
    buyer_name: name.trim(), notes: typeof notes === 'string' ? notes.trim() || null : null, subscription_id: resolvedSubscriptionId,
    is_subscription_session: isSubscriptionSession, price_cents: isSubscriptionSession ? 0 : discountedPriceCents,
    buffer_minutes: slotValidation.bufferMinutes, reservation_expires_at: reservationExpiresAt?.toISOString() ?? null,
    discount_id: discountRowId,
    stripe_livemode: stripeLivemode,
  }).select('id, cancellation_policy_hours').single()
  if (error?.code === '23505') {
    const duplicate = await resumeRequest()
    if (duplicate) return duplicate
  }
  if (error?.code === '40001') return NextResponse.json({ error: 'Die Stornierungsfrist wurde geändert. Bitte lade die Buchung neu.', policyChanged: true }, { status: 409 })
  if (error?.code === '23P01') return NextResponse.json({ error: 'Dieser Zeitslot wurde gerade vergeben.' }, { status: 409 })
  if (error || !booking) return NextResponse.json({ error: 'Buchung konnte nicht erstellt werden.' }, { status: 500 })

  if (!requiresPayment) {
    await provisionConfirmedCoachingBooking(booking.id)
    return NextResponse.json({ bookingId: booking.id, cancellationPolicyHours: booking.cancellation_policy_hours })
  }

  const result = await startOrResumeCoachingCheckout({ service, bookingId: booking.id, buyerId: user.id })
  const { status, ...body } = result
  return NextResponse.json(body, { status })
}
