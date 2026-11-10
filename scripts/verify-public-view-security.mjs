// Offline contract checks; the explicitly opted-in local runner verifies SQL
// behavior, privileges, identities and concurrency against real GoTrue/Postgres.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const migration = readFileSync(new URL('../supabase/migrations/20261019131618_scope_public_view_projections.sql', import.meta.url), 'utf8')
const deletion = readFileSync(new URL('../supabase/migrations/20261018120029_guard_account_storage_deletion.sql', import.meta.url), 'utf8')

test('both pending migrations bound lock waits and statement execution transaction-locally', () => {
  for (const sql of [migration, deletion]) {
    assert.match(sql, /BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '30s';/)
    assert.match(sql, /COMMIT;\s*$/)
    assert.doesNotMatch(sql, /(?:UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\s+(?:public\.|auth\.|storage\.)/i)
  }
})
test('all three original public view contracts explicitly use invoker security', () => {
  assert.equal((migration.match(/security_invoker = true/g) ?? []).length, 3)
  for (const view of ['public_profiles', 'public_product_reviews', 'public_session_reviews']) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\s+WITH \\(security_barrier = true, security_invoker = true\\)`))
  }
  assert.match(migration, /GRANT SELECT ON public\.public_profiles TO authenticated;/)
  assert.match(migration, /GRANT SELECT ON public\.public_product_reviews, public\.public_session_reviews TO anon, authenticated;/)
})
test('privileged projections are static argument-free private functions with fixed search paths and explicit role grants', () => {
  assert.equal((migration.match(/STABLE SECURITY DEFINER SET search_path = ''/g) ?? []).length, 3)
  assert.doesNotMatch(migration, /CREATE FUNCTION public\./)
  assert.doesNotMatch(migration, /\bEXECUTE\b(?! ON FUNCTION)/)
  for (const name of ['visible_chat_profiles', 'published_product_reviews', 'published_session_reviews']) assert.match(migration, new RegExp(`CREATE FUNCTION private\\.${name}\\(\\)`))
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.visible_chat_profiles\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.visible_chat_profiles\(\) TO authenticated, service_role;/)
})
test('profile projection requires real caller identity and either own row, shared membership or trusted active entitlement', () => {
  for (const expression of [
    '(SELECT auth.uid()) IS NOT NULL', 'profile.id = (SELECT auth.uid())',
    'peer.conversation_id = caller.conversation_id', 'caller.user_id = (SELECT auth.uid())',
    'peer.user_id = profile.id', 'coach.user_id = (SELECT auth.uid())',
    "subscription.status = 'active'", 'subscription.current_period_end > now()',
    'tier.creator_id = subscription.creator_id', 'subscription.stripe_livemode = true',
    'subscription.stripe_livemode IS NULL', "starts_with(subscription.stripe_subscription_id, 'free_')",
  ]) assert.ok(migration.includes(expression), expression)
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data/)
})
test('review publication and live payment conditions are enforced inside the private boundary rather than only by callers', () => {
  assert.equal((migration.match(/AND coach\.is_published/g) ?? []).length, 2)
  assert.match(migration, /product\.id = review\.product_id AND product\.is_published/)
  assert.match(migration, /purchase\.payment_status = 'paid' AND purchase\.stripe_livemode = true/)
  assert.match(migration, /WHERE EXISTS \([\s\S]*purchase\.buyer_id = review\.buyer_id/)
  assert.doesNotMatch(migration, /GRANT (?:ALL|SELECT).*ON (?:public\.(?:profiles|reviews|purchases|session_reviews)|storage\.objects)/)
})
test('local integration runner is never part of CI and requires known loopback environment/container', () => {
  const runner = readFileSync(new URL('./test-local-view-security.mjs', import.meta.url), 'utf8')
  assert.match(runner, /args\.includes\('--local'\)/)
  assert.match(runner, /http:\/\/127\.0\.0\.1:54331/)
  assert.match(runner, /colima-ardore-test/)
  assert.match(runner, /supabase_db_ardore-local-test true ardore-local-loopback/)
  assert.match(runner, /service\.auth\.admin\.createUser/)
  assert.match(runner, /service\.auth\.admin\.deleteUser/)
  assert.doesNotMatch(runner, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+auth\.users/i)
  assert.doesNotMatch(runner, /new Stripe|api\.stripe\.com/)
})
