import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const body = await req.json()

  // Support both legacy { productId } and new { items: [{ productId }], discountId? }
  const rawItems: { productId: string }[] = body.items
    ?? (body.productId ? [{ productId: body.productId }] : [])
  const discountId: string | null = body.discountId ?? null
  const withdrawalConsent: boolean = body.withdrawalConsent === true

  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'Keine Produkte' }, { status: 400 })
  }

  const productIds = rawItems.map(i => i.productId)

  const { data: products } = await supabase
    .from('products')
    .select('id, title, price, type, creator_id, creator:creator_profiles(stripe_account_id, stripe_account_active, is_demo)')
    .in('id', productIds)

  if (!products || products.length === 0) {
    return NextResponse.json({ error: 'Produkte nicht gefunden' }, { status: 404 })
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

  // Use Connect transfer only when every item is from the same creator with an active account
  type ProductRow = {
    id: string
    creator_id: string
    creator: { stripe_account_id: string | null; stripe_account_active: boolean | null; is_demo: boolean | null } | null
      | { stripe_account_id: string | null; stripe_account_active: boolean | null; is_demo: boolean | null }[]
  }

  const creatorIds = [...new Set((products as ProductRow[]).map(p => p.creator_id))]
  const singleCreator = creatorIds.length === 1

  const firstProduct = products[0] as ProductRow
  const creatorRaw = firstProduct.creator
  const creatorInfo = Array.isArray(creatorRaw) ? creatorRaw[0] : creatorRaw

  const useConnect =
    singleCreator &&
    !!creatorInfo?.stripe_account_id &&
    !!creatorInfo?.stripe_account_active

  const totalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0)

  // Apply discount if provided
  let discountSavingsCents = 0
  let discountRowId: string | null = null

  if (discountId) {
    const { data: disc } = await supabase
      .from('discounts')
      .select('id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to, target_product_id, target_tier_id')
      .eq('id', discountId)
      .single()

    const now = new Date()
    // When targeting a specific product, it must be the only item in the cart
    const targetProductOk = !disc?.target_product_id ||
      (productIds.length === 1 && productIds[0] === disc.target_product_id)
    const valid = disc &&
      disc.active &&
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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    locale: 'de',
    customer_email: user.email,
    line_items: finalLineItems,
    metadata: {
      buyer_id: user.id,
      product_ids: productIds.join(','),
      // Keep legacy field for single-product backward compat with webhook
      ...(productIds.length === 1 ? { product_id: productIds[0], creator_id: creatorIds[0] } : {}),
      // Withdrawal-right consent (§ 356 Abs. 5 BGB) — only set for digital content
      ...(consentTimestamp ? {
        withdrawal_consent_at:      consentTimestamp,
        withdrawal_consent_version: 'widerruf-v1',
      } : {}),
    },
    success_url: `${appUrl}/buyer/library?success=1`,
    cancel_url: `${appUrl}/marketplace`,
    ...(useConnect
      ? {
          payment_intent_data: {
            application_fee_amount: Math.round(totalCents * 0.05),
            transfer_data: { destination: creatorInfo!.stripe_account_id! },
          },
        }
      : {}),
  })

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
