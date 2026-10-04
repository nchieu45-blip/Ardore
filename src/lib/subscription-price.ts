import type { SupabaseClient } from '@supabase/supabase-js'

type Subscription = { id: string; buyer_id: string; creator_id: string; tier_id: string | null;
  stripe_subscription_id: string | null; stripe_livemode: boolean | null; tier: { price_monthly: number } | null }
type PriceOrder = { buyer_id: string; creator_id: string; stripe_subscription_id: string | null;
  stripe_livemode: boolean; gross_cents: number; reference: { tierId?: string } }
const currency = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
export function subscriptionPriceLabel(sub: Subscription, buyerId: string, orders: PriceOrder[]) {
  if (sub.buyer_id !== buyerId) return 'Preis nicht verfügbar'
  if (sub.stripe_subscription_id?.startsWith('free_') && sub.stripe_livemode === null) return 'Kostenlos'
  const order = orders.find(row => row.buyer_id === buyerId && row.creator_id === sub.creator_id
    && row.stripe_subscription_id === sub.stripe_subscription_id && !!row.stripe_subscription_id
    && row.stripe_livemode === sub.stripe_livemode && row.reference.tierId === sub.tier_id
    && Number.isSafeInteger(row.gross_cents) && row.gross_cents >= 0)
  if (order) return order.gross_cents === 0 ? 'Kostenlos' : `${currency(order.gross_cents)}/Mo.`
  // Legacy subscriptions have no agreed-price ledger. Never present the coach's
  // mutable tariff as the amount actually billed after a historical discount.
  return sub.tier ? `Tarifpreis ${currency(Math.round(sub.tier.price_monthly * 100))}/Mo.` : 'Preis nicht verfügbar'
}
export async function subscriptionPriceLabels(service: SupabaseClient, buyerId: string, subscriptions: Subscription[]) {
  const ids = subscriptions.filter(sub => sub.buyer_id === buyerId && sub.stripe_subscription_id?.startsWith('sub_'))
    .map(sub => sub.stripe_subscription_id!)
  const { data, error } = ids.length ? await service.from('payment_orders')
    .select('buyer_id,creator_id,stripe_subscription_id,stripe_livemode,gross_cents,reference')
    .eq('buyer_id', buyerId).eq('kind', 'subscription').in('stripe_subscription_id', ids) : { data: [], error: null }
  return Object.fromEntries(subscriptions.map(sub => [sub.id, subscriptionPriceLabel(sub, buyerId, error ? [] : data ?? [])]))
}
