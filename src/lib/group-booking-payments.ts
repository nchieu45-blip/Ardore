import { effectiveGroupStart } from '@/lib/group-effective-schedule'
import { validGroupId, validGroupInstant, sameGroupInstant } from '@/lib/group-booking-validation'
import { MAX_GROUP_PARTICIPANTS } from '@/lib/group-capacity'
export { validGroupId, validGroupInstant } from '@/lib/group-booking-validation'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { stripe } from '@/lib/stripe/server'
import { appOrigin } from '@/lib/app-url'
import { ConnectReadinessError, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'
import { hasActiveSubscriptionEntitlement } from '@/lib/subscription-entitlement'
import { createSettlementOrder, getSettlementRefundContext, prepareSettlementRefund, reconcileSettlementCheckout, reconcileSettlementRefund, registerSettlementCheckout } from '@/lib/stripe/settlement'
import type { PaymentSettlement, SettlementOrder } from '@/lib/stripe/settlement'

export type GroupReservation = {
  id: string; request_id: string; buyer_id: string; creator_id: string; video_class_id: string;
  occurrence_start: string; duration_minutes: number; class_title: string; creator_slug: string;
  price_cents: number; subscription_id: string | null; stripe_livemode: boolean | null; account_id: string | null;
  payment_order_id: string | null; stripe_checkout_session_id: string | null; checkout_url: string | null;
  checkout_idempotency_key: string; checkout_expires_at: string; checkout_request_started_at: string | null;
  status: string; booking_id: string | null; refund_status: string; refund_idempotency_key: string;
  refund_provider_id: string | null; refund_amount_cents: number | null; refund_request_started_at: string | null;
  refund_requested_at: string | null; amount_refunded_cents: number; created_at: string;
}
export type GroupPaymentResult = { httpStatus: number; reservationId?: string; bookingId?: string; status?: string; url?: string; code?: string; error?: string }
export class GroupPaymentError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); this.name = 'GroupPaymentError' }
}
const idOf = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id ?? null
const messages: Record<string, string> = {
  coach_busy: 'Der Coach hat zu dieser Zeit bereits einen Termin. Bitte wähle einen anderen Termin.',
  full: 'Dieser Termin ist inzwischen ausgebucht.', already_booked: 'Du bist für diesen Termin bereits angemeldet.',
  not_found: 'Anmeldung oder Kurs nicht gefunden.', forbidden: 'Keine Berechtigung für diese Anmeldung.',
  request_conflict: 'Diese Buchungsanfrage gehört zu einem anderen Termin.',
  price_changed: 'Der Preis wurde inzwischen geändert. Bitte lade das Angebot neu und prüfe den aktuellen Preis.',
  not_available: 'Dieser Termin ist nicht mehr buchbar.', invalid_occurrence: 'Bitte wähle einen gültigen Kurstermin.',
  invalid_offer: 'Dieses Angebot kann momentan nicht gebucht werden.',
  checkout_closed: 'Dieser Zahlungsversuch ist beendet. Du kannst eine neue Buchung für den Termin starten.',
  video_not_configured: 'Videoanrufe sind noch nicht eingerichtet. Momentan können keine neuen Gruppenbuchungen gestartet werden.',
  group_size_unavailable: 'Dieses Gruppenangebot überschreitet die verfügbare Videokapazität. Bitte kontaktiere den Coach.',
  already_started: 'Der Termin hat bereits begonnen. Bitte kontaktiere deinen Coach.',
  already_ended: 'Der Termin ist bereits beendet. Bitte kontaktiere den Support.',
  payment_status_unavailable: 'Der Zahlungsstatus konnte noch nicht bestätigt werden. Bitte setze dieselbe Buchung unter „Meine Gruppen-Kurse“ fort.',
  payment_review: 'Diese Zahlung muss geprüft werden. Bitte kontaktiere den Support.',
}
function failure(code: string, httpStatus = 409, reservation?: GroupReservation): GroupPaymentResult {
  return { httpStatus, code, error: messages[code] ?? messages.payment_status_unavailable,
    ...(reservation ? { reservationId: reservation.id, status: reservation.status } : {}) }
}
function result(reservation: GroupReservation, url?: string): GroupPaymentResult {
  if (['expired', 'failed'].includes(reservation.status)) return failure('checkout_closed', 409, reservation)
  if (reservation.status === 'payment_review') return failure('payment_review', 409, reservation)
  return { httpStatus: ['creating', 'processing', 'refund_pending'].includes(reservation.status) ? 202 : 200,
    reservationId: reservation.id, status: reservation.status,
    ...(reservation.booking_id ? { bookingId: reservation.booking_id } : {}), ...(url ? { url } : {}) }
}
async function rpc<T>(service: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(name, args)
  if (error?.code === '23P01' && name === 'reserve_group_class_booking') throw new GroupPaymentError('coach_busy', 409)
  if (error || data === null) throw new GroupPaymentError('payment_status_unavailable')
  return data as T
}
export async function readGroupReservation(service: SupabaseClient, reservationId: string, buyerId?: string): Promise<GroupReservation> {
  if (!validGroupId(reservationId)) throw new GroupPaymentError('not_found', 404)
  let query = service.from('group_booking_reservations').select('*').eq('id', reservationId)
  if (buyerId) query = query.eq('buyer_id', buyerId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new GroupPaymentError('payment_status_unavailable')
  if (!data) throw new GroupPaymentError('not_found', 404)
  return data as GroupReservation
}
async function save(service: SupabaseClient, r: GroupReservation, values: Record<string, unknown>, states?: string[]) {
  let query = service.from('group_booking_reservations').update({ ...values, updated_at: new Date().toISOString() }).eq('id', r.id)
  if (states) query = query.in('status', states)
  const { error } = await query
  if (error) throw new GroupPaymentError('payment_status_unavailable')
}
function assert(value: unknown): asserts value { if (!value) throw new GroupPaymentError('payment_status_unavailable') }
function assertSession(r: GroupReservation, session: Stripe.Checkout.Session) {
  assert(session.mode === 'payment' && session.livemode === r.stripe_livemode && session.currency === 'eur'
    && session.amount_total === r.price_cents && session.metadata?.ardore_order_id === r.id
    && session.metadata.reservation_id === r.id && session.metadata.video_class_id === r.video_class_id
    && session.metadata.buyer_id === r.buyer_id && session.metadata.creator_id === r.creator_id)
}
async function ensureOrder(service: SupabaseClient, r: GroupReservation) {
  assert(r.price_cents > 0 && typeof r.stripe_livemode === 'boolean' && r.account_id)
  return createSettlementOrder({ service, id: r.id, kind: 'group', buyerId: r.buyer_id, creatorId: r.creator_id,
    accountId: r.account_id, grossCents: r.price_cents, livemode: r.stripe_livemode,
    reference: { reservationId: r.id, videoClassId: r.video_class_id, occurrenceStart: r.occurrence_start, durationMinutes: r.duration_minutes } })
}
async function bind(service: SupabaseClient, r: GroupReservation, session: Stripe.Checkout.Session, provider: Stripe) {
  assertSession(r, session)
  await registerSettlementCheckout({ service, orderId: r.id, sessionId: session.id, provider })
  return rpc<GroupReservation>(service, 'bind_group_checkout', { p_reservation_id: r.id, p_order_id: r.id,
    p_session_id: session.id, p_checkout_url: session.url })
}

/** Called by the generic signed-webhook/recovery pipeline after provider retrieval. */
export async function observeGroupCheckout({ service, order, session, provider = stripe }: {
  service: SupabaseClient; order: SettlementOrder; session: Stripe.Checkout.Session; provider?: Stripe;
}) {
  assert(order.kind === 'group' && order.reference.reservationId === order.id)
  let r = await readGroupReservation(service, order.id)
  assertSession(r, session)
  r = await bind(service, r, session, provider)
  if (!['creating', 'open', 'processing'].includes(r.status) || session.payment_status === 'paid') return
  let next = session.status === 'complete' ? 'processing' : r.status
  const intentId = idOf(session.payment_intent)
  if (intentId) {
    const intent = await provider.paymentIntents.retrieve(intentId)
    assert(intent.id === intentId && intent.livemode === r.stripe_livemode && intent.currency === 'eur'
      && intent.amount === r.price_cents && intent.metadata.ardore_order_id === r.id
      && intent.metadata.buyer_id === r.buyer_id && intent.metadata.creator_id === r.creator_id)
    if (['succeeded', 'processing', 'requires_capture', 'requires_action', 'requires_confirmation'].includes(intent.status)) next = 'processing'
    else if ((intent.status === 'canceled' || (intent.status === 'requires_payment_method' && intent.amount_received === 0)) && session.status !== 'open') {
      next = session.status === 'expired' ? 'expired' : 'failed'
    }
  } else if (session.status === 'expired') next = 'expired'
  await save(service, r, { status: next }, ['creating', 'open', 'processing'])
}

/** Resumes the exact durable provider request; clocks alone never release a possibly payable hold. */
export async function startOrResumeGroupCheckout({ service, reservationId, buyerId, provider = stripe }: {
  service: SupabaseClient; reservationId: string; buyerId: string; provider?: Stripe;
}): Promise<GroupPaymentResult> {
  let r: GroupReservation | undefined
  try {
    r = await readGroupReservation(service, reservationId, buyerId)
    if (!['creating', 'open', 'processing'].includes(r.status)) return result(r)
    if (r.stripe_checkout_session_id) {
      await reconcileSettlementCheckout({ service, sessionId: r.stripe_checkout_session_id, provider })
      r = await readGroupReservation(service, r.id, buyerId)
      if (r.status !== 'open') return result(r)
      if (!process.env.DAILY_API_KEY?.trim()) return failure('video_not_configured', 503, r)
      const ready = await requirePayoutReadyCoach(service, r.creator_id, provider)
      assert(ready.accountId === r.account_id && ready.livemode === r.stripe_livemode)
      const session = await provider.checkout.sessions.retrieve(r.stripe_checkout_session_id!)
      assertSession(r, session)
      if (session.status === 'open' && session.url) return result(r, session.url)
      return result(r)
    }
    if (!process.env.DAILY_API_KEY?.trim()) return failure('video_not_configured', 503, r)
    const ready = await requirePayoutReadyCoach(service, r.creator_id, provider)
    assert(ready.accountId === r.account_id && ready.livemode === r.stripe_livemode)
    await ensureOrder(service, r)
    if (r.checkout_request_started_at && Date.now() - Date.parse(r.checkout_request_started_at) >= 23 * 3_600_000) {
      // Discovery only after the provider's idempotency retention window. Never
      // make a replacement charge when the previous result is unknown.
      const sessions = await provider.checkout.sessions.list({ created: {
        gte: Math.floor(Date.parse(r.created_at) / 1000) - 60,
        lte: Math.floor(Date.parse(r.checkout_request_started_at) / 1000) + 3600,
      }, limit: 100 }).autoPagingToArray({ limit: 1000 })
      assert(sessions.length < 1000)
      const owned = sessions.filter(s => s.metadata?.ardore_order_id === r!.id)
      assert(owned.length === 1)
      await bind(service, r, owned[0], provider)
      await reconcileSettlementCheckout({ service, sessionId: owned[0].id, provider })
      return result(await readGroupReservation(service, r.id, buyerId))
    }
    if (!r.checkout_request_started_at && Date.parse(r.checkout_expires_at) <= Date.now()) {
      // Compare the current row too: a concurrent worker may have begun the
      // durable provider request after our read. Never release that payable hold.
      const { error } = await service.from('group_booking_reservations').update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', r.id).eq('status', 'creating').is('checkout_request_started_at', null).is('stripe_checkout_session_id', null)
      if (error) throw new GroupPaymentError('payment_status_unavailable')
      r = await readGroupReservation(service, r.id, buyerId)
      if (r.status !== 'creating' || !r.checkout_request_started_at) return result(r)
    }
    if (!r.checkout_request_started_at) {
      // A conditional write preserves the first-start timestamp across retries.
      const { error } = await service.from('group_booking_reservations').update({ checkout_request_started_at: new Date().toISOString() })
        .eq('id', r.id).is('checkout_request_started_at', null)
      if (error) throw new GroupPaymentError('payment_status_unavailable')
    }
    const metadata = { checkout_type: 'group_session', ardore_order_id: r.id, reservation_id: r.id,
      video_class_id: r.video_class_id, buyer_id: r.buyer_id, creator_id: r.creator_id, occurrence_start: r.occurrence_start }
    const letters = [...createHash('sha256').update(r.id).digest().subarray(0, 8)].map(n => String.fromCharCode(97 + n % 26)).join('')
    let session: Stripe.Checkout.Session
    try {
      session = await provider.checkout.sessions.create({ mode: 'payment', integration_identifier: `ardore_group_${letters}`,
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: r.price_cents,
          product_data: { name: `${r.class_title} · einzelne Session` } } }], metadata,
        payment_intent_data: { metadata, transfer_group: `ardore-order-${r.id}` },
        expires_at: Math.floor(Date.parse(r.checkout_expires_at) / 1000),
        success_url: `${appOrigin()}/buyer/video-classes?checkout=success&reservation=${r.id}`,
        cancel_url: `${appOrigin()}/buyer/video-classes?checkout=cancelled&reservation=${r.id}`,
      }, { idempotencyKey: r.checkout_idempotency_key })
    } catch (error) {
      const e = error as { type?: string; code?: string }
      if (e.type === 'StripeInvalidRequestError' && !['idempotency_key_in_use', 'idempotency_error'].includes(e.code ?? '')) {
        await save(service, r, { status: 'failed', last_error_code: 'checkout_rejected' }, ['creating'])
      }
      throw new GroupPaymentError('payment_status_unavailable')
    }
    r = await bind(service, r, session, provider)
    if (session.status !== 'open' || !session.url) {
      await reconcileSettlementCheckout({ service, sessionId: session.id, provider })
      return result(await readGroupReservation(service, r.id, buyerId))
    }
    return result(r, session.url)
  } catch (error) {
    if (error instanceof GroupPaymentError && error.code === 'coach_busy') return failure(error.code, error.status)
    if (error instanceof ConnectReadinessError) return { httpStatus: error.status, error: error.message, code: error.code,
      ...(r ? { reservationId: r.id, status: r.status } : {}) }
    return failure(error instanceof GroupPaymentError ? error.code : 'payment_status_unavailable',
      error instanceof GroupPaymentError ? error.status : 503, r)
  }
}

