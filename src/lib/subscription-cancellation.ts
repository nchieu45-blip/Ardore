import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasActiveSubscriptionEntitlement, type SubscriptionEntitlement } from '@/lib/subscription-entitlement'

export interface CancellableSubscription extends SubscriptionEntitlement {
  id: string
  buyer_id: string
  tier_id: string | null
}

export interface SubscriptionCancellationState {
  kind: 'paid' | 'free'
  state: 'available' | 'scheduled' | 'ended'
  endsAt: string | null
  accessUntil: string | null
}

export class SubscriptionCancellationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'SubscriptionCancellationError'
  }
}

const supportMessage = 'Dieses Abo muss vor der Kündigung vom Ardore-Support geprüft werden.'
const unavailableMessage = 'Der Kündigungsstatus ist momentan nicht verfügbar. Bitte versuche es erneut.'

function isFree(subscription: CancellableSubscription): boolean {
  return subscription.stripe_livemode === null && subscription.stripe_subscription_id.startsWith('free_')
}

function isoTimestamp(seconds: number | null | undefined): string | null {
  if (!Number.isSafeInteger(seconds) || (seconds ?? 0) <= 0) return null
  const date = new Date(seconds! * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function freeState(subscription: CancellableSubscription, now: number): SubscriptionCancellationState {
  const ended = subscription.status === 'canceled' || Date.parse(subscription.current_period_end) <= now
  if (!Number.isFinite(Date.parse(subscription.current_period_end))) {
    throw new SubscriptionCancellationError(409, supportMessage)
  }
  return { kind: 'free', state: ended ? 'ended' : 'available',
    endsAt: ended ? subscription.current_period_end : null, accessUntil: null }
}

async function ownedProviderSubscription(
  service: SupabaseClient,
  provider: Stripe,
  subscription: CancellableSubscription,
  livemode: boolean,
): Promise<Stripe.Subscription> {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscription.stripe_subscription_id)
    || subscription.stripe_livemode !== livemode) {
    throw new SubscriptionCancellationError(409, supportMessage)
  }
  let remote: Stripe.Subscription
  try {
    remote = await provider.subscriptions.retrieve(subscription.stripe_subscription_id)
  } catch {
    throw new SubscriptionCancellationError(503, unavailableMessage)
  }
  if (remote.id !== subscription.stripe_subscription_id || remote.livemode !== livemode
    || remote.metadata.buyer_id !== subscription.buyer_id
    || remote.metadata.creator_id !== subscription.creator_id
    || remote.metadata.tier_id !== subscription.tier_id) {
    throw new SubscriptionCancellationError(409, supportMessage)
  }

  // The local immutable provider ID is the first ownership boundary. New
  // checkouts additionally bind it to a private, frozen settlement order.
  // Historical subscriptions are accepted only with exact server-issued
  // buyer/coach/tier metadata; never infer ownership from an email address.
  const orderId = remote.metadata.ardore_order_id
  if (orderId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      throw new SubscriptionCancellationError(409, supportMessage)
    }
    const { data: order, error } = await service.from('payment_orders')
      .select('id,kind,buyer_id,creator_id,stripe_subscription_id,stripe_livemode,reference')
      .eq('id', orderId).eq('buyer_id', subscription.buyer_id).maybeSingle()
    if (error) throw new SubscriptionCancellationError(503, unavailableMessage)
    if (!order || order.id !== orderId || order.kind !== 'subscription'
      || order.buyer_id !== subscription.buyer_id || order.creator_id !== subscription.creator_id
      || order.stripe_subscription_id !== remote.id || order.stripe_livemode !== livemode
      || order.reference?.tierId !== subscription.tier_id) {
      throw new SubscriptionCancellationError(409, supportMessage)
    }
  }
  return remote
}

