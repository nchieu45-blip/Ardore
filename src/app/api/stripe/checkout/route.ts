import { randomUUID } from 'node:crypto'
import { DiscountError, reserveDiscount, releaseDiscount, allocateDiscount, requireStripeMinimum } from '@/lib/discounts'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { ConnectReadinessError, requirePublishedCoach, configuredStripeLivemode, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'
import { createSettlementOrder, registerSettlementCheckout } from '@/lib/stripe/settlement'
import { PERMANENT_DIGITAL_TYPES, VALID_PURCHASE_STATUS } from '@/lib/purchases'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültiger Warenkorb' }, { status: 400 })

  // Support both legacy { productId } and new { items: [{ productId }], discountId? }
  const rawItems: { productId: string }[] = body.items
    ?? (body.productId ? [{ productId: body.productId }] : [])
  const discountId: string | null = body.discountId ?? null
  const withdrawalConsent: boolean = body.withdrawalConsent === true

  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50
    || rawItems.some(item => !item || typeof item.productId !== 'string')) {
    return NextResponse.json({ error: 'Keine Produkte' }, { status: 400 })
  }

  const productIds = [...new Set(rawItems.map(i => i.productId))]

  const { data: products } = await supabase
    .from('products')
    .select('id, title, price, type, creator_id, creator:creator_profiles(stripe_account_id, stripe_account_active, is_demo)')
    .in('id', productIds)
    .eq('is_published', true)

  // Every entitlement in checkout metadata must correspond to a billed,
  // published product. RLS can otherwise silently omit inaccessible IDs.
  if (!products || products.length !== productIds.length || productIds.some(id => !products.some(p => p.id === id))) {
    return NextResponse.json({ error: 'Produkte nicht gefunden' }, { status: 404 })
  }

  const permanentIds = products.filter(product => (PERMANENT_DIGITAL_TYPES as readonly string[]).includes(product.type)).map(product => product.id)
  if (permanentIds.length) {
    const { data: owned, error } = await supabase.from('purchases').select('product_id')
      .eq('buyer_id', user.id).eq('payment_status', VALID_PURCHASE_STATUS)
      .in('product_id', permanentIds)
      .in('stripe_livemode', configuredStripeLivemode() ? [true] : [true, false])
    if (error) return NextResponse.json({ error: 'Deine Käufe konnten nicht geprüft werden. Bitte versuche es erneut.' }, { status: 503 })
    if (owned?.length) return NextResponse.json({ error: 'Dieses digitale Produkt ist bereits in deiner Bibliothek.',
      ownedProductIds: owned.map(row => row.product_id) }, { status: 409 })
  }

  try {
    const visibilityService = await createServiceClient()
    for (const id of new Set(products.map(product => product.creator_id))) await requirePublishedCoach(visibilityService, id)
  } catch (error) {
    if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Coach-Profil momentan nicht verfügbar.' }, { status: 503 })
  }

  const hasDemo = products.some(p => {
    const cr = Array.isArray(p.creator) ? (p.creator as { is_demo: boolean | null }[])[0] : p.creator as { is_demo: boolean | null } | null
    return cr?.is_demo === true
  })
  if (hasDemo) {
    return NextResponse.json({ error: 'Demo-Produkte können nicht gekauft werden.' }, { status: 403 })
  }

  const DIGITAL_TYPES = new Set(['pdf', 'video', 'course', 'image'])
  type ProductWithType = { type: string }
  const hasDigital = (products as ProductWithType[]).some(p => DIGITAL_TYPES.has(p.type))

  if (hasDigital && !withdrawalConsent) {
    return NextResponse.json(
      { error: 'Zustimmung zum sofortigen Beginn der Leistung und Widerrufsverzicht fehlt.' },
      { status: 400 }
    )
  }

  const consentTimestamp = hasDigital ? new Date().toISOString() : null

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  type FoundProduct = { id: string; title: string; price: number; creator_id: string; creator: unknown }

  // Build Stripe line items in the same order as the cart
  const lineItems = (productIds
    .map(id => (products as FoundProduct[]).find(p => p.id === id))
    .filter((p): p is FoundProduct => !!p))
    .map(p => ({
      price_data: {
        currency: 'eur',
        product_data: { name: p.title },
        unit_amount: Math.round(p.price * 100),
      },
      quantity: 1 as const,
    }))

  // Each order settles to one coach. Mixed carts must never collect money
  // without a deterministic allocation to each coach.
  type ProductRow = {
    id: string
    creator_id: string
    creator: { stripe_account_id: string | null; stripe_account_active: boolean | null; is_demo: boolean | null } | null
      | { stripe_account_id: string | null; stripe_account_active: boolean | null; is_demo: boolean | null }[]
  }

  const creatorIds = [...new Set((products as ProductRow[]).map(p => p.creator_id))]
  if (creatorIds.length !== 1) {
    return NextResponse.json({ error: 'Bitte kaufe Angebote verschiedener Coaches einzeln.' }, { status: 409 })
  }

  const totalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0)

  const service = await createServiceClient()
  const orderId = randomUUID()
  let reservation
  let finalLineItems = lineItems
  let finalTotalCents = totalCents
  try {
    if (discountId) {
      reservation = await reserveDiscount(service, { id: orderId, discountId, buyerId: user.id,
        creatorId: creatorIds[0], kind: 'products', originalCents: totalCents, productIds })
      const amounts = allocateDiscount(lineItems.map(item => item.price_data.unit_amount), reservation.savings_cents)
      finalLineItems = lineItems.map((item, index) => ({ ...item, price_data: { ...item.price_data, unit_amount: amounts[index] } }))
      finalTotalCents = reservation.final_cents
    }
    requireStripeMinimum(finalTotalCents)
  } catch (error) {
    if (reservation) await releaseDiscount(service, reservation.id)
    if (error instanceof DiscountError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Rabatt konnte nicht geprüft werden.' }, { status: 503 })
  }
  let accountId: string | null = null
  let livemode = configuredStripeLivemode()
  if (finalTotalCents > 0) {
    try {
      const readiness = await requirePayoutReadyCoach(service, creatorIds[0])
      accountId = readiness.accountId
      livemode = readiness.livemode
    } catch (error) {
      if (reservation) await releaseDiscount(service, reservation.id)
      if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
      return NextResponse.json({ error: 'Der Auszahlungsstatus konnte nicht geprüft werden.' }, { status: 503 })
    }
  }
  const order = await createSettlementOrder({
    service,
    id: orderId,
    kind: 'products',
    buyerId: user.id,
    creatorId: creatorIds[0],
    accountId,
    grossCents: finalTotalCents,
    livemode,
    reference: {
      ...(reservation ? { discountRedemptionId: reservation.id } : {}),
      items: productIds.map((productId, index) => ({
        productId, amountCents: finalLineItems[index].price_data.unit_amount,
      })),
      withdrawalConsentAt: consentTimestamp,
      withdrawalConsentVersion: consentTimestamp ? 'widerruf-v1' : null,
    },
  })
  const metadata = {
    ardore_order_id: order.id,
    buyer_id: user.id,
    creator_id: creatorIds[0],
    product_ids: productIds.join(','),
    ...(productIds.length === 1 ? { product_id: productIds[0] } : {}),
    ...(consentTimestamp ? {
      withdrawal_consent_at: consentTimestamp,
      withdrawal_consent_version: 'widerruf-v1',
    } : {}),
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    locale: 'de',
    customer_email: user.email,
    line_items: finalLineItems,
    metadata,
    ...(reservation ? { expires_at: Math.floor(new Date(reservation.expires_at).getTime() / 1000) } : {}),
    success_url: `${appUrl}/buyer/library?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/buyer/library?checkout=cancel`,
    ...(finalTotalCents > 0 ? { payment_intent_data: {
      metadata,
      transfer_group: `ardore-order-${order.id}`,
    } } : {}),
  }, { idempotencyKey: `ardore-order-checkout-${order.id}-v1` })
  await registerSettlementCheckout({ service, orderId: order.id, sessionId: session.id })

  return NextResponse.json({ url: session.url })
}
