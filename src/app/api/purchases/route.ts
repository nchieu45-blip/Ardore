import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { configuredStripeLivemode } from '@/lib/stripe/connect-readiness'
import { PERMANENT_DIGITAL_TYPES, VALID_PURCHASE_STATUS } from '@/lib/purchases'

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers })
    const { data, error } = await client.from('purchases').select('product_id,product:products!inner(type)')
      .eq('buyer_id', user.id).eq('payment_status', VALID_PURCHASE_STATUS)
      .in('stripe_livemode', configuredStripeLivemode() ? [true] : [true, false]).in('products.type', [...PERMANENT_DIGITAL_TYPES])
    if (error) throw error
    return NextResponse.json({ ownedProductIds: [...new Set((data ?? []).map(row => row.product_id))] }, { headers })
  } catch {
    return NextResponse.json({ error: 'Käufe konnten nicht geladen werden.' }, { status: 503, headers })
  }
}
