import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { productId, rating, content } = await req.json()

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Ungültige Bewertung' }, { status: 400 })
  }

  const { data: purchase } = await supabase
    .from('purchases')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('product_id', productId)
    .single()

  if (!purchase) {
    return NextResponse.json({ error: 'Produkt nicht gekauft' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      { product_id: productId, buyer_id: user.id, rating, content: content || null },
      { onConflict: 'product_id,buyer_id' }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Notify the creator (fire-and-forget)
  ;(async () => {
    const { data: product } = await supabase
      .from('products')
      .select('title, creator_profiles!inner(user_id)')
      .eq('id', productId)
      .single()
    if (!product) return
    const raw = (product as unknown as { title: string; creator_profiles: { user_id: string } | { user_id: string }[] }).creator_profiles
    const cp  = Array.isArray(raw) ? raw[0] : raw
    if (!cp?.user_id) return
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)
    await createNotification({
      userId: cp.user_id,
      type: 'new_review',
      title: 'Neue Bewertung',
      message: `${stars}  Jemand hat „${(product as unknown as { title: string }).title}" bewertet.`,
      link: '/creator',
    })
  })().catch(() => {})

  return NextResponse.json({ review: data })
}
