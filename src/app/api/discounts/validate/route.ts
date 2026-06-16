import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export function calcSavingsCents(type: string, value: number, amountCents: number): number {
  if (type === 'percent') return Math.round(amountCents * value / 100)
  return Math.min(value, amountCents)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const creatorId    = searchParams.get('creatorId')
  const purchaseType = searchParams.get('type') // 'products' | 'subscriptions' | 'sessions'
  const code         = searchParams.get('code')
  const amountCents  = parseInt(searchParams.get('amount') ?? '0', 10)
  const productId    = searchParams.get('productId') ?? null
  const tierId       = searchParams.get('tierId')    ?? null

  if (!creatorId || !purchaseType) {
    return NextResponse.json({ valid: false, error: 'Fehlende Parameter' }, { status: 400 })
  }

  const supabase = await createClient()
  const now = new Date()

  if (code) {
    const upper = code.toUpperCase().trim()
    const { data } = await supabase
      .from('discounts')
      .select('id, code, type, value, applies_to, starts_at, ends_at, max_redemptions, redemption_count, active, target_product_id, target_tier_id')
      .eq('creator_id', creatorId)
      .eq('active', true)
      .eq('code', upper)
      .maybeSingle()

    if (!data) {
      return NextResponse.json({ valid: false, error: 'Ungültiger Gutscheincode' })
    }
    if (data.starts_at && new Date(data.starts_at) > now) {
      return NextResponse.json({ valid: false, error: 'Dieser Code ist noch nicht gültig' })
    }
    if (data.ends_at && new Date(data.ends_at) < now) {
      return NextResponse.json({ valid: false, error: 'Dieser Code ist abgelaufen' })
    }
    if (data.max_redemptions !== null && data.redemption_count >= data.max_redemptions) {
      return NextResponse.json({ valid: false, error: 'Dieser Code wurde bereits zu oft eingelöst' })
    }

    // Target-specific check takes priority over applies_to
    if (data.target_product_id) {
      if (data.target_product_id !== productId) {
        return NextResponse.json({ valid: false, error: 'Dieser Code gilt nicht für dieses Produkt' })
      }
    } else if (data.target_tier_id) {
      if (data.target_tier_id !== tierId) {
        return NextResponse.json({ valid: false, error: 'Dieser Code gilt nicht für dieses Abo' })
      }
    } else if (data.applies_to !== 'all' && data.applies_to !== purchaseType) {
      return NextResponse.json({ valid: false, error: 'Dieser Code gilt nicht für diesen Kauf' })
    }

    const savingsCents = amountCents > 0 ? calcSavingsCents(data.type, data.value, amountCents) : 0
    return NextResponse.json({
      valid: true,
      discount: { id: data.id, code: data.code, type: data.type, value: data.value, applies_to: data.applies_to },
      savingsCents,
    })
  }

  // No code → check for automatic discounts (code IS NULL)
  const { data: rows } = await supabase
    .from('discounts')
    .select('id, code, type, value, applies_to, starts_at, ends_at, max_redemptions, redemption_count, target_product_id, target_tier_id')
    .eq('creator_id', creatorId)
    .eq('active', true)
    .is('code', null)
    .order('value', { ascending: false })

  const valid = (rows ?? []).find(d => {
    // Target-specific matching
    if (d.target_product_id) {
      if (d.target_product_id !== productId) return false
    } else if (d.target_tier_id) {
      if (d.target_tier_id !== tierId) return false
    } else if (d.applies_to !== 'all' && d.applies_to !== purchaseType) {
      return false
    }
    if (d.starts_at && new Date(d.starts_at) > now) return false
    if (d.ends_at   && new Date(d.ends_at)   < now) return false
    if (d.max_redemptions !== null && d.redemption_count >= d.max_redemptions) return false
    return true
  })

  if (!valid) return NextResponse.json({ valid: false })

  const savingsCents = amountCents > 0 ? calcSavingsCents(valid.type, valid.value, amountCents) : 0
  return NextResponse.json({
    valid: true,
    discount: { id: valid.id, code: null, type: valid.type, value: valid.value, applies_to: valid.applies_to },
    savingsCents,
  })
}
