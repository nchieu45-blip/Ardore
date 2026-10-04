import { randomUUID } from 'node:crypto'
import { DiscountError, reserveDiscount, releaseDiscount, requireStripeMinimum } from '@/lib/discounts'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { notifyNewSubscriber } from '@/app/api/webhooks/stripe/route'
import { appOrigin } from '@/lib/app-url'
import { hasActiveSubscriptionEntitlement } from '@/lib/subscription-entitlement'
import { z } from 'zod'
import { ConnectReadinessError, requirePublishedCoach, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'
import { createSettlementOrder, registerSettlementCheckout } from '@/lib/stripe/settlement'

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

  const appUrl = appOrigin()

  const service = await createServiceClient()
  const orderId = randomUUID()
  const originalPriceCents = Math.round(tier.price_monthly * 100)
  let reservation
  let finalPriceCents = originalPriceCents
  try {
    if (discountId && originalPriceCents > 0) {
      reservation = await reserveDiscount(service, { id: orderId, discountId, buyerId: user.id,
        creatorId: tier.creator_id, kind: 'subscriptions', originalCents: originalPriceCents, tierId })
      finalPriceCents = reservation.final_cents
    }
    requireStripeMinimum(finalPriceCents)
  } catch (error) {
    if (reservation) await releaseDiscount(service, reservation.id)
    if (error instanceof DiscountError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Rabatt konnte nicht geprüft werden.' }, { status: 503 })
  }
  if (reservation && finalPriceCents === 0) {
    const { data, error } = await service.rpc('complete_free_discount_subscription', { p_id: reservation.id })
    if (error || !data) {
      await releaseDiscount(service, reservation.id)
      return NextResponse.json({ error: 'Das kostenlose Abo konnte nicht freigeschaltet werden. Bitte prüfe deinen Rabatt.' }, { status: 409 })
    }
    if (data.newly_created) notifyNewSubscriber(service, user.id, tier.creator_id, tier.id).catch(console.error)
    return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
  }

  // Free tier — skip Stripe entirely and create the subscription directly
  if (tier.price_monthly === 0) {
    // Idempotent: return success if an active subscription already exists
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id, creator_id, status, current_period_end, stripe_subscription_id, stripe_livemode, tier:subscription_tiers(creator_id)')
      .eq('buyer_id', user.id)
      .eq('creator_id', creatorId)
      .eq('status', 'active')
      .maybeSingle()

    if (hasActiveSubscriptionEntitlement(existing)) {
      return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
    }

    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 100)

    // A free tier is a coach-controlled commercial offer. Its entitlement is
    // still written only by this authenticated, tier-scoped server path.
    const service = await createServiceClient()
    const { error } = await service.from('subscriptions').insert({
      buyer_id: user.id,
      creator_id: tier.creator_id,
      tier_id: tier.id,
      stripe_subscription_id: `free_${crypto.randomUUID()}`,
      stripe_livemode: null,
      status: 'active',
      current_period_end: farFuture.toISOString(),
    })

    if (error) {
      return NextResponse.json({ error: 'Abo konnte nicht erstellt werden' }, { status: 500 })
    }

    notifyNewSubscriber(service, user.id, tier.creator_id, tier.id).catch(console.error)
    return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
  }

  // The existing discount reduces every monthly cycle; count the new Abo once.
  let accountId: string
  let livemode: boolean
  try {
    const readiness = await requirePayoutReadyCoach(service, tier.creator_id)
    accountId = readiness.accountId
    livemode = readiness.livemode
  } catch (error) {
    if (reservation) await releaseDiscount(service, reservation.id)
    if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Der Auszahlungsstatus konnte nicht geprüft werden.' }, { status: 503 })
  }
  const order = await createSettlementOrder({
    service,
    id: orderId,
    kind: 'subscription',
    buyerId: user.id,
    creatorId: tier.creator_id,
    accountId,
    grossCents: finalPriceCents,
    livemode,
    reference: { tierId: tier.id, ...(reservation ? { discountRedemptionId: reservation.id } : {}) },
  })
  const metadata = { ardore_order_id: order.id, tier_id: tier.id, buyer_id: user.id, creator_id: tier.creator_id }

  // Always derive a new checkout price from the coach's current offer. A
  // client-editable or stale Stripe price ID must not determine the charge.
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    locale: 'de',
    customer_email: user.email,
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: finalPriceCents,
        recurring: { interval: 'month' },
        product_data: { name: tier.name },
      },
      quantity: 1,
    }],
    metadata,
    ...(reservation ? { expires_at: Math.floor(new Date(reservation.expires_at).getTime() / 1000) } : {}),
    success_url: `${appUrl}/buyer?subscribed=1`,
    cancel_url: `${appUrl}/creators`,
    subscription_data: {
      metadata,
    },
  }, { idempotencyKey: `ardore-order-checkout-${order.id}-v1` })
  await registerSettlementCheckout({ service, orderId: order.id, sessionId: session.id,
    subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id })

  return NextResponse.json({ url: session.url })
}
