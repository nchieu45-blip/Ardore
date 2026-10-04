import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { DiscountError, savingsCents, requireStripeMinimum } from '@/lib/discounts'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const creatorId = params.get('creatorId'), kind = params.get('type'), code = params.get('code')?.trim().toUpperCase()
  const amount = Number(params.get('amount') ?? '0'), productId = params.get('productId'), tierId = params.get('tierId')
  if (!creatorId || !kind || !['products', 'subscriptions', 'sessions'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0) {
    return NextResponse.json({ valid: false, error: 'Ungültige Rabatt-Anfrage' }, { status: 400 })
  }
  try {
    const client = await createClient()
    let query = client.from('discounts').select('*').eq('creator_id', creatorId).eq('active', true)
    query = code ? query.eq('code', code) : query.is('code', null)
    const { data: rows, error } = await query.order('value', { ascending: false })
    if (error) throw error
    const now = new Date()
    const eligible = (rows ?? []).filter(d => {
      if ((d.starts_at && new Date(d.starts_at) > now) || (d.ends_at && new Date(d.ends_at) < now)) return false
      if (d.target_product_id) return kind === 'products' && d.target_product_id === productId && !d.target_tier_id
      if (d.target_tier_id) return kind === 'subscriptions' && d.target_tier_id === tierId
      return d.applies_to === 'all' || d.applies_to === kind
    })
    const { data: { user } } = await client.auth.getUser()
    const service = await createServiceClient()
    for (const d of eligible) {
      const { data: claims, error: claimError } = await service.from('discount_redemptions')
        .select('buyer_id,state,expires_at').eq('discount_id', d.id).in('state', ['held', 'consumed'])
      if (claimError) throw claimError
      const active = (claims ?? []).filter(r => r.state === 'consumed' || new Date(r.expires_at) > now)
      const held = active.filter(r => r.state === 'held').length
      if (d.max_redemptions !== null && d.redemption_count + held >= d.max_redemptions) continue
      if (user && d.max_redemptions_per_user !== null && active.filter(r => r.buyer_id === user.id).length >= d.max_redemptions_per_user) continue
      const savings = savingsCents(d.type, d.value, amount)
      let paymentError: string | undefined
      try { requireStripeMinimum(amount - savings) } catch (error) { if (error instanceof DiscountError) paymentError = error.message; else throw error }
      return NextResponse.json({ valid: true, discount: { id: d.id, code: d.code, type: d.type, value: d.value, applies_to: d.applies_to }, savingsCents: savings,
        paymentAllowed: !paymentError, error: paymentError },
        { headers: { 'Cache-Control': 'private, no-store' } })
    }
    return NextResponse.json({ valid: false, error: code ? 'Dieser Code ist für diesen Kauf nicht verfügbar oder bereits vollständig eingelöst.' : undefined },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ valid: false, error: error instanceof DiscountError ? error.message : 'Rabatt konnte momentan nicht geprüft werden.' },
      { status: error instanceof DiscountError ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
