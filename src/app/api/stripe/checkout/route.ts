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

  // Apply discount if provided
  let discountSavingsCents = 0
  let discountRowId: string | null = null

  if (discountId) {
    const { data: disc } = await supabase
      .from('discounts')
      .select('id, creator_id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to, target_product_id, target_tier_id')
      .eq('id', discountId)
      .single()

    const now = new Date()
    // When targeting a specific product, it must be the only item in the cart
    const targetProductOk = !disc?.target_product_id ||
      (productIds.length === 1 && productIds[0] === disc.target_product_id)
    const valid = disc &&
      disc.active &&
      creatorIds.length === 1 && disc.creator_id === creatorIds[0] &&
      (disc.target_product_id ? targetProductOk : (disc.applies_to === 'all' || disc.applies_to === 'products')) &&
      !disc.target_tier_id &&
      (!disc.starts_at || new Date(disc.starts_at) <= now) &&
      (!disc.ends_at   || new Date(disc.ends_at)   >= now) &&
      (disc.max_redemptions === null || disc.redemption_count < disc.max_redemptions)

    if (valid) {
      discountRowId = disc.id
      discountSavingsCents = disc.type === 'percent'
        ? Math.round(totalCents * disc.value / 100)
        : Math.min(disc.value, totalCents)
    }
  }

  // Distribute discount proportionally across line items
  // TODO: When Stripe Connect is active, replace this with a Stripe Coupon object
  // and attach it to the checkout session via `discounts: [{ coupon: couponId }]`
  // so the discount appears natively in the Stripe UI and is recorded properly.
  const finalLineItems = discountSavingsCents > 0
    ? lineItems.map(li => ({
        ...li,
        price_data: {
          ...li.price_data,
          unit_amount: Math.max(50, li.price_data.unit_amount - Math.round(discountSavingsCents * li.price_data.unit_amount / totalCents)),
        },
      }))
    : lineItems
  const finalTotalCents = finalLineItems.reduce((sum, item) => sum + item.price_data.unit_amount, 0)
  const service = await createServiceClient()
  let accountId: string | null = null
  let livemode = configuredStripeLivemode()
  if (finalTotalCents > 0) {
    try {
      const readiness = await requirePayoutReadyCoach(service, creatorIds[0])
      accountId = readiness.accountId
      livemode = readiness.livemode
    } catch (error) {
      if (error instanceof ConnectReadinessError) return NextResponse.json({ error: error.message }, { status: error.status })
      return NextResponse.json({ error: 'Der Auszahlungsstatus konnte nicht geprüft werden.' }, { status: 503 })
    }
  }
  const order = await createSettlementOrder({
    service,
    kind: 'products',
    buyerId: user.id,
    creatorId: creatorIds[0],
    accountId,
    grossCents: finalTotalCents,
    livemode,
    reference: {
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
    success_url: `${appUrl}/buyer/library?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/buyer/library?checkout=cancel`,
    ...(finalTotalCents > 0 ? { payment_intent_data: {
      metadata,
      transfer_group: `ardore-order-${order.id}`,
    } } : {}),
  }, { idempotencyKey: `ardore-order-checkout-${order.id}-v1` })
  await registerSettlementCheckout({ service, orderId: order.id, sessionId: session.id })

  // Increment redemption count (best-effort; TODO: move to webhook handler
  // checkout.session.completed for guaranteed once-per-payment increment)
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
        .eq('redemption_count', latest.redemption_count) // optimistic lock
    }
  }

  return NextResponse.json({ url: session.url })
}
