import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPurchaseReceipt, sendNewSubscriberNotification } from '@/lib/email/send'
import { createNotification } from '@/lib/notifications'
import Stripe from 'stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata ?? {}

      if (session.mode === 'payment' && meta.buyer_id) {
        // Support both legacy single product_id and new comma-separated product_ids
        const productIds: string[] = meta.product_ids
          ? meta.product_ids.split(',').filter(Boolean)
          : meta.product_id ? [meta.product_id] : []

        if (productIds.length > 0) {
          const totalPaid = (session.amount_total ?? 0) / 100
          const paymentIntentId = (session.payment_intent as string) ?? null

          // Fetch all products to get prices for per-item amount_paid
          const { data: productRows } = await supabase
            .from('products')
            .select('id, price, title, creator:creator_profiles(display_name)')
            .in('id', productIds)

          const productMap = new Map(
            (productRows ?? []).map((p: { id: string; price: number; title: string; creator: unknown }) => [p.id, p])
          )
          const priceSum = [...productMap.values()].reduce(
            (sum: number, p: { price: number }) => sum + p.price, 0
          )

          await supabase.from('purchases').insert(
            productIds.map(pid => {
              const p = productMap.get(pid) as { id: string; price: number } | undefined
              // Distribute total proportionally if prices differ from checkout total (e.g. promo)
              const amount = priceSum > 0 && p
                ? (p.price / priceSum) * totalPaid
                : totalPaid / productIds.length
              return {
                buyer_id: meta.buyer_id,
                product_id: pid,
                amount_paid: Math.round(amount * 100) / 100,
                stripe_payment_intent_id: paymentIntentId,
                // Withdrawal-right consent proof (§ 356 Abs. 5 BGB)
                // Columns added by migration 015; null for non-digital or pre-migration purchases
                withdrawal_consent_at:      meta.withdrawal_consent_at      ?? null,
                withdrawal_consent_version: meta.withdrawal_consent_version ?? null,
              }
            })
          )

          // Send receipt — one email per product (fire-and-forget)
          const buyerRes = await supabase.auth.admin.getUserById(meta.buyer_id)
          const buyerEmail = buyerRes.data.user?.email
          const buyerName = buyerRes.data.user?.user_metadata?.full_name ?? 'Kunde'

          if (buyerEmail) {
            for (const pid of productIds) {
              const p = productMap.get(pid) as { title: string; creator: unknown } | undefined
              if (!p) continue
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const creatorName = (p.creator as any)?.display_name ?? 'Anbieter'
              sendPurchaseReceipt(buyerEmail, {
                buyerName,
                productTitle: p.title,
                amountPaid: totalPaid / productIds.length,
                creatorName,
                libraryUrl: `${APP_URL}/buyer/library`,
                withdrawalConsentAt: meta.withdrawal_consent_at ?? undefined,
              }).catch(console.error)
            }
          }
        }
      }

      if (session.mode === 'subscription' && meta.tier_id && meta.buyer_id && meta.creator_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as any

        await supabase.from('subscriptions').insert({
          buyer_id: meta.buyer_id,
          creator_id: meta.creator_id,
          tier_id: meta.tier_id,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })

        // New subscriber notification to creator
        await notifyNewSubscriber(supabase, meta.buyer_id, meta.creator_id, meta.tier_id)
      }
      break
    }

    case 'customer.subscription.updated': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subscription = event.data.object as any

      await supabase
        .from('subscriptions')
        .update({
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      await supabase
        .from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', subscription.id)
      break
    }
  }

  return NextResponse.json({ received: true })
}

// Shared helper — used by both the Stripe webhook and the free-tier route
export async function notifyNewSubscriber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  buyerId: string,
  creatorId: string,
  tierId: string,
) {
  try {
    const [creatorRes, buyerRes, tierRes] = await Promise.all([
      supabase
        .from('creator_profiles')
        .select('user_id, display_name')
        .eq('id', creatorId)
        .single(),
      supabase.auth.admin.getUserById(buyerId),
      supabase
        .from('subscription_tiers')
        .select('name, price_monthly')
        .eq('id', tierId)
        .single(),
    ])

    const creatorUserId = creatorRes.data?.user_id
    if (!creatorUserId) return

    const creatorEmailRes = await supabase.auth.admin.getUserById(creatorUserId)
    const creatorEmail = creatorEmailRes.data?.user?.email
    if (!creatorEmail) return

    const creatorName = creatorRes.data.display_name ?? 'Creator'
    const subscriberName = buyerRes.data.user?.user_metadata?.full_name ?? 'Jemand'
    const tier = tierRes.data

    if (tier) {
      await Promise.allSettled([
        sendNewSubscriberNotification(creatorEmail, {
          creatorName,
          subscriberName,
          tierName: tier.name,
          priceMonthly: tier.price_monthly,
          dashboardUrl: `${APP_URL}/creator`,
        }),
        createNotification({
          userId: creatorUserId,
          type: 'new_subscriber',
          title: 'Neuer Abonnent',
          message: `${subscriberName} hat „${tier.name}" abonniert.`,
          link: '/creator',
        }),
      ])
    }
  } catch (err) {
    console.error('[notifyNewSubscriber]', err)
  }
}
