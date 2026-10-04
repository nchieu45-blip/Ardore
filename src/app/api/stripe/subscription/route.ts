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

  // Validate discount if provided
  let discountSavingsCents = 0
  let discountRowId: string | null = null

  if (discountId && tier.price_monthly > 0) {
    const { data: disc } = await supabase
      .from('discounts')
      .select('id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to, target_product_id, target_tier_id')
      .eq('id', discountId)
      .eq('creator_id', tier.creator_id)
      .single()

    const now = new Date()
    const tierTargetOk = !disc?.target_tier_id || disc.target_tier_id === tierId
    const valid = disc &&
      disc.active &&
      !disc.target_product_id &&
      (disc.target_tier_id ? tierTargetOk : (disc.applies_to === 'all' || disc.applies_to === 'subscriptions')) &&
      (!disc.starts_at || new Date(disc.starts_at) <= now) &&
      (!disc.ends_at   || new Date(disc.ends_at)   >= now) &&
      (disc.max_redemptions === null || disc.redemption_count < disc.max_redemptions)

    if (valid) {
      discountRowId = disc.id
      const priceCents = Math.round(tier.price_monthly * 100)
      discountSavingsCents = disc.type === 'percent'
        ? Math.round(priceCents * disc.value / 100)
        : Math.min(disc.value, priceCents)
    }
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

  // Paid tier — go through Stripe checkout
  const originalPriceCents = Math.round(tier.price_monthly * 100)
  const finalPriceCents    = Math.max(50, originalPriceCents - discountSavingsCents)

  const service = await createServiceClient()
  let accountId: string
  let livemode: boolean
  try {
    const readiness = await requirePayoutReadyCoach(service, tier.creator_id)
    accountId = readiness.accountId
    livemode = readiness.livemode
  } catch (error) {
    if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Der Auszahlungsstatus konnte nicht geprüft werden.' }, { status: 503 })
  }
  const order = await createSettlementOrder({
    service,
    kind: 'subscription',
    buyerId: user.id,
    creatorId: tier.creator_id,
    accountId,
    grossCents: finalPriceCents,
    livemode,
    reference: { tierId: tier.id },
  })
  const metadata = { ardore_order_id: order.id, tier_id: tier.id, buyer_id: user.id, creator_id: tier.creator_id }

  // TODO: When Stripe Connect is active, replace the manual price reduction below
  // with a Stripe Coupon object attached via `discounts: [{ coupon: couponId }]`
  // so the discount appears natively in Stripe and subscription invoices reflect it.
  // The coupon should be created once per discount row and cached on the discount record.
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
    success_url: `${appUrl}/buyer?subscribed=1`,
    cancel_url: `${appUrl}/creators`,
    subscription_data: {
      metadata,
    },
  }, { idempotencyKey: `ardore-order-checkout-${order.id}-v1` })
  await registerSettlementCheckout({ service, orderId: order.id, sessionId: session.id,
    subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id })

  // Increment redemption count (best-effort)
  if (discountRowId) {
    const { data: latest } = await supabase
      .from('discounts')
      .select('redemption_count')
      .eq('id', discountRowId)
      .single()
    if (latest) {
      const service = await createServiceClient()
      await service
        .from('discounts')
        .update({ redemption_count: latest.redemption_count + 1 })
        .eq('id', discountRowId)
        .eq('redemption_count', latest.redemption_count)
    }
  }

  return NextResponse.json({ url: session.url })
}
