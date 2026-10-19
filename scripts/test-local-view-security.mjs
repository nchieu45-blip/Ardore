// Explicit local-only integration runner. Never included in verify-*.mjs/CI.
// Auth fixtures always use GoTrue Admin API; raw auth.users writes are forbidden.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomUUID, randomInt } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
assert.ok(args.includes('--local'), 'Explicit --local required')
const envPath = args[args.indexOf('--fixture-env') + 1]
assert.ok(args.includes('--fixture-env') && envPath?.endsWith('/.env.local'), 'Explicit isolated fixture environment required')
const env = parseEnv(readFileSync(envPath, 'utf8'))
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54331', 'Only the known loopback Supabase is permitted')
assert.ok(env.NEXT_PUBLIC_APP_URL === 'http://127.0.0.1:3011', 'Only the known local application is permitted')
const dockerArgs = ['--context', 'colima-ardore-test', 'exec', '-i', 'supabase_db_ardore-local-test', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres']
const inspected = spawnSync('docker', ['--context', 'colima-ardore-test', 'inspect', 'supabase_db_ardore-local-test', '--format', '{{.Name}} {{.State.Running}} {{.HostConfig.NetworkMode}}'], { encoding: 'utf8' })
assert.ok(inspected.status === 0 && inspected.stdout.trim() === '/supabase_db_ardore-local-test true ardore-local-loopback', 'Expected isolated container/network required')
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const run = { id: randomUUID(), users: [], tables: {}, files: [], results: [], blockers: [] }
const suffix = run.id.replaceAll('-', '')
const pauseFunction = `local_security_pause_${suffix}`
const pauseTrigger = `zz_local_security_pause_${suffix}`
let stage = 'setup', createdVerificationBucket = false
const sessions = []
function record(name, passed, detail) {
  run.results.push({ name, passed, ...(detail ? { detail } : {}) })
  if (!passed) run.blockers.push(name)
  console.log(JSON.stringify({ check: name, passed, ...(detail ? { detail } : {}) }))
}
function sqlResult(query, timeout = 20000) { return spawnSync('docker', dockerArgs, { input: query, encoding: 'utf8', timeout }) }
function sql(query) { const r = sqlResult(query); if (r.status !== 0) throw new Error('Isolated SQL operation failed'); return r.stdout.trim() }
function asRole(role, id, query) {
  assert.ok(['anon', 'authenticated'].includes(role))
  assert.ok(id === null || /^[0-9a-f-]{36}$/.test(id))
  return sql(`BEGIN READ ONLY; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claims = '${JSON.stringify({ role, ...(id ? { sub: id } : {}) })}'; ${query}; COMMIT;`)
}
function db(result) { if (result.error) throw new Error('Local fixture database operation failed'); return result.data }
async function insert(table, data) {
  const row = db(await service.from(table).insert(data).select().single())
  ;(run.tables[table] ??= []).push(row.id)
  return row
}
async function user(label) {
  const result = await service.auth.admin.createUser({ email: `view.${label}.${run.id}@example.invalid`, email_confirm: true,
    user_metadata: { full_name: `LOCAL ${label}`, local_security_run: run.id } })
  if (result.error) throw new Error('Local GoTrue fixture creation failed')
  run.users.push(result.data.user.id)
  return result.data.user.id
}
async function coach(label, published = false) {
  const id = await user(label)
  return insert('creator_profiles', { user_id: id, display_name: `Local ${label}`, slug: `${label}-${run.id}`, category: 'fitness', categories: ['fitness'], is_published: published, onboarding_step: published ? 5 : 1 })
}
async function accountExists(id) { const r = await service.auth.admin.getUserById(id); return !r.error && r.data.user?.id === id }
async function upload(coachId) {
  const path = `${coachId}/local-security-${suffix}.pdf`
  const result = await service.storage.from('verification-docs').upload(path, Buffer.from('Fictional local security fixture'), { contentType: 'application/pdf' })
  if (result.error) throw new Error('Local fixture upload failed')
  run.files.push(path)
  return path
}
async function fileExists(path) { const r = await service.storage.from('verification-docs').download(path); return !r.error }
function session() {
  const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
  const state = { child, out: '', pending: [] }
  child.stdout.on('data', chunk => { state.out += chunk.toString(); for (const resolve of state.pending.splice(0)) resolve() })
  child.stderr.on('data', () => {}) // Never expose raw service diagnostics.
  sessions.push(state)
  return state
}
async function send(state, command) {
  const marker = `done_${randomUUID().replaceAll('-', '')}`
  state.child.stdin.write(`${command}\n\\echo ${marker}\n`)
  const deadline = Date.now() + 10000
  while (!state.out.includes(marker)) {
    if (Date.now() > deadline || state.child.exitCode !== null) throw new Error('Local SQL barrier unavailable')
    await new Promise(resolve => { state.pending.push(resolve); setTimeout(resolve, 50) })
  }
}
async function waitForPause(key) {
  for (let i = 0; i < 60; i++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=${key});`) === 't') return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Expected local race boundary not reached')
}
async function pausedDelete(id, operation) {
  const key = randomInt(10000000, 20000000), barrier = session()
  await send(barrier, `BEGIN; SELECT pg_advisory_xact_lock(${key});`)
  // Test-only hook pauses AFTER the real guard, BEFORE the Auth cascade commits.
  // It touches only this exact fictional fixture. Never runs against production.
  sql(`CREATE FUNCTION private.${pauseFunction}() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF OLD.id='${id}'::uuid THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN OLD; END $$; REVOKE ALL ON FUNCTION private.${pauseFunction}() FROM PUBLIC,anon,authenticated; CREATE TRIGGER ${pauseTrigger} BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.${pauseFunction}();`)
  const deletion = service.auth.admin.deleteUser(id)
  try {
    await waitForPause(key)
    await operation()
  } finally { await send(barrier, 'COMMIT;') }
  const result = await deletion
  sql(`DROP TRIGGER ${pauseTrigger} ON public.profiles; DROP FUNCTION private.${pauseFunction}();`)
  return result
}
async function cleanup() {
  for (const s of sessions) { if (s.child.exitCode === null) { s.child.stdin.end('ROLLBACK;\n\\q\n'); } }
  sql(`DROP TRIGGER IF EXISTS ${pauseTrigger} ON public.profiles; DROP FUNCTION IF EXISTS private.${pauseFunction}();`)
  for (const path of run.files) {
    const result = await service.storage.from('verification-docs').remove([path]); if (result.error) throw new Error('Exact local fixture file cleanup failed')
  }
  for (const table of ['payment_orders', 'session_reviews', 'reviews', 'purchases', 'bookings', 'chat_conversations', 'subscriptions', 'products', 'subscription_tiers', 'creator_profiles']) {
    if (run.tables[table]?.length) db(await service.from(table).delete().in('id', run.tables[table]))
  }
  for (const id of run.users) {
    const found = await service.auth.admin.getUserById(id)
    if (found.error?.code === 'user_not_found') continue
    assert.ok(!found.error && found.data.user.user_metadata.local_security_run === run.id, 'Never clean unrelated accounts')
    const result = await service.auth.admin.deleteUser(id); if (result.error) throw new Error('Exact local fixture Auth cleanup failed')
  }
  if (createdVerificationBucket && (await service.storage.deleteBucket('verification-docs')).error) throw new Error('Empty fixture bucket cleanup failed')
}
try {
  const baseline = sql('SELECT count(*) FROM auth.users;')
  const pub = await coach('published-coach', true), hidden = await coach('private-coach')
  const own = await user('paid-buyer'), free = await user('free-buyer'), expired = await user('expired-buyer')
  const sandbox = await user('test-buyer'), mismatch = await user('wrong-tier-buyer'), historical = await user('history-buyer'), stranger = await user('stranger')
  const tier = await insert('subscription_tiers', { creator_id: pub.id, name: 'Local fixture', price_monthly: 1, is_active: false })
  const wrongTier = await insert('subscription_tiers', { creator_id: hidden.id, name: 'Other coach', price_monthly: 1, is_active: false })
  for (const [id, mode, end, tierId, status] of [
    [own, true, '2099-01-01', tier.id, 'active'], [free, null, '2099-01-01', tier.id, 'active'],
    [expired, true, '2000-01-01', tier.id, 'active'], [sandbox, false, '2099-01-01', tier.id, 'active'],
    [mismatch, true, '2099-01-01', wrongTier.id, 'active'], [historical, true, '2000-01-01', tier.id, 'canceled'],
  ]) await insert('subscriptions', { buyer_id: id, creator_id: pub.id, tier_id: tierId, stripe_subscription_id: `${mode === null ? 'free_' : 'sub_'}${id.replaceAll('-', '')}`, stripe_livemode: mode, current_period_end: `${end}T00:00:00Z`, status })
  await insert('chat_conversations', { creator_id: pub.id, buyer_id: historical, kind: 'direct' })
  stage = 'profile_access'
  const visible = JSON.parse(asRole('authenticated', pub.user_id, 'SELECT COALESCE(json_agg(id ORDER BY id),\'[]\') FROM public.public_profiles'))
  record('coach_sees_only_self_entitled_subscribers_and_existing_chat_partner', JSON.stringify(visible) === JSON.stringify([pub.user_id, own, free, historical].sort()))
  record('unrelated_buyer_sees_only_own_profile', asRole('authenticated', stranger, `SELECT count(*)=1 AND bool_and(id='${stranger}'::uuid) FROM public.public_profiles`) === 't')
  record('expired_chat_partner_can_still_resolve_peer', asRole('authenticated', historical, 'SELECT count(*) FROM public.public_profiles') === '2')
  record('missing_subject_has_no_profile_projection', asRole('authenticated', null, 'SELECT count(*) FROM public.public_profiles') === '0')
  const anonProfiles = sqlResult('BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT * FROM public.public_profiles LIMIT 0;')
  record('anonymous_profile_enumeration_is_denied', anonProfiles.status !== 0 && anonProfiles.stderr.includes('42501'))

  stage = 'public_reviews'
  const product = await insert('products', { creator_id: pub.id, title: 'Local published product', type: 'pdf', price: 1, is_published: true })
  const privateProduct = await insert('products', { creator_id: pub.id, title: 'Local private product', type: 'pdf', price: 1, is_published: false })
  const hiddenProduct = await insert('products', { creator_id: hidden.id, title: 'Local hidden coach product', type: 'pdf', price: 1, is_published: true })
  const cases = [[own, product, true, 'paid', true], [own, privateProduct, true, 'paid', false], [own, hiddenProduct, true, 'paid', false], [sandbox, product, false, 'paid', false], [expired, product, true, 'refunded', false]]
  let publicReview
  for (const [buyerId, target, live, status, expected] of cases) {
    await insert('purchases', { buyer_id: buyerId, product_id: target.id, amount_paid: 1, payment_status: status, stripe_livemode: live })
    const review = await insert('reviews', { buyer_id: buyerId, product_id: target.id, rating: 5, content: 'Fictional local review' })
    if (expected) publicReview = review.id
    record(`product_review_visibility_${run.results.length}`, asRole('anon', null, `SELECT EXISTS(SELECT 1 FROM public.public_product_reviews WHERE id='${review.id}')`) === String(expected)[0])
  }
  record('review_owner_flag_is_preserved', asRole('authenticated', own, `SELECT is_own FROM public.public_product_reviews WHERE id='${publicReview}'`) === 't')
  record('other_buyer_cannot_claim_review_ownership', asRole('authenticated', stranger, `SELECT NOT is_own FROM public.public_product_reviews WHERE id='${publicReview}'`) === 't')
  for (const target of [pub, hidden]) {
    const booking = await insert('bookings', { creator_id: target.id, buyer_id: own, scheduled_at: '2020-01-01T12:00:00Z', duration_minutes: 60, status: 'completed', price_cents: 0, payment_status: 'not_required', buyer_email: 'fictional@example.invalid', buyer_name: 'Local fixture' })
    const review = await insert('session_reviews', { creator_id: target.id, buyer_id: own, booking_id: booking.id, rating: 4, content: 'Fictional local session review' })
    record(`session_review_visible_only_for_published_coach_${target === pub}`, asRole('anon', null, `SELECT EXISTS(SELECT 1 FROM public.public_session_reviews WHERE id='${review.id}')`) === (target === pub ? 't' : 'f'))
  }
  record('raw_customer_and_review_tables_not_granted_to_anonymous', sql("SELECT NOT has_table_privilege('anon','public.profiles','SELECT') AND NOT has_table_privilege('anon','public.reviews','SELECT') AND NOT has_table_privilege('anon','public.session_reviews','SELECT');") === 't')
  record('all_three_public_views_are_invoker', sql("SELECT count(*)=3 AND bool_and(reloptions @> ARRAY['security_invoker=true']) FROM pg_class WHERE oid IN ('public.public_profiles'::regclass,'public.public_product_reviews'::regclass,'public.public_session_reviews'::regclass);") === 't')
  record('profile_helper_not_executable_by_anonymous', sql("SELECT NOT has_function_privilege('anon','private.visible_chat_profiles()','EXECUTE');") === 't')
  record('public_review_columns_exclude_buyer_identity_and_billing', sql("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('public_product_reviews','public_session_reviews') AND column_name IN ('buyer_id','email','is_admin','booking_id','amount_paid','stripe_payment_intent_id'));") === 't')

  stage = 'migration_lock_timeout'
  const lock = session()
  await send(lock, 'BEGIN; LOCK TABLE public.profiles IN ROW EXCLUSIVE MODE;')
  const ddl = sqlResult(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; CREATE TRIGGER local_timeout_${suffix} BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_account_storage_deletion(); COMMIT;`)
  await send(lock, 'COMMIT;')
  record('migration_lock_contention_fails_with_55P03_without_partial_trigger', ddl.status !== 0 && ddl.stderr.includes('55P03') && sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='local_timeout_${suffix}');`) === 't')
  const slow = sqlResult("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SELECT pg_sleep(31); COMMIT;", 40000)
  record('statement_timeout_actually_cancels_slow_statement_with_57014', slow.status !== 0 && slow.stderr.includes('57014'))

  if (args.includes('--parallel')) {
    stage = 'parallel_cases'
    const bucket = await service.storage.getBucket('verification-docs')
    if (bucket.error) { if ((await service.storage.createBucket('verification-docs', { public: false })).error) throw new Error('Local private fixture bucket unavailable'); createdVerificationBucket = true }
    else assert.ok(bucket.data.public === false, 'Private local verification bucket required')
    const before = await coach('upload-first')
    const beforePath = await upload(before.id)
    const denied = await service.auth.admin.deleteUser(before.user_id)
    record('already_committed_upload_blocks_auth_delete', !!denied.error && await accountExists(before.user_id) && await fileExists(beforePath))
    const race = await coach('upload-race')
    let path
    await pausedDelete(race.user_id, async () => { path = await upload(race.id) })
    record('upload_after_guard_must_not_outlive_deleted_account', await accountExists(race.user_id) || !await fileExists(path), 'A deterministic local hook pauses after guard evaluation; no production hooks or uploads.')
    const buyerId = await user('checkout-race')
    let order
    await pausedDelete(buyerId, async () => { order = await insert('payment_orders', { kind: 'products', buyer_id: buyerId, creator_id: pub.id, account_id: null, gross_cents: 0, platform_fee_cents: 0, coach_net_cents: 0, stripe_livemode: false, reference: { local_security_run: run.id, productIds: [product.id] } }) })
    const persisted = db(await service.from('payment_orders').select('id').eq('id', order.id).maybeSingle())
    record('checkout_order_after_preflight_must_keep_valid_buyer_account', await accountExists(buyerId) || !persisted, 'Only a local zero-value frozen order; no Stripe API calls, sessions or payments.')
    const duplicate = await user('double-delete')
    const results = await Promise.all([service.auth.admin.deleteUser(duplicate), service.auth.admin.deleteUser(duplicate)])
    record('parallel_duplicate_delete_has_no_false_retained_account', results.some(r => !r.error) && !await accountExists(duplicate))
  }
  stage = 'cleanup'
  await cleanup()
  record('all_created_local_auth_fixtures_removed_existing_users_preserved', sql('SELECT count(*) FROM auth.users;') === baseline)
} catch {
  record('runner_completed_without_unexpected_fixture_error', false, `stage=${stage}; raw service output suppressed`)
  try { await cleanup() } catch { record('exact_fixture_cleanup_completed', false) }
}
const reportIndex = args.indexOf('--report')
if (reportIndex >= 0) writeFileSync(args[reportIndex + 1], JSON.stringify(run, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ checks: run.results.length, failed: run.blockers, productionAccess: false, stripeApiCalls: false }))
process.exitCode = run.blockers.length ? 1 : 0
