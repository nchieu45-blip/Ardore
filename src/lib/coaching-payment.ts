import 'server-only'

function localOrigin(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && Boolean(url.port) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
  } catch { return false }
}

/** Opt-in for disposable local databases only; never enabled by a browser request. */
export function isolatedCoachingTestsEnabled(): boolean {
  return process.env.ARDORE_ISOLATED_COACHING_TESTS === '1'
    && ['development', 'test'].includes(process.env.NODE_ENV ?? '')
    && localOrigin(process.env.NEXT_PUBLIC_APP_URL)
    && localOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
    && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY ?? '')
    && /^pk_test_[A-Za-z0-9]+$/.test(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')
}

export function coachingPaymentModeAllowed(livemode: boolean | null): boolean {
  return livemode === !isolatedCoachingTestsEnabled()
}

export const COACHING_PAYMENT_ELIGIBILITY_FILTER =
  isolatedCoachingTestsEnabled()
    ? 'payment_status.eq.not_required,and(payment_status.eq.paid,stripe_livemode.eq.false)'
    : 'payment_status.eq.not_required,and(payment_status.eq.paid,stripe_livemode.eq.true)'

export function hasValidCoachingPayment(booking: {
  payment_status: string
  stripe_livemode: boolean | null
}): boolean {
  return booking.payment_status === 'not_required'
    || (booking.payment_status === 'paid' && coachingPaymentModeAllowed(booking.stripe_livemode))
}
