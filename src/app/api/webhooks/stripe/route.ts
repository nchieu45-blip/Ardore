import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPurchaseReceipt, sendNewSubscriberNotification } from '@/lib/email/send'
import { createNotification } from '@/lib/notifications'
import { reconcileCoachingRefund } from '@/lib/coaching-refund'
import { reconcileCoachingPaymentReconciliation } from '@/lib/coaching-payment-reconciliation'
import { reconcileCoachingCheckout, reconcileCoachingPaymentIntent } from '@/lib/coaching-payment-lifecycle'
import { isRetiredStripeTestEvent, reconcileSettlementCheckout, reconcileSettlementInvoice, reconcileSettlementProviderEvent } from '@/lib/stripe/settlement'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com'

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

  const leaseToken = randomUUID()
  const { data: claim, error: claimError } = await supabase.rpc('claim_stripe_webhook_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_livemode: event.livemode,
    p_lease_token: leaseToken,
  })
  if (claimError) return NextResponse.json({ error: 'Webhook could not be recorded' }, { status: 500 })
  if (claim?.processed) return NextResponse.json({ received: true, duplicate: true })
  if (!claim?.claimed) return NextResponse.json({ error: 'Webhook is already processing' }, { status: 503 })

  try {
    // Provider events are notifications. The settlement ledger retrieves the
    // current payment/transfer/refund before any historical snapshot handler.
    if (await isRetiredStripeTestEvent({ service: supabase, event })) {
      const { error } = await supabase.rpc('complete_stripe_webhook_event', { p_event_id: event.id, p_lease_token: leaseToken })
      if (error) throw new Error('Retired test event could not be recorded')
      return NextResponse.json({ received: true, retiredTest: true })
    }
    const settlementProviderResult = [
      'charge.refunded', 'charge.updated', 'refund.created', 'refund.updated', 'refund.failed',
      'transfer.created', 'transfer.updated', 'transfer.reversed',
      'charge.dispute.created', 'charge.dispute.closed',
      'payment_intent.canceled', 'payment_intent.payment_failed', 'payment_intent.succeeded',
      'customer.subscription.updated', 'customer.subscription.deleted',
      'invoice.payment_failed',
    ].includes(event.type)
      ? await reconcileSettlementProviderEvent({ service: supabase, event })
      : { handled: false }
    await finishSettlementReconciliation(supabase, settlementProviderResult)

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata ?? {}

      if (session.mode === 'payment' && meta.checkout_type === 'coaching_session') {
        await reconcileCoachingCheckout({ service: supabase, sessionId: session.id,
          stripeLivemode: event.livemode, eventType: event.type })
        break
      }

      if (meta.ardore_order_id) {
        const result = await reconcileSettlementCheckout({ service: supabase, sessionId: session.id })
        if (!result.handled) throw new Error('owned_checkout_order_not_found')
        await finishSettlementReconciliation(supabase, result)
        break
      }

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
            for (const purchase of purchaseRows) {
              const p = productMap.get(purchase.product_id) as { title: string; creator: unknown } | undefined
              if (!p) continue
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const creatorName = (p.creator as any)?.display_name ?? 'Anbieter'
              sendPurchaseReceipt(buyerEmail, {
                buyerName,
                productTitle: p.title,
                amountPaid: purchase.amount_paid,
                creatorName,
                libraryUrl: `${APP_URL}/buyer/library`,
                withdrawalConsentAt: meta.withdrawal_consent_at ?? undefined,
              }).catch(console.error)
            }
          }
        }
      }

      if (session.mode === 'subscription' && meta.tier_id && meta.buyer_id && meta.creator_id) {
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id
        if (!subscriptionId) throw new Error('Missing Stripe subscription')
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const state = trustedSubscriptionState(subscription, event.livemode)

        // A coach may freely change or disable a commercial offer after a
        // checkout. Ownership still has to match before granting entitlement.
        const { data: tier, error: tierError } = await supabase.from('subscription_tiers')
          .select('id, creator_id').eq('id', meta.tier_id).single()
        if (tierError || !tier || tier.creator_id !== meta.creator_id) {
          throw tierError ?? new Error('Subscription checkout does not match its creator')
        }

        const { error: subscriptionError } = await supabase.from('subscriptions').upsert({
          buyer_id: meta.buyer_id,
          creator_id: meta.creator_id,
          tier_id: meta.tier_id,
          stripe_subscription_id: subscription.id,
          stripe_livemode: event.livemode,
          ...state,
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
        if (!settlementProviderResult.handled) {
          await updatePurchaseState(supabase, paymentIntentId, event.livemode, status, charge.amount_refunded / 100)
        }
        // Refund webhooks can arrive before the cancellation response or out
        // of order. The event is a notification, never permission to refund
        // again; reconcile the current provider state instead of its payload.
        await reconcileCoachingRefund({ service: supabase, paymentIntentId, stripeLivemode: event.livemode })
        await reconcileCoachingPaymentReconciliation({ service: supabase, paymentIntentId, stripeLivemode: event.livemode })
      }
      break
    }

    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const refund = event.data.object as Stripe.Refund
      let paymentIntentId = typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id ?? null
      if (!paymentIntentId) {
        const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id
        const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null
        paymentIntentId = typeof charge?.payment_intent === 'string'
          ? charge.payment_intent
          : charge?.payment_intent?.id ?? null
      }
      if (paymentIntentId) {
        await reconcileCoachingRefund({ service: supabase, paymentIntentId, stripeLivemode: event.livemode })
        await reconcileCoachingPaymentReconciliation({ service: supabase, paymentIntentId, stripeLivemode: event.livemode })
      }
      break
    }

    case 'charge.updated':
    case 'transfer.created':
    case 'application_fee.created': {
      // automatic_async can confirm a payment before its transfer/application
      // fee exists. These signed events resume only the durable cancellation
      // claim; the reconciler verifies current ownership and controls eligibility.
      let charge: Stripe.Charge | null = null
      if (event.type === 'charge.updated') {
        charge = event.data.object as Stripe.Charge
      } else {
        const sourceCharge = event.type === 'transfer.created'
          ? (event.data.object as Stripe.Transfer).source_transaction
          : (event.data.object as Stripe.ApplicationFee).originating_transaction
        const chargeId = typeof sourceCharge === 'string' ? sourceCharge : sourceCharge?.id
        if (chargeId) charge = await stripe.charges.retrieve(chargeId)
      }
      if (charge?.metadata?.checkout_type !== 'coaching_session') break
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null
      if (paymentIntentId) {
        await reconcileCoachingRefund({ service: supabase, paymentIntentId,
          stripeLivemode: event.livemode, resumeCapture: true })
        await reconcileCoachingPaymentReconciliation({ service: supabase, paymentIntentId,
          stripeLivemode: event.livemode, resumeCapture: true })
      }
      break
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute & { payment_intent?: string | Stripe.PaymentIntent | null }
      const paymentIntentId = typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null
      if (paymentIntentId && !settlementProviderResult.handled) await updatePurchaseState(supabase, paymentIntentId, event.livemode, 'disputed')
      if (paymentIntentId) await updateCoachingPaymentState(supabase, paymentIntentId, event.livemode, 'disputed')
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
          if (!charge) throw new Error('Missing disputed charge')
          const restoredStatus = charge?.refunded
            ? 'refunded'
            : charge && charge.amount_refunded > 0 ? 'partially_refunded' : 'paid'
          if (!settlementProviderResult.handled) {
            await updatePurchaseState(supabase, paymentIntentId, event.livemode, restoredStatus, charge ? charge.amount_refunded / 100 : undefined)
          }
          if (restoredStatus === 'refunded' || restoredStatus === 'partially_refunded') {
            await reconcileCoachingRefund({ service: supabase, paymentIntentId, stripeLivemode: event.livemode })
          } else {
            await updateCoachingPaymentState(supabase, paymentIntentId, event.livemode, restoredStatus)
          }
        } else {
          if (!settlementProviderResult.handled) await updatePurchaseState(supabase, paymentIntentId, event.livemode, 'chargeback')
          await updateCoachingPaymentState(supabase, paymentIntentId, event.livemode, 'chargeback')
        }
      }
      break
    }

    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (!settlementProviderResult.handled) await updatePurchaseState(supabase, paymentIntent.id, event.livemode, 'reversed')
      if (paymentIntent.metadata?.checkout_type === 'coaching_session') {
        await reconcileCoachingPaymentIntent({ service: supabase, paymentIntentId: paymentIntent.id,
          stripeLivemode: event.livemode, eventType: event.type })
      } else {
        await updateCoachingPaymentState(supabase, paymentIntent.id, event.livemode, 'reversed')
      }
      break
    }

    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.metadata?.checkout_type === 'coaching_session') {
        await reconcileCoachingCheckout({ service: supabase, sessionId: session.id,
          stripeLivemode: event.livemode, eventType: event.type })
      } else if (session.metadata?.ardore_order_id) {
        const result = await reconcileSettlementCheckout({ service: supabase, sessionId: session.id })
        if (!result.handled) throw new Error('owned_checkout_order_not_found')
        await finishSettlementReconciliation(supabase, result)
      }
      break
    }

    case 'payment_intent.payment_failed':
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.checkout_type === 'coaching_session') {
        await reconcileCoachingPaymentIntent({ service: supabase, paymentIntentId: paymentIntent.id,
          stripeLivemode: event.livemode, eventType: event.type })
      }
      break
    }

    case 'invoice.payment_succeeded':
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const result = await reconcileSettlementInvoice({ service: supabase, invoiceId: invoice.id })
      await finishSettlementReconciliation(supabase, result)
      break
    }

    case 'transfer.updated':
    case 'transfer.reversed': {
      // The owned settlement ledger above applies current provider amounts.
      break
    }

    case 'invoice.payment_failed': {
      // Current subscription status is reconciled above without granting an
      // unpaid invoice a new entitlement period or coach transfer.
      break
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (settlementProviderResult.handled) break
      const object = event.data.object as Stripe.Subscription
      const subscription = await stripe.subscriptions.retrieve(object.id)
      const state = trustedSubscriptionState(subscription, event.livemode)

      const { error } = await supabase
        .from('subscriptions')
        .update({
          ...state,
          stripe_livemode: event.livemode,
        })
        .eq('stripe_subscription_id', subscription.id)
      if (error) throw error
      break
    }

    }
    const { data: completed, error: completeError } = await supabase.rpc('complete_stripe_webhook_event', {
      p_event_id: event.id, p_lease_token: leaseToken,
    })
    if (completeError || !completed) throw completeError ?? new Error('webhook_lease_lost')
  } catch (error) {
    // Permit Stripe to retry after a processing failure. No browser role can
    // access this service-only idempotency ledger.
    await supabase.rpc('release_stripe_webhook_event', { p_event_id: event.id, p_lease_token: leaseToken })
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
    console.error('[stripe-webhook] processing failed', typeof code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : 'webhook_processing_failed')
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

type SettlementFulfillment = {
  handled: boolean
  newlyFulfilled?: boolean
  kind?: string
  buyerId?: string
  creatorId?: string
  tierId?: string
  notifySubscriber?: boolean
  subscriptionMonthlyCents?: number
  retryNeeded?: boolean
  items?: { productId: string; amountCents: number }[]
  withdrawalConsentAt?: string | null
}

async function finishSettlementReconciliation(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  result: SettlementFulfillment,
) {
  await notifySettlementFulfillment(supabase, result)
  if (result.retryNeeded) throw new Error('settlement_transfer_retry_required')
}

async function notifySettlementFulfillment(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  result: SettlementFulfillment,
) {
  if (!result.handled || !result.newlyFulfilled || !result.buyerId) return
  if (result.kind === 'subscription' && result.notifySubscriber && result.creatorId && result.tierId) {
    await notifyNewSubscriber(supabase, result.buyerId, result.creatorId, result.tierId, result.subscriptionMonthlyCents)
    return
  }
  if (result.kind !== 'products' || !result.items?.length) return
  const [buyerRes, productsRes] = await Promise.all([
    supabase.auth.admin.getUserById(result.buyerId),
    supabase.from('products').select('id, title, creator:creator_profiles(display_name)')
      .in('id', result.items.map(item => item.productId)),
  ])
  if (buyerRes.error || productsRes.error) return
  const buyerEmail = buyerRes.data.user?.email
  if (!buyerEmail) return
  const buyerName = buyerRes.data.user?.user_metadata?.full_name ?? 'Kunde'
  const products = new Map((productsRes.data ?? []).map(product => [product.id, product]))
  // The ledger's frozen allocation is the receipt amount. Later coach price
  // edits affect only future checkouts.
  await Promise.allSettled(result.items.map(item => {
    const product = products.get(item.productId)
    if (!product) return Promise.resolve()
    const creator = Array.isArray(product.creator) ? product.creator[0] : product.creator
    return sendPurchaseReceipt(buyerEmail, {
      buyerName, productTitle: product.title, amountPaid: item.amountCents / 100,
      creatorName: creator?.display_name ?? 'Anbieter', libraryUrl: `${APP_URL}/buyer/library`,
      withdrawalConsentAt: result.withdrawalConsentAt ?? undefined,
    })
  }))
}

function trustedSubscriptionState(subscription: Stripe.Subscription, stripeLivemode: boolean) {
  if (subscription.livemode !== stripeLivemode) throw new Error('Subscription mode mismatch')

  // Current Stripe versions place billing periods on subscription items;
  // retain support for historical event payloads with a subscription period.
  const itemPeriods = subscription.items?.data.map(item => item.current_period_end)
    .filter(period => Number.isFinite(period) && period > 0) ?? []
  const legacyPeriod = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end
  const periodEnd = itemPeriods.length > 0 ? Math.min(...itemPeriods) : legacyPeriod
  if (!periodEnd || !Number.isFinite(periodEnd)) throw new Error('Missing subscription billing period')

  // The database's lifecycle deliberately has four states. All other Stripe
  // states must deny active access, including paused, unpaid and incomplete.
  const status = subscription.status === 'incomplete_expired' ? 'canceled'
    : ['active', 'trialing', 'past_due', 'canceled'].includes(subscription.status) ? subscription.status
    : 'past_due'
  return { status, current_period_end: new Date(periodEnd * 1000).toISOString() }
}

async function updateCoachingPaymentState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  paymentIntentId: string,
  stripeLivemode: boolean,
  paymentStatus: 'paid' | 'disputed' | 'chargeback' | 'reversed',
) {
  const { data: bookings, error: readError } = await supabase.from('bookings')
    .select('id, status, payment_status, refund_status')
    .eq('stripe_payment_intent_id', paymentIntentId).eq('stripe_livemode', stripeLivemode)
  if (readError) throw readError

  for (const booking of bookings ?? []) {
    // A canceled intent cannot undo a successful payment. Similarly a late
    // dispute-restoration event cannot restore entitlement over a refund.
    if (paymentStatus === 'reversed' && !['pending', 'failed', 'expired'].includes(booking.payment_status)) continue
    if (paymentStatus === 'paid' && (booking.payment_status !== 'disputed'
      || booking.refund_status !== 'not_requested'
      || ['cancelled', 'refunded', 'reversed'].includes(booking.status))) continue
    if (paymentStatus === 'disputed' && !['paid', 'partially_refunded', 'disputed'].includes(booking.payment_status)) continue
    if (paymentStatus === 'chargeback' && !['paid', 'partially_refunded', 'disputed', 'chargeback'].includes(booking.payment_status)) continue

    const update: Record<string, unknown> = { payment_status: paymentStatus, payment_updated_at: new Date().toISOString() }
    if ((paymentStatus === 'chargeback' || paymentStatus === 'reversed') && booking.status !== 'cancelled') {
      update.status = 'reversed'
    }
    // Compare the state read above so concurrent cancellation/refund commits
    // cannot be overwritten by this webhook's earlier view of the booking.
    const { error } = await supabase.from('bookings').update(update)
      .eq('id', booking.id).eq('payment_status', booking.payment_status)
      .eq('refund_status', booking.refund_status).eq('status', booking.status)
    if (error) throw error
  }
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
  agreedMonthlyCents?: number,
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
          priceMonthly: agreedMonthlyCents !== undefined && Number.isSafeInteger(agreedMonthlyCents) && agreedMonthlyCents >= 0
            ? agreedMonthlyCents / 100 : tier.price_monthly,
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
