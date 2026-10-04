import { addDaysToDateString, utcToBerlinDateString } from './coaching-slots'

export type EarningsRow = {
  id: string; kind: 'products' | 'booking' | 'subscription'; gross_cents: number; platform_fee_cents: number; coach_net_cents: number
  amount_refunded_cents: number; refund_requested_cents: number; amount_reversed_cents: number
  transfer_amount_cents: number | null; stripe_transfer_id: string | null; stripe_payment_intent_id: string
  state: string; fulfillment_state: string; created_at: string
}
export type EarningsTotals = {
  payments: number; gross: number; refunded: number; retained: number; fee: number; net: number
  transferred: number; pending: number; reversalPending: number; reversed: number; refundPending: number
}
export const emptyEarnings = (): EarningsTotals => ({ payments: 0, gross: 0, refunded: 0, retained: 0, fee: 0, net: 0, transferred: 0, pending: 0, reversalPending: 0, reversed: 0, refundPending: 0 })
export function historicalGross(record: { payment_status: string; paid: number; refunded: number }) {
  if (![record.paid, record.refunded].every(n => Number.isSafeInteger(n) && n >= 0) || record.refunded > record.paid) throw new Error('Invalid historical earnings')
  return ['paid', 'partially_refunded', 'refunded'].includes(record.payment_status) ? record.paid - record.refunded : null
}

export function earningsForRow(row: EarningsRow): EarningsTotals {
  const ints = [row.gross_cents, row.platform_fee_cents, row.coach_net_cents, row.amount_refunded_cents, row.refund_requested_cents, row.amount_reversed_cents, row.transfer_amount_cents ?? 0]
  if (!ints.every(n => Number.isSafeInteger(n) && n >= 0) || row.gross_cents <= 0
    || row.platform_fee_cents + row.coach_net_cents !== row.gross_cents
    || row.amount_refunded_cents > row.gross_cents || row.refund_requested_cents > row.gross_cents
    || row.amount_reversed_cents > (row.transfer_amount_cents ?? 0) || (row.transfer_amount_cents ?? 0) > row.coach_net_cents
    || (!row.stripe_transfer_id && row.amount_reversed_cents !== 0) || (row.stripe_transfer_id && row.transfer_amount_cents === null)
    || !Number.isFinite(Date.parse(row.created_at))) throw new Error('Invalid earnings ledger')
  const retained = row.gross_cents - row.amount_refunded_cents
  // Exact cumulative cent arithmetic used by the existing transfer/reversal flow.
  // Presentation only: never recalculate or persist a payment or platform fee.
  const net = row.coach_net_cents - Number(BigInt(row.coach_net_cents) * BigInt(row.amount_refunded_cents) / BigInt(row.gross_cents))
  const transferred = row.stripe_transfer_id ? (row.transfer_amount_cents ?? 0) - row.amount_reversed_cents : 0
  return { payments: 1, gross: row.gross_cents, refunded: row.amount_refunded_cents, retained,
    fee: retained - net, net, transferred, pending: Math.max(0, net - transferred),
    reversalPending: Math.max(0, transferred - net), reversed: row.amount_reversed_cents,
    refundPending: Math.max(0, row.refund_requested_cents - row.amount_refunded_cents) }
}
export function summarizeEarnings(rows: EarningsRow[], now: number) {
  const all = emptyEarnings(), month = emptyEarnings()
  const sources = { products: emptyEarnings(), booking: emptyEarnings(), subscription: emptyEarnings() }
  const today = utcToBerlinDateString(now)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysToDateString(today, i - 6)
    return { date, day: new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' }), revenue: 0 }
  })
  const add = (target: EarningsTotals, item: EarningsTotals) => { for (const key of Object.keys(target) as (keyof EarningsTotals)[]) { target[key] += item[key]; if (!Number.isSafeInteger(target[key])) throw new Error('Earnings total overflow') } }
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error('Duplicate earnings ledger row')
    seen.add(row.id)
    if (!sources[row.kind]) throw new Error('Unknown earnings kind')
    const item = earningsForRow(row), date = utcToBerlinDateString(row.created_at)
    add(all, item); add(sources[row.kind], item)
    if (date.slice(0, 7) === today.slice(0, 7)) add(month, item)
    const day = days.find(d => d.date === date)
    if (day) day.revenue += item.retained / 100
  }
  return { all, month, sources, days }
}
