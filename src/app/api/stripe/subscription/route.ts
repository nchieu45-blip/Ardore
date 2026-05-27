import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { tierId, creatorId } = await req.json()

  const { data: tier } = await supabase
    .from('subscription_tiers')
    .select('*, creator:creator_profiles(stripe_account_id, stripe_account_active)')
    .eq('id', tierId)
    .single()

  if (!tier) {
    return NextResponse.json({ error: 'Abo-Stufe nicht gefunden' }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

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

    return NextResponse.json({ url: `${appUrl}/buyer?subscribed=1` })
  }

  // Paid tier — go through Stripe checkout
  let priceId = tier.stripe_price_id

  if (!priceId) {
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: Math.round(tier.price_monthly * 100),
      recurring: { interval: 'month' },
      product_data: { name: tier.name },
    })
    priceId = price.id

    await supabase
      .from('subscription_tiers')
      .update({ stripe_price_id: priceId })
      .eq('id', tierId)
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

  return NextResponse.json({ url: session.url })
}