function paidState(
  subscription: CancellableSubscription,
  remote: Stripe.Subscription,
  now: number,
): SubscriptionCancellationState {
  if (remote.status === 'canceled' || remote.status === 'incomplete_expired') {
    return { kind: 'paid', state: 'ended', endsAt: isoTimestamp(remote.ended_at), accessUntil: null }
  }
  // Ardore currently creates one fixed monthly item. Refuse ambiguous schedules
  // rather than silently choosing a different billing boundary or extending it.
  const item = remote.items.data.length === 1 && !remote.items.has_more ? remote.items.data[0] : null
  const periodEnd = isoTimestamp(item?.current_period_end)
  const scheduledEnd = isoTimestamp(remote.cancel_at)
  // A custom date beyond this period could allow another renewal. Do not call
  // that a period-end cancellation or silently leave a longer schedule in place.
  if (scheduledEnd && (!periodEnd || Date.parse(scheduledEnd) > Date.parse(periodEnd))) {
    throw new SubscriptionCancellationError(409, supportMessage)
  }
  const scheduled = remote.cancel_at_period_end || scheduledEnd !== null
  const endsAt = scheduled ? scheduledEnd ?? periodEnd : periodEnd
  if (!endsAt || (!scheduled && (remote.schedule !== null
    || !['active', 'trialing', 'past_due', 'unpaid'].includes(remote.status)
    || Date.parse(endsAt) <= now))) {
    throw new SubscriptionCancellationError(409, supportMessage)
  }
  const accessEnd = Math.min(Date.parse(subscription.current_period_end), Date.parse(endsAt))
  const accessUntil = remote.status === 'active' && accessEnd > now && hasActiveSubscriptionEntitlement(subscription, now)
    ? new Date(accessEnd).toISOString() : null
  return { kind: 'paid', state: scheduled ? 'scheduled' : 'available', endsAt, accessUntil }
}

export async function inspectSubscriptionCancellation(input: {
  service: SupabaseClient
  provider: Stripe | null
  subscription: CancellableSubscription
  livemode: boolean | null
  now?: number
}): Promise<SubscriptionCancellationState> {
  const { service, provider, subscription, livemode, now = Date.now() } = input
  if (isFree(subscription)) return freeState(subscription, now)
  if (livemode === null || !provider) throw new SubscriptionCancellationError(503, unavailableMessage)
  return paidState(subscription, await ownedProviderSubscription(service, provider, subscription, livemode), now)
}

export async function cancelSubscription(input: {
  service: SupabaseClient
  provider: Stripe | null
  subscription: CancellableSubscription
  livemode: boolean | null
  now?: number
}): Promise<SubscriptionCancellationState> {
  const { service, provider, subscription, livemode, now = Date.now() } = input
  if (isFree(subscription)) {
    const before = freeState(subscription, now)
    if (before.state === 'ended') return before
    // Compare-and-set prevents a stale free snapshot canceling a replaced or
    // concurrently changed subscription. No browser write permission is added.
    const target = service.from('subscriptions')
      .update({ status: 'canceled', current_period_end: new Date(now).toISOString() })
      .eq('id', subscription.id).eq('buyer_id', subscription.buyer_id)
      .eq('creator_id', subscription.creator_id)
      .eq('stripe_subscription_id', subscription.stripe_subscription_id)
      .is('stripe_livemode', null).eq('status', subscription.status)
      .eq('current_period_end', subscription.current_period_end)
    const { data: saved, error } = await (subscription.tier_id === null
      ? target.is('tier_id', null) : target.eq('tier_id', subscription.tier_id))
      .select('id,status,current_period_end').maybeSingle()
    if (error) throw new SubscriptionCancellationError(503, unavailableMessage)
    if (!saved || saved.id !== subscription.id || saved.status !== 'canceled') {
      throw new SubscriptionCancellationError(409, 'Der Abo-Status hat sich geändert. Bitte prüfe ihn erneut.')
    }
    return { kind: 'free', state: 'ended', endsAt: saved.current_period_end, accessUntil: null }
  }
  if (livemode === null || !provider) throw new SubscriptionCancellationError(503, unavailableMessage)
  const remote = await ownedProviderSubscription(service, provider, subscription, livemode)
  const before = paidState(subscription, remote, now)
  if (before.state !== 'available') return before
  try {
    // Only disable automatic renewal: no refunds, proration, price changes,
    // immediate cancellation, or writes to invoice-derived access fields.
    // Repeating this boolean update is idempotent. A permanent per-subscription
    // key would incorrectly replay an old result after dashboard reactivation.
    await provider.subscriptions.update(remote.id, { cancel_at_period_end: true })
    // Read current state again, including ownership, instead of reporting
    // success from the submitted intent or an old update response.
    const confirmed = await ownedProviderSubscription(service, provider, subscription, livemode)
    const result = paidState(subscription, confirmed, Date.now())
    if (result.state === 'available') throw new Error('cancellation_not_confirmed')
    return result
  } catch {
    throw new SubscriptionCancellationError(503,
      'Die Kündigung konnte noch nicht bestätigt werden. Bitte prüfe den Status erneut, bevor du es erneut versuchst.')
  }
}
