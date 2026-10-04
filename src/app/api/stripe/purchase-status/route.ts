import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { configuredStripeLivemode } from '@/lib/stripe/connect-readiness'
import { confirmedProductIds, VALID_PURCHASE_STATUS, type PurchaseStatus } from '@/lib/purchases'

export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers })
    const sessionId = req.nextUrl.searchParams.get('session_id')
    if (!sessionId || !/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return NextResponse.json({ error: 'Ungültiger Checkout' }, { status: 400, headers })
    const service = await createServiceClient()
    // Never retrieve Stripe objects or disclose a ledger before proving ownership.
    const { data: order, error } = await service.from('payment_orders')
      .select('id,state,gross_cents,stripe_livemode,reference')
      .eq('buyer_id', user.id).eq('kind', 'products').eq('stripe_checkout_session_id', sessionId).maybeSingle()
    if (error) throw error
    if (!order) return NextResponse.json({ error: 'Kauf nicht gefunden' }, { status: 404, headers })
    const expected = Array.isArray(order.reference?.items)
      ? order.reference.items.map((item: { productId: string }) => item.productId) : []
    if (!expected.length || expected.some((id: unknown) => typeof id !== 'string')) throw new Error('Invalid item snapshot')
    const result: PurchaseStatus = { state: 'processing', productIds: [], testMode: !order.stripe_livemode }
    if (order.state === 'refunded') result.state = 'refunded'
    else if (order.state === 'refund_required') result.state = order.gross_cents === 0 ? 'unavailable' : 'refund_pending'
    else if (order.state === 'fulfilled') {
      const { data: purchases, error: purchaseError } = await client.from('purchases').select('product_id')
        .eq('buyer_id', user.id).eq('stripe_checkout_session_id', sessionId)
        .eq('stripe_livemode', order.stripe_livemode).eq('payment_status', VALID_PURCHASE_STATUS).in('product_id', expected)
      if (purchaseError) throw purchaseError
      result.productIds = confirmedProductIds(expected, purchases ?? [])
      // Fulfilled order alone is insufficient after entitlement revocation/refund.
      result.state = result.productIds.length ? 'completed' : 'unavailable'
    } else {
      if (order.stripe_livemode !== configuredStripeLivemode()) throw new Error('Unavailable Stripe mode')
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      if (session.id !== sessionId || session.metadata?.ardore_order_id !== order.id
        || session.metadata?.buyer_id !== user.id || session.livemode !== order.stripe_livemode
        || session.mode !== 'payment' || session.amount_total !== order.gross_cents || session.currency !== 'eur') throw new Error('Invalid checkout identity')
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') result.state = 'processing'
      else if (session.status === 'expired') result.state = 'canceled'
      else {
        // A completed Checkout can still have a pending or failed asynchronous
        // payment. Its verified intent determines those terminal states.
        result.state = session.status === 'complete' ? 'processing' : 'awaiting_payment'
        const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        if (paymentId) {
          const intent = await stripe.paymentIntents.retrieve(paymentId)
          if (intent.livemode !== order.stripe_livemode || intent.metadata.ardore_order_id !== order.id
            || intent.metadata.buyer_id !== user.id || intent.amount !== order.gross_cents || intent.currency !== 'eur') throw new Error('Invalid payment identity')
          if (intent.status === 'succeeded' || intent.status === 'processing') result.state = 'processing'
          else if (intent.status === 'canceled') result.state = 'canceled'
          else if (intent.status === 'requires_payment_method' && intent.last_payment_error) result.state = 'payment_failed'
        }
      }
    }
    return NextResponse.json(result, { headers })
  } catch {
    return NextResponse.json({ error: 'Der Kaufstatus konnte momentan nicht geprüft werden.' }, { status: 503, headers })
  }
}
