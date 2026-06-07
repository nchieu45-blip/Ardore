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

      if (session.mode === 'payment' && meta.product_id && meta.buyer_id) {
        await supabase.from('purchases').insert({
          buyer_id: meta.buyer_id,
          product_id: meta.product_id,
          amount_paid: (session.amount_total ?? 0) / 100,
          stripe_payment_intent_id: session.payment_intent as string ?? null,
        })

        // Purchase receipt
        const [buyerRes, productRes] = await Promise.all([
          supabase.auth.admin.getUserById(meta.buyer_id),
          supabase
            .from('products')
            .select('title, creator:creator_profiles(display_name)')
            .eq('id', meta.product_id)
            .single(),
        ])

        const buyerEmail = buyerRes.data.user?.email
        const buyerName = buyerRes.data.user?.user_metadata?.full_name ?? 'Kunde'
        const product = productRes.data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const creatorName = (product?.creator as any)?.display_name ?? 'Anbieter'

        if (buyerEmail && product) {
          await sendPurchaseReceipt(buyerEmail, {
            buyerName,
            productTitle: product.title,
            amountPaid: (session.amount_total ?? 0) / 100,
            creatorName,
            libraryUrl: `${APP_URL}/buyer/library`,
          }).catch(console.error)
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
