import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { notifyNewSubscriber } from '@/app/api/webhooks/stripe/route'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { tierId, creatorId, discountId } = await req.json()

  const { data: tier } = await supabase
    .from('subscription_tiers')
    .select('*, creator:creator_profiles(stripe_account_id, stripe_account_active)')
    .eq('id', tierId)
    .single()

  if (!tier) {
    return NextResponse.json({ error: 'Abo-Stufe nicht gefunden' }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Validate discount if provided
  let discountSavingsCents = 0
  let discountRowId: string | null = null

  if (discountId && tier.price_monthly > 0) {
    const { data: disc } = await supabase
      .from('discounts')
      .select('id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to, target_product_id, target_tier_id')
      .eq('id', discountId)
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
      .select('id')
      .eq('buyer_id', user.id)
      .eq('creator_id', creatorId)
      .eq('status', 'active')
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
    }

    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 100)

    const { error } = await supabase.from('subscriptions').insert({
      buyer_id: user.id,
      creator_id: creatorId,
      tier_id: tierId,
      stripe_subscription_id: `free_${crypto.randomUUID()}`,
      status: 'active',
      current_period_end: farFuture.toISOString(),
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    notifyNewSubscriber(supabase, user.id, creatorId, tierId).catch(console.error)
    return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
  }

  // Paid tier — go through Stripe checkout
  const originalPriceCents = Math.round(tier.price_monthly * 100)
  const finalPriceCents    = Math.max(50, originalPriceCents - discountSavingsCents)

  // TODO: When Stripe Connect is active, replace the manual price reduction below
  // with a Stripe Coupon object attached via `discounts: [{ coupon: couponId }]`
  // so the discount appears natively in Stripe and subscription invoices reflect it.
  // The coupon should be created once per discount row and cached on the discount record.
  let priceId = discountSavingsCents > 0 ? null : tier.stripe_price_id

  if (!priceId) {
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: finalPriceCents,
      recurring: { interval: 'month' },
      product_data: { name: tier.name },
    })
    priceId = price.id

    // Only cache the price ID when no discount was applied
    if (discountSavingsCents === 0) {
      await supabase
        .from('subscription_tiers')
        .update({ stripe_price_id: priceId })
        .eq('id', tierId)
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    locale: 'de',
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      tier_id: tierId,
      buyer_id: user.id,
      creator_id: creatorId,
    },
    success_url: `${appUrl}/buyer?subscribed=1`,
    cancel_url: `${appUrl}/creators`,
    ...(tier.creator?.stripe_account_id && tier.creator?.stripe_account_active
      ? {
          subscription_data: {
            application_fee_percent: 5,
            transfer_data: { destination: tier.creator.stripe_account_id },
          },
        }
      : {}),
  })

  // Increment redemption count (best-effort)
  if (discountRowId) {
    const { data: latest } = await supabase
      .from('discounts')
      .select('redemption_count')
      .eq('id', discountRowId)
      .single()
    if (latest) {
      await supabase
        .from('discounts')
        .update({ redemption_count: latest.redemption_count + 1 })
        .eq('id', discountRowId)
        .eq('redemption_count', latest.redemption_count)
    }
  }

  return NextResponse.json({ url: session.url })
}
