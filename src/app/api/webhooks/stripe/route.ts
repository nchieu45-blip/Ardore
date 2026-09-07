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

  // The event's mode must match the configured Stripe secret. Persisting the
  // mode also prevents test purchases from becoming production entitlement.
  const configuredLiveMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true
  if (event.livemode !== configuredLiveMode) {
    return NextResponse.json({ error: 'Stripe mode mismatch' }, { status: 400 })
  }

  const { error: claimError } = await supabase.from('stripe_webhook_events').insert({
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
  })
  if (claimError?.code === '23505') return NextResponse.json({ received: true, duplicate: true })
  if (claimError) return NextResponse.json({ error: 'Webhook could not be recorded' }, { status: 500 })

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata ?? {}

      if (session.mode === 'payment' && session.payment_status === 'paid' && meta.buyer_id) {
        // Support both legacy single product_id and new comma-separated product_ids
        const productIds: string[] = meta.product_ids
          ? meta.product_ids.split(',').filter(Boolean)
          : meta.product_id ? [meta.product_id] : []

        if (productIds.length > 0) {
          const totalPaid = (session.amount_total ?? 0) / 100
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null

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

          if (productMap.size !== productIds.length || !paymentIntentId) {
            throw new Error('Paid checkout metadata does not match valid products')
          }

          const { data: existingPurchases, error: existingError } = await supabase
            .from('purchases')
            .select('product_id, stripe_payment_intent_id, payment_status')
            .eq('buyer_id', meta.buyer_id)
            .in('product_id', productIds)
          if (existingError) throw existingError

          const existingByProduct = new Map(
            (existingPurchases ?? []).map((purchase) => [purchase.product_id, purchase])
          )
          const payableProductIds = productIds.filter((productId) => {
            const existing = existingByProduct.get(productId)
            return !existing
              || existing.stripe_payment_intent_id !== paymentIntentId
              || existing.payment_status === 'paid'
          })

          const purchaseRows = payableProductIds.map(pid => {
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
                stripe_checkout_session_id: session.id,
                stripe_livemode: event.livemode,
                payment_status: 'paid',
                amount_refunded: 0,
                updated_at: new Date().toISOString(),
                // Withdrawal-right consent proof (§ 356 Abs. 5 BGB)
                // Columns added by migration 015; null for non-digital or pre-migration purchases
                withdrawal_consent_at:      meta.withdrawal_consent_at      ?? null,
                withdrawal_consent_version: meta.withdrawal_consent_version ?? null,
              }
            })
          if (purchaseRows.length > 0) {
            const { error: purchaseError } = await supabase
              .from('purchases')
              .upsert(purchaseRows, { onConflict: 'buyer_id,product_id' })
            if (purchaseError) throw purchaseError
          }

          // Send receipt — one email per product (fire-and-forget)
          const buyerRes = await supabase.auth.admin.getUserById(meta.buyer_id)
          const buyerEmail = buyerRes.data.user?.email
          const buyerName = buyerRes.data.user?.user_metadata?.full_name ?? 'Kunde'

          if (buyerEmail) {
            for (const pid of payableProductIds) {
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

        const { error: subscriptionError } = await supabase.from('subscriptions').upsert({
          buyer_id: meta.buyer_id,
          creator_id: meta.creator_id,
          tier_id: meta.tier_id,
          stripe_subscription_id: subscription.id,
          stripe_livemode: event.livemode,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        }, { onConflict: 'stripe_subscription_id' })
        if (subscriptionError) throw subscriptionError

        // New subscriber notification to creator
        await notifyNewSubscriber(supabase, meta.buyer_id, meta.creator_id, meta.tier_id)
      }
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null
      if (paymentIntentId) {
        const status = charge.refunded ? 'refunded' : 'partially_refunded'
        await updatePurchaseState(supabase, paymentIntentId, event.livemode, status, charge.amount_refunded / 100)
      }
      break
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute & { payment_intent?: string | Stripe.PaymentIntent | null }
      const paymentIntentId = typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null
      if (paymentIntentId) await updatePurchaseState(supabase, paymentIntentId, event.livemode, 'disputed')
      break
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute & { payment_intent?: string | Stripe.PaymentIntent | null }
      const paymentIntentId = typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null
      if (paymentIntentId) {
        if (dispute.status === 'won') {
          const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
          const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null
          const restoredStatus = charge?.refunded
            ? 'refunded'
            : charge && charge.amount_refunded > 0 ? 'partially_refunded' : 'paid'
          await updatePurchaseState(supabase, paymentIntentId, event.livemode, restoredStatus, charge ? charge.amount_refunded / 100 : undefined)
        } else {
          await updatePurchaseState(supabase, paymentIntentId, event.livemode, 'chargeback')
        }
      }
      break
    }

    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      await updatePurchaseState(supabase, paymentIntent.id, event.livemode, 'reversed')
      break
    }

    case 'customer.subscription.updated': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subscription = event.data.object as any

      await supabase
        .from('subscriptions')
        .update({
          status: subscription.status,
          stripe_livemode: event.livemode,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription

      await supabase
        .from('subscriptions')
        .update({ status: 'canceled', stripe_livemode: event.livemode })
        .eq('stripe_subscription_id', subscription.id)
      break
    }
    }
  } catch (error) {
    // Permit Stripe to retry after a processing failure. No browser role can
    // access this service-only idempotency ledger.
    await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id)
    console.error('[stripe-webhook] processing failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function updatePurchaseState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  paymentIntentId: string,
  stripeLivemode: boolean,
  paymentStatus: 'paid' | 'partially_refunded' | 'refunded' | 'disputed' | 'chargeback' | 'reversed',
  amountRefunded?: number,
) {
  const update = {
    payment_status: paymentStatus,
    updated_at: new Date().toISOString(),
  }

  if (amountRefunded === undefined) {
    const { error } = await supabase
      .from('purchases')
      .update(update)
      .eq('stripe_payment_intent_id', paymentIntentId)
      .eq('stripe_livemode', stripeLivemode)
    if (error) throw error
    return
  }

  const { data: purchases, error: readError } = await supabase
    .from('purchases')
    .select('id, amount_paid')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('stripe_livemode', stripeLivemode)
  if (readError) throw readError

  const totalPaid = (purchases ?? []).reduce(
    (sum: number, purchase: { amount_paid: number }) => sum + Number(purchase.amount_paid),
    0,
  )
  const results = await Promise.all((purchases ?? []).map((purchase: { id: string; amount_paid: number }) => {
    const paid = Number(purchase.amount_paid)
    const allocatedRefund = totalPaid > 0
      ? Math.min(paid, Math.round((amountRefunded * paid / totalPaid) * 100) / 100)
      : 0
    return supabase.from('purchases').update({ ...update, amount_refunded: allocatedRefund }).eq('id', purchase.id)
  }))
  const failed = results.find((result: { error: unknown }) => result.error)
  if (failed?.error) throw failed.error
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