export async function reserveGroupBooking({ service, classId, buyerId, requestId, occurrenceStart, expectedPriceCents, provider = stripe }: {
  service: SupabaseClient; classId: string; buyerId: string; requestId: string; occurrenceStart?: string;
  expectedPriceCents: number; provider?: Stripe;
}): Promise<GroupPaymentResult> {
  if (!validGroupId(classId) || !validGroupId(buyerId) || !validGroupId(requestId)) return failure('not_found', 400)
  try {
    const { data: existing, error: requestError } = await service.from('group_booking_reservations').select('*')
      .eq('buyer_id', buyerId).eq('request_id', requestId).maybeSingle()
    if (requestError) throw new GroupPaymentError('payment_status_unavailable')
    if (existing) {
      const r = existing as GroupReservation
      if (r.video_class_id !== classId || (occurrenceStart && !sameGroupInstant(r.occurrence_start, occurrenceStart))) return failure('request_conflict')
      return startOrResumeGroupCheckout({ service, reservationId: r.id, buyerId, provider })
    }
    // An absent provider credential must never result in collecting a payment
    // for a video service that cannot be delivered. Existing refunds still run.
    if (!process.env.DAILY_API_KEY?.trim()) return failure('video_not_configured', 503)
    const { data: course, error } = await service.from('video_classes').select('id,creator_id,active,price_cents,included_in_subscription,schedule_type,starts_at,max_participants')
      .eq('id', classId).maybeSingle()
    if (error) throw new GroupPaymentError('payment_status_unavailable')
    if (!course || !course.active) return failure('not_found', 404)
    if (!Number.isInteger(course.max_participants) || course.max_participants < 1 || course.max_participants > MAX_GROUP_PARTICIPANTS) {
      return failure('group_size_unavailable')
    }
    const start = occurrenceStart ?? (course.schedule_type === 'once' ? course.starts_at : null)
    if (!validGroupInstant(start) || Date.parse(await effectiveGroupStart(service, classId, start)) <= Date.now()) return failure('invalid_occurrence', 400)
    if (!Number.isSafeInteger(expectedPriceCents) || expectedPriceCents !== course.price_cents) return failure('price_changed')
    let included = false
    if (course.included_in_subscription) {
      const { data: subscriptions, error: subError } = await service.from('subscriptions')
        .select('creator_id,status,current_period_end,stripe_subscription_id,stripe_livemode,subscription_tiers(creator_id)')
        .eq('buyer_id', buyerId).eq('creator_id', course.creator_id).eq('status', 'active')
      if (subError) throw new GroupPaymentError('payment_status_unavailable')
      included = (subscriptions ?? []).some(s => hasActiveSubscriptionEntitlement(s))
    }
    const ready = course.price_cents > 0 && !included ? await requirePayoutReadyCoach(service, course.creator_id, provider) : null
    const claim = await rpc<{ error?: string; reservation?: GroupReservation; created?: boolean }>(service, 'reserve_group_class_booking', {
      p_class_id: classId, p_buyer_id: buyerId, p_request_id: requestId, p_occurrence_start: start,
      p_livemode: ready?.livemode ?? null, p_account_id: ready?.accountId ?? null, p_expected_price_cents: expectedPriceCents,
    })
    if (claim.error) return failure(claim.error, claim.error === 'not_found' ? 404 : 409)
    assert(claim.reservation)
    if (claim.created && claim.reservation.price_cents === 0) {
      const { notifyGroupBookingConfirmed } = await import('@/lib/group-booking-notifications')
      await notifyGroupBookingConfirmed(service, claim.reservation.id)
    }
    return claim.reservation.price_cents === 0 ? result(claim.reservation)
      : startOrResumeGroupCheckout({ service, reservationId: claim.reservation.id, buyerId, provider })
  } catch (error) {
    if (error instanceof ConnectReadinessError) return { httpStatus: error.status, error: error.message, code: error.code }
    return failure('payment_status_unavailable', 503)
  }
}

