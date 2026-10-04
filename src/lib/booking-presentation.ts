// Presentation only: never changes booking, payment, refund or access decisions.
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt', cancelled: 'Storniert', completed: 'Abgeschlossen',
  pending_payment: 'Zahlung ausstehend', payment_failed: 'Zahlung fehlgeschlagen',
  expired: 'Reservierung abgelaufen', refunded: 'Erstattet', reversed: 'Zahlung rückgängig',
}
export const BOOKING_STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  pending_payment: 'bg-amber-50 text-amber-800 border-amber-200',
  payment_failed: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-gray-50 text-gray-600 border-gray-200',
  refunded: 'bg-blue-50 text-blue-700 border-blue-200',
  reversed: 'bg-red-50 text-red-700 border-red-200',
}
export function bookingStatusLabel(status: string) {
  return BOOKING_STATUS_LABELS[status] ?? 'Status wird geprüft'
}
export function bookingPaymentLabel(b: { price_cents: number; is_subscription_session?: boolean; payment_status: string; status: string }) {
  if (b.is_subscription_session) return 'Inklusiv (Abo)'
  if (b.price_cents === 0) return 'Kostenlos'
  const labels: Record<string, string> = {
    paid: 'Bezahlt', refunded: 'Erstattet', partially_refunded: 'Teilweise erstattet',
    pending: 'Zahlung ausstehend', failed: 'Zahlung fehlgeschlagen', expired: 'Zahlung abgelaufen',
    reversed: 'Zahlung rückgängig', disputed: 'Zahlung in Klärung', chargeback: 'Zahlung zurückgebucht',
    not_required: 'Keine Zahlung erforderlich',
  }
  if (labels[b.payment_status]) return labels[b.payment_status]
  if (b.payment_status === 'unpaid') {
    if (b.status === 'payment_failed') return 'Zahlung fehlgeschlagen'
    if (b.status === 'expired') return 'Zahlung abgelaufen'
    if (b.status === 'cancelled') return 'Keine Zahlung erfolgt'
    return 'Zahlung ausstehend'
  }
  return 'Zahlungsstatus wird geprüft'
}
export function bookingPaymentSummary(b: Parameters<typeof bookingPaymentLabel>[0]) {
  const label = bookingPaymentLabel(b)
  return b.price_cents === 0 || b.is_subscription_session ? label : `${(b.price_cents / 100).toFixed(2).replace('.', ',')} € · ${label}`
}

export function groupBookingsByTime<T extends { scheduled_at: string; duration_minutes: number }>(bookings: T[], now: number) {
  // A cancelled/pending/completed status never changes the actual appointment date.
  // Include ongoing sessions until their scheduled end; never infer completion.
  const current = bookings.filter(b => new Date(b.scheduled_at).getTime() + b.duration_minutes * 60_000 > now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  const past = bookings.filter(b => new Date(b.scheduled_at).getTime() + b.duration_minutes * 60_000 <= now)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())
  return { current, past }
}
