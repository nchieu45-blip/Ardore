import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { productId } = await req.json()

  const { data: product } = await supabase
    .from('products')
    .select('*, creator:creator_profiles(stripe_account_id, stripe_account_active)')
    .eq('id', productId)
    .single()

  if (!product) {
    return NextResponse.json({ error: 'Produkt nicht gefunden' }, { status: 404 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    locale: 'de',
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: product.title },
          unit_amount: Math.round(product.price * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      product_id: productId,
      buyer_id: user.id,
      creator_id: product.creator_id,
    },
    success_url: `${appUrl}/buyer/library?success=1`,
    cancel_url: `${appUrl}/creators`,
    ...(product.creator?.stripe_account_id && product.creator?.stripe_account_active
      ? {
          payment_intent_data: {
            application_fee_amount: Math.round(product.price * 100 * 0.05),
            transfer_data: { destination: product.creator.stripe_account_id },
          },
        }
      : {}),
  })

  return NextResponse.json({ url: session.url })
}
