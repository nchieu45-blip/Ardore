export const COACHING_PAYMENT_ELIGIBILITY_FILTER =
  'payment_status.eq.not_required,and(payment_status.eq.paid,stripe_livemode.eq.true)'

export function hasValidCoachingPayment(booking: {
  payment_status: string
  stripe_livemode: boolean | null
}): boolean {
  return booking.payment_status === 'not_required'
    || (booking.payment_status === 'paid' && booking.stripe_livemode === true)
}
