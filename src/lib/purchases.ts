export const VALID_PURCHASE_STATUS = 'paid' as const

// Services, bookings and subscriptions have their own fulfillment paths.
export const PERMANENT_DIGITAL_TYPES = ['pdf', 'video', 'course', 'image'] as const
export type PurchaseState = 'completed' | 'processing' | 'awaiting_payment' | 'payment_failed' | 'canceled' | 'refund_pending' | 'refunded' | 'unavailable'
export interface PurchaseStatus {
  state: PurchaseState
  productIds: string[]
  testMode: boolean
}

export function confirmedProductIds(expected: string[], rows: { product_id: string }[]) {
  const confirmed = new Set(rows.map(row => row.product_id))
  return expected.length > 0 && expected.every(id => confirmed.has(id)) ? [...new Set(expected)] : []
}