/** Provider observations can revoke only the booking fulfilled by this exact order. */
export async function projectGroupPaymentState({ service, order, settlement, disputeState }: {
  service: SupabaseClient; order: SettlementOrder; settlement: PaymentSettlement; disputeState: 'disputed' | 'chargeback' | null;
}) {
  const r = await readGroupReservation(service, String(order.reference.reservationId))
  assert(order.kind === 'group' && r.id === order.id && r.buyer_id === order.buyer_id && r.creator_id === order.creator_id
    && settlement.order_id === order.id && settlement.gross_cents === r.price_cents)
  const full = settlement.amount_refunded_cents === r.price_cents
  const partial = settlement.amount_refunded_cents > 0
  const refund = full ? 'succeeded' : r.refund_status
  const payment = full ? 'refunded' : disputeState ?? (partial ? 'partially_refunded' : 'paid')
  const values = { amount_refunded_cents: settlement.amount_refunded_cents, refund_status: refund,
    ...(full ? { status: 'refunded' } : (disputeState || partial) ? { status: 'payment_review' } : {}) }
  await save(service, r, values)
  let booking = service.from('video_class_bookings').update({ payment_status: payment,
    amount_refunded_cents: settlement.amount_refunded_cents, refund_status: refund,
    ...((full || partial || disputeState) ? { status: 'cancelled' } : {}) })
    .eq('reservation_id', r.id).eq('payment_order_id', order.id).eq('user_id', order.buyer_id)
  // A delayed ordinary observation cannot erase a previously recorded dispute.
  // Cancellation is never automatically reversed by any provider observation.
  if (!disputeState && !full && !partial) booking = booking.not('payment_status', 'in', '(disputed,chargeback,refunded,partially_refunded)')
  const { error } = await booking
  if (error) throw new GroupPaymentError('payment_status_unavailable')
}

