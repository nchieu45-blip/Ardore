import { randomUUID } from 'node:crypto'
import { DiscountError, releaseDiscount } from '@/lib/discounts'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { notifyNewSubscriber } from '@/lib/subscription-notifications'
import { appOrigin } from '@/lib/app-url'
import { z } from 'zod'
import { configuredStripeLivemode, ConnectReadinessError, requirePublishedCoach, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'
import { type SettlementOrder, registerSettlementCheckout } from '@/lib/stripe/settlement'

const subscriptionRequest = z.object({
  tierId: z.uuid(),
  creatorId: z.uuid(),
  discountId: z.uuid().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const input = subscriptionRequest.safeParse(await req.json().catch(() => null))
  if (!input.success) {
    return NextResponse.json({ error: 'Ungültige Abo-Anfrage' }, { status: 400 })
  }
  const { tierId, creatorId, discountId } = input.data

  const { data: tier } = await supabase
    .from('subscription_tiers')
    .select('*, creator:creator_profiles(stripe_account_id, stripe_account_active)')
    .eq('id', tierId)
    .eq('creator_id', creatorId)
    .eq('is_active', true)
    .single()

  if (!tier) {
    return NextResponse.json({ error: 'Abo-Stufe nicht gefunden' }, { status: 404 })
  }

  try {
    await requirePublishedCoach(await createServiceClient(), tier.creator_id)
  } catch (error) {
    if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Coach-Profil momentan nicht verfügbar.' }, { status: 503 })
  }

  const service = await createServiceClient()
  const appUrl = appOrigin()
  try {
    const livemode = configuredStripeLivemode()
    const prepare = (accountId: string | null) => service.rpc('prepare_subscription_checkout', {
      p_id: randomUUID(), p_buyer_id: user.id, p_creator_id: creatorId, p_tier_id: tierId,
      p_discount_id: discountId ?? null, p_account_id: accountId, p_livemode: livemode, p_app_url: appUrl,
    })
    let accountId: string | null = null
    // At most one old attempt is retired per request. A concurrent successor
    // may already exist by the time this request tries the reservation again.
    for (let round = 0; round < 2; round++) {
      let prepared = await prepare(accountId)
      if (prepared.error?.code === 'PT424') {
        const readiness = await requirePayoutReadyCoach(service, creatorId)
        if (readiness.livemode !== livemode) throw new Error('subscription_mode_mismatch')
        accountId = readiness.accountId
        prepared = await prepare(accountId)
      }
      if (prepared.error?.code === 'PT422') throw new DiscountError('minimum_payment')
      if (prepared.error || !prepared.data) throw new Error('subscription_prepare_failed')
      const result = prepared.data
      if (result.state === 'invalid_discount') throw new DiscountError('invalid_discount')
      if (result.state === 'tier_unavailable') return NextResponse.json({ error: 'Abo-Stufe nicht gefunden' }, { status: 404 })
      if (result.state === 'already_subscribed') {
        if (tier.price_monthly === 0 && result.active === true) {
          return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
        }
        return NextResponse.json({ error: 'Für diesen Coach besteht bereits ein Abo. Bitte prüfe deine Abos.' }, { status: 409 })
      }
      if (result.state === 'free') {
        if (result.newly_created) notifyNewSubscriber(service, user.id, creatorId, tierId, 0).catch(console.error)
        return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
      }
      if (result.state !== 'checkout' || !result.order) throw new Error('subscription_prepare_invalid')
      const order = result.order as SettlementOrder
      if (order.kind !== 'subscription' || order.buyer_id !== user.id || order.creator_id !== creatorId
        || order.stripe_livemode !== livemode) throw new Error('subscription_order_mismatch')

      let session
      if (order.stripe_checkout_session_id) {
        session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
      } else {
        const expiresAt = order.reference.checkoutExpiresAt
        if (!Number.isInteger(expiresAt) || typeof order.reference.tierName !== 'string'
          || typeof order.reference.appUrl !== 'string' || typeof order.reference.tierId !== 'string') {
          throw new Error('subscription_checkout_unconfirmed')
        }
        // New orders must bind their Stripe ID before the URL is returned.
        // After the frozen Stripe expiry, even a late replay cannot pay, and
        // a fresh Stripe request cannot create a session at that timestamp.
        const expiry = Number(expiresAt) * 1000
        if (Date.now() >= expiry + 5 * 60_000) {
          const { error } = await service.from('payment_orders')
            .update({ subscription_checkout_closed_at: new Date().toISOString() })
            .eq('id', order.id).is('stripe_checkout_session_id', null).is('subscription_checkout_closed_at', null)
          if (error) throw new Error('subscription_close_failed')
          continue
        }
        if (Date.now() >= expiry) throw new Error('subscription_checkout_expiring')
        const metadata = { ardore_order_id: order.id, tier_id: order.reference.tierId,
          buyer_id: order.buyer_id, creator_id: order.creator_id }
        // All Stripe inputs come from the order, including on timeout/retry.
        session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          locale: 'de',
          line_items: [{
            price_data: { currency: 'eur', unit_amount: order.gross_cents,
              recurring: { interval: 'month' }, product_data: { name: order.reference.tierName } },
            quantity: 1,
          }],
          metadata,
          expires_at: Number(expiresAt),
          success_url: `${order.reference.appUrl}/buyer?subscribed=1`,
          cancel_url: `${order.reference.appUrl}/creators`,
          subscription_data: { metadata },
        }, { idempotencyKey: `ardore-order-checkout-${order.id}-v1` })
        await registerSettlementCheckout({ service, orderId: order.id, sessionId: session.id,
          subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id })
      }

      if (session.metadata?.ardore_order_id !== order.id || session.metadata.buyer_id !== user.id
        || session.metadata.creator_id !== creatorId || session.livemode !== livemode
        || session.mode !== 'subscription') throw new Error('subscription_checkout_mismatch')
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      let terminal = session.status === 'expired' && session.payment_status === 'unpaid' && !subscriptionId
      if (session.status === 'complete' && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        terminal = subscription.id === subscriptionId && subscription.livemode === livemode
          && subscription.metadata?.ardore_order_id === order.id
          && ['canceled', 'incomplete_expired'].includes(subscription.status)
      }
      if (terminal) {
        const redemptionId = order.reference.discountRedemptionId
        if (session.status === 'expired' && typeof redemptionId === 'string') await releaseDiscount(service, redemptionId)
        const { error } = await service.from('payment_orders').update({ subscription_checkout_closed_at: new Date().toISOString() })
          .eq('id', order.id).eq('stripe_checkout_session_id', session.id).is('subscription_checkout_closed_at', null)
        if (error) throw new Error('subscription_close_failed')
        continue
      }
      const matchingOffer = order.reference.tierId === tierId
        && (order.reference.discountId ?? null) === (discountId ?? null)
      if (session.status === 'open' && session.url && matchingOffer && session.expires_at * 1000 > Date.now()) return NextResponse.json({ url: session.url })
      return NextResponse.json({ error: 'Für diesen Coach läuft bereits ein Abo-Abschluss. Bitte schließe ihn ab oder warte, bis er abläuft.' }, { status: 409 })
    }
  } catch (error) {
    if (error instanceof ConnectReadinessError || error instanceof DiscountError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
  }
  return NextResponse.json({ error: 'Abo-Abschluss momentan nicht verfügbar. Bitte versuche es erneut oder kontaktiere den Support.' }, { status: 503 })
}
