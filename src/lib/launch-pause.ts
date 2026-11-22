import 'server-only'

export function isLaunchPaused(): boolean {
  // Keep the same exception for the isolated Supabase/Stripe sandbox.
  const isolatedSupabase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/
  const sandboxStripeKey = /^(sk|rk)_test_/
  return !(
    isolatedSupabase.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    && sandboxStripeKey.test(process.env.STRIPE_SECRET_KEY ?? '')
  )
}
