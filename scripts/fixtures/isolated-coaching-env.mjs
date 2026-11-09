// Deliberately fake credentials. No .env files, network access or service clients.
export const isolatedCoachingEnv = {
  NODE_ENV: 'development', ARDORE_ISOLATED_COACHING_TESTS: '1',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3032', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55131',
  STRIPE_SECRET_KEY: 'sk_test_syntheticFixture', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_syntheticFixture',
}
