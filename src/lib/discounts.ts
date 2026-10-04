import type { SupabaseClient } from '@supabase/supabase-js'

export type DiscountKind = 'products' | 'subscriptions' | 'sessions'
export type DiscountReservation = {
  id: string; discount_id: string; original_cents: number; savings_cents: number; final_cents: number; expires_at: string
}
export class DiscountError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code === 'minimum_payment'
      ? 'Der Betrag nach Rabatt muss entweder 0 € oder mindestens 0,50 € betragen. Bitte ändere den Warenkorb oder entferne den Rabatt.'
      : code === 'discount_unavailable' ? 'Der Rabatt konnte momentan nicht geprüft werden. Bitte versuche es erneut.'
        : 'Dieser Rabatt ist für diesen Kauf nicht verfügbar oder bereits vollständig eingelöst. Bitte prüfe deinen Rabatt.')
    this.name = 'DiscountError'
  }
}
export function savingsCents(type: string, value: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(value) || value <= 0
    || !['percent', 'fixed'].includes(type) || (type === 'percent' && value > 100)) throw new DiscountError('invalid_discount', 400)
  return Math.min(amount, type === 'percent' ? Math.round(amount * value / 100) : value)
}
export function requireStripeMinimum(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new DiscountError('invalid_amount', 400)
  if (amount > 0 && amount < 50) throw new DiscountError('minimum_payment', 400)
}
// Allocate only whole cents. Largest remainders keep the exact agreed total
// without flooring every line at Stripe's transaction-level minimum.
export function allocateDiscount(amounts: number[], savings: number) {
  const total = amounts.reduce((a, b) => a + b, 0)
  if (amounts.some(a => !Number.isSafeInteger(a) || a < 0) || !Number.isSafeInteger(savings) || savings < 0 || savings > total) throw new DiscountError('invalid_amount', 400)
  if (total === 0) return amounts.map(() => 0)
  const final = total - savings
  const shares = amounts.map((amount, index) => {
    const numerator = BigInt(amount) * BigInt(final), denominator = BigInt(total)
    return { index, value: Number(numerator / denominator), remainder: numerator % denominator }
  })
  let remaining = final - shares.reduce((sum, share) => sum + share.value, 0)
  for (const share of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) if (remaining-- > 0) share.value++
  return shares.map(share => share.value)
}
export async function reserveDiscount(service: SupabaseClient, input: {
  id: string; discountId: string; buyerId: string; creatorId: string; kind: DiscountKind; originalCents: number; productIds?: string[]; tierId?: string
}): Promise<DiscountReservation> {
  const { data, error } = await service.rpc('reserve_discount_redemption', {
    p_id: input.id, p_discount_id: input.discountId, p_buyer_id: input.buyerId, p_creator_id: input.creatorId,
    p_kind: input.kind, p_original_cents: input.originalCents, p_product_ids: input.productIds ?? [], p_tier_id: input.tierId ?? null,
  })
  if (error || !data) throw new DiscountError('discount_unavailable', 503)
  if (data.error) throw new DiscountError(data.error)
  if (data.id !== input.id || data.discount_id !== input.discountId || data.original_cents !== input.originalCents
    || data.final_cents !== data.original_cents - data.savings_cents) throw new DiscountError('discount_unavailable', 503)
  return data as DiscountReservation
}
export async function releaseDiscount(service: SupabaseClient, id: string) {
  const { error } = await service.rpc('release_discount_redemption', { p_id: id })
  if (error) throw new DiscountError('discount_unavailable', 503)
}