/** Full cancellation/system refund through the existing reversal-aware settlement engine. */
export async function refundGroupReservation({ service, reservationId, provider = stripe }: {
  service: SupabaseClient; reservationId: string; provider?: Stripe;
}) {
  let r = await readGroupReservation(service, reservationId)
  if (r.price_cents === 0 || r.refund_status === 'succeeded') return r
  if (r.refund_status === 'failed') {
    if (r.status !== 'payment_review') {
      await save(service, r, { status: 'payment_review' })
      r = await readGroupReservation(service, r.id)
    }
    return r
  }
  assert(r.refund_status === 'pending' && r.payment_order_id)
  const { data: settled, error } = await service.from('payment_settlements').select('stripe_payment_intent_id')
    .eq('order_id', r.payment_order_id).maybeSingle()
  assert(!error && settled?.stripe_payment_intent_id)
  const paymentIntentId = settled.stripe_payment_intent_id as string
  const context = await getSettlementRefundContext({ service, paymentIntentId, provider })
  assert(context && context.kind === 'group' && context.orderId === r.payment_order_id && context.grossCents === r.price_cents
    && context.buyerId === r.buyer_id && context.creatorId === r.creator_id && context.livemode === r.stripe_livemode
    && context.reference.reservationId === r.id)
  await prepareSettlementRefund({ service, paymentIntentId, targetRefundedCents: r.price_cents, refundKey: r.refund_idempotency_key, provider })
  const refunds = await provider.refunds.list({ payment_intent: paymentIntentId, limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(refunds.length < 1000 && refunds.every(refund => refund.currency === 'eur' && idOf(refund.payment_intent) === paymentIntentId))
  const owned = refunds.filter(refund => refund.metadata?.ardore_refund_key === r.refund_idempotency_key)
  assert(owned.length <= 1)
  let refund = owned[0]
  if (r.refund_provider_id) {
    refund = await provider.refunds.retrieve(r.refund_provider_id)
    assert(refund.id === r.refund_provider_id && idOf(refund.payment_intent) === paymentIntentId
      && refund.metadata?.ardore_refund_key === r.refund_idempotency_key)
  }
  if (!refund) {
    const active = refunds.filter(refund => !['failed', 'canceled'].includes(refund.status ?? ''))
    if (active.reduce((sum, item) => sum + item.amount, 0) >= r.price_cents) {
      await reconcileSettlementRefund({ service, paymentIntentId, provider })
      return readGroupReservation(service, r.id)
    }
    // Unrelated partial/pending refunds require review instead of inventing a
    // new refundable balance or automatically replacing a failed provider ID.
    assert(active.length === 0)
    if (r.refund_request_started_at && Date.now() - Date.parse(r.refund_request_started_at) >= 23 * 3_600_000) {
      throw new GroupPaymentError('payment_review')
    }
    if (!r.refund_amount_cents) {
      const { error: freezeError } = await service.from('group_booking_reservations')
        .update({ refund_amount_cents: r.price_cents, refund_request_started_at: new Date().toISOString() })
        .eq('id', r.id).is('refund_amount_cents', null)
      assert(!freezeError)
      r = await readGroupReservation(service, r.id)
    }
    // Re-read/freeze above may race with an old unresolved worker; its first
    // provider-attempt timestamp still controls the idempotency safety horizon.
    if (r.refund_request_started_at && Date.now() - Date.parse(r.refund_request_started_at) >= 23 * 3_600_000) {
      throw new GroupPaymentError('payment_review')
    }
    refund = await provider.refunds.create({ payment_intent: paymentIntentId, amount: r.refund_amount_cents!,
      metadata: { ardore_settlement_id: context.settlementId, ardore_refund_key: r.refund_idempotency_key } },
    { idempotencyKey: r.refund_idempotency_key })
  }
  assert(refund.amount === r.refund_amount_cents || (r.refund_amount_cents === null && refund.amount === r.price_cents))
  await save(service, r, { refund_provider_id: refund.id,
    ...(['failed', 'canceled'].includes(refund.status ?? '') ? { status: 'payment_review', refund_status: 'failed', last_error_code: 'provider_refund_failed' } : {}) })
  await reconcileSettlementRefund({ service, paymentIntentId, provider })
  return readGroupReservation(service, r.id)
}

export async function cancelGroupBooking({ service, bookingId, actorId, provider = stripe }: {
  service: SupabaseClient; bookingId: string; actorId: string; provider?: Stripe;
}): Promise<GroupPaymentResult> {
  try {
    const claim = await rpc<{ error?: string; reservation?: GroupReservation }>(service, 'cancel_group_class_booking', { p_booking_id: bookingId, p_actor_id: actorId })
    if (claim.error) return failure(claim.error, claim.error === 'forbidden' ? 403 : claim.error === 'not_found' ? 404 : 409)
    assert(claim.reservation)
    const r = claim.reservation.price_cents > 0 ? await refundGroupReservation({ service, reservationId: claim.reservation.id, provider }) : claim.reservation
    return result(r)
  } catch { return failure('payment_status_unavailable', 503) }
}

export async function recoverGroupPayments({ service, limit = 25, provider = stripe }: {
  service: SupabaseClient; limit?: number; provider?: Stripe;
}) {
  const { data, error } = await service.from('group_booking_reservations').select('*')
    .in('status', ['creating', 'open', 'processing', 'refund_pending']).order('updated_at').limit(Math.min(50, Math.max(1, limit)))
  if (error) throw new GroupPaymentError('payment_status_unavailable')
  const counts = { checked: 0, confirmed: 0, closed: 0, pending: 0, failed: 0 }
  for (const row of (data ?? []) as GroupReservation[]) {
    counts.checked++
    let current: GroupReservation | null = null
    let failed = false
    try {
      if (row.status === 'refund_pending') await refundGroupReservation({ service, reservationId: row.id, provider })
      else if (row.stripe_checkout_session_id) await reconcileSettlementCheckout({ service, sessionId: row.stripe_checkout_session_id, provider })
      else {
        const resumed = await startOrResumeGroupCheckout({ service, reservationId: row.id, buyerId: row.buyer_id, provider })
        if (resumed.httpStatus >= 500) failed = true
      }
      current = await readGroupReservation(service, row.id)
    } catch (error) {
      failed = true
      if (error instanceof GroupPaymentError && error.code === 'payment_review' && row.status === 'refund_pending') {
        try { await save(service, row, { status: 'payment_review', last_error_code: 'payment_review' }) } catch { /* Keep the unresolved claim. */ }
      }
    } finally {
      // Rotate attempted rows even after an outage. Otherwise the oldest 50
      // unresolved holds could permanently starve every later payment.
      try { await save(service, row, {}) } catch { failed = true }
    }
    if (failed || !current || current.status === 'payment_review' || current.refund_status === 'failed') counts.failed++
    else if (current.status === 'confirmed') counts.confirmed++
    else if (['expired', 'failed', 'refunded', 'cancelled'].includes(current.status)) counts.closed++
    else counts.pending++
  }
  return counts
}
