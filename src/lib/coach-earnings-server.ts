import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { configuredStripeLivemode } from '@/lib/stripe/connect-readiness'
import { historicalGross, summarizeEarnings, type EarningsRow } from '@/lib/coach-earnings'

export type EarningsReport = Awaited<ReturnType<typeof loadCoachEarnings>>
// The ledger is intentionally inaccessible to browser roles. Authenticate and
// derive ownership before privileged reads; no browser-provided coach is used.
export async function loadCoachEarnings(client: SupabaseClient, userId: string, now: number = Date.now()) {
  const { data: creator, error } = await client.from('creator_profiles').select('id').eq('user_id', userId).maybeSingle()
  if (error || !creator) throw new Error('Earnings owner unavailable')
  const service = await createServiceClient(), livemode = configuredStripeLivemode()
  const rows: EarningsRow[] = []
  // Never use the payout page's 50-row preview as an all-time total.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from('payment_settlements')
      .select('id,kind,gross_cents,platform_fee_cents,coach_net_cents,amount_refunded_cents,refund_requested_cents,amount_reversed_cents,transfer_amount_cents,stripe_transfer_id,stripe_payment_intent_id,state,fulfillment_state,created_at')
      .eq('creator_id', creator.id).eq('stripe_livemode', livemode).order('id').range(offset, offset + 499)
    if (error || !data || offset >= 50_000) throw new Error('Earnings ledger unavailable')
    rows.push(...data as EarningsRow[])
    if (data.length < 500) break
  }
  const covered = new Set(rows.map(row => row.stripe_payment_intent_id))
  const legacy = { products: 0, bookings: 0, subscriptions: 0, knownProductGross: 0, knownBookingGross: 0, unclear: 0 }
  // Detect incomplete historical coverage, without inventing past subscription
  // cycles, historical fees, transfer amounts or billing mode from mutable tiers.
  for (const source of ['purchases', 'bookings', 'subscriptions'] as const) {
    for (let offset = 0; ; offset += 500) {
      const fields: string = source === 'purchases' ? 'stripe_payment_intent_id,amount_paid,amount_refunded,payment_status,products!inner(creator_id)'
        : source === 'bookings' ? 'stripe_payment_intent_id,amount_paid_cents,amount_refunded_cents,payment_status' : 'stripe_subscription_id,stripe_livemode'
      let query = service.from(source).select(fields).eq(source === 'purchases' ? 'products.creator_id' : 'creator_id', creator.id)
      query = source === 'subscriptions' ? query.not('stripe_subscription_id', 'is', null)
        : query.eq('stripe_livemode', livemode).gt(source === 'purchases' ? 'amount_paid' : 'amount_paid_cents', 0)
      query = query.order('id').range(offset, offset + 499)
      const { data, error } = await query
      if (error || !data || offset >= 50_000) throw new Error('Earnings history unavailable')
      for (const record of data as unknown as { stripe_payment_intent_id?: string | null; stripe_subscription_id?: string; stripe_livemode?: boolean | null; amount_paid?: number; amount_refunded?: number; amount_paid_cents?: number; amount_refunded_cents?: number; payment_status?: string }[]) {
        if (source === 'subscriptions') {
          if (record.stripe_livemode === null || record.stripe_livemode === livemode) {
            // Recurring SCT cycles are ledger rows; old subscriptions have no
            // invoice ledger. Check the private order binding, not tier prices.
            const { count, error } = await service.from('payment_orders').select('id', { count: 'exact', head: true }).eq('creator_id', creator.id).eq('stripe_livemode', livemode).eq('kind', 'subscription').eq('stripe_subscription_id', record.stripe_subscription_id!)
            if (error) throw new Error('Subscription coverage unavailable')
            if (!count) legacy.subscriptions++
          }
        } else if (!record.stripe_payment_intent_id || !covered.has(record.stripe_payment_intent_id)) {
          const gross = historicalGross({ payment_status: record.payment_status!, paid: source === 'purchases' ? Math.round(Number(record.amount_paid) * 100) : record.amount_paid_cents!, refunded: source === 'purchases' ? Math.round(Number(record.amount_refunded) * 100) : record.amount_refunded_cents! })
          if (source === 'purchases') { legacy.products++; legacy.knownProductGross += gross ?? 0 } else { legacy.bookings++; legacy.knownBookingGross += gross ?? 0 }
          if (gross === null) legacy.unclear++
        }
      }
      if (data.length < 500) break
    }
  }
  return { ...summarizeEarnings(rows, now), testMode: !livemode, legacy }
}
