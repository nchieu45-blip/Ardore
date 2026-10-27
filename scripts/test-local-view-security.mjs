// Explicit local-only integration runner. Never included in verify-*.mjs/CI.
// Auth fixtures always use GoTrue Admin API; raw auth.users writes are forbidden.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomUUID, randomInt } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

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
const loginFixtures = new Map()
const suffix = run.id.replaceAll('-', '')
const pauseFunction = `local_security_pause_${suffix}`
const pauseTrigger = `zz_local_security_pause_${suffix}`
let stage = 'setup', createdVerificationBucket = false
const sessions = []
// Execute the actual orchestration against LOCAL services, without loading any
// provider/email client. This is not a mocked database or a Stripe integration.
function loadLocal(path, modules) {
  const fixtureModule = { exports: {} }
  new Function('require','exports','module', ts.transpileModule(readFileSync(new URL(path, import.meta.url),'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(name => {
    assert.ok(name in modules, 'External service import forbidden in local barrier suite')
    return modules[name]
  }, fixtureModule.exports, fixtureModule)
  return fixtureModule.exports
}
const cancellation = loadLocal('../src/lib/subscription-cancellation.ts', {
  '@/lib/subscription-entitlement': loadLocal('../src/lib/subscription-entitlement.ts', {}),
})
const { deleteAccountSafely } = loadLocal('../src/lib/account-deletion.ts', {
  'server-only': {}, '@/lib/subscription-cancellation': cancellation,
})
const providerForbidden = async () => { throw new Error('Stripe forbidden in local barrier suite') }
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
  const email = `view.${label}.${run.id}@example.invalid`, password = randomUUID()
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { full_name: `LOCAL ${label}`, local_security_run: run.id } })
  if (result.error) throw new Error('Local GoTrue fixture creation failed')
  run.users.push(result.data.user.id)
  loginFixtures.set(result.data.user.id, { email, password })
  return result.data.user.id
}
async function coach(label, published = false) {
  const id = await user(label)
  return insert('creator_profiles', { user_id: id, display_name: `Local ${label}`, slug: `${label}-${run.id}`, category: 'fitness', categories: ['fitness'], is_published: published, onboarding_step: published ? 5 : 1 })
}
async function accountExists(id) { const r = await service.auth.admin.getUserById(id); return !r.error && r.data.user?.id === id }
async function clientFor(id) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.signInWithPassword(loginFixtures.get(id))
  if (result.error) throw new Error('Local fixture login failed')
  return client
}
async function upload(coachId, allowBlocked = false) {
  const path = `${coachId}/local-security-${suffix}.pdf`
  const result = await service.storage.from('verification-docs').upload(path, Buffer.from('Fictional local security fixture'), { contentType: 'application/pdf' })
  if (result.error) {
    // Storage sanitizes trigger exceptions into DatabaseError/500 on this local
    // version. Test the API rejection + actual object/account state, not private
    // Postgres error text. Writer lock arrival and allowed uploads are verified.
    if (allowBlocked) return null
    throw new Error('Local fixture upload failed')
  }
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
    stage = 'parallel_wait_deletion_pause'
    await waitForPause(key)
    // Start the writer while deletion is paused. The fixed writer MUST now
    // wait on the account lock, so awaiting it before releasing would deadlock
    // the test harness itself. Keep the original safety assertions below.
    const writing = operation()
    try {
      stage = 'parallel_wait_writer_lock'
      for (let i = 0; i < 60; i++) {
        if (sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted;") === '2') break
        if (i === 59) throw new Error('Concurrent writer did not reach the shared account lock')
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    } finally { await send(barrier, 'COMMIT;') }
    stage = 'parallel_wait_writer_result'
    await writing
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
  // Exact fixture class IDs also own their composite-key occurrence rows.
  if (run.tables.video_classes?.length) {
    db(await service.from('video_class_bookings').delete().in('video_class_id', run.tables.video_classes))
    db(await service.from('group_booking_reservations').delete().in('video_class_id', run.tables.video_classes))
    db(await service.from('video_class_occurrences').delete().in('video_class_id', run.tables.video_classes))
  }
  for (const table of ['video_classes', 'payment_orders', 'session_reviews', 'reviews', 'purchases', 'bookings', 'chat_conversations', 'subscriptions', 'products', 'subscription_tiers', 'creator_profiles']) {
    if (run.tables[table]?.length) db(await service.from(table).delete().in('id', run.tables[table]))
  }
  for (const id of run.users) {
    const found = await service.auth.admin.getUserById(id)
    if (found.error?.code === 'user_not_found') continue
    assert.ok(!found.error && found.data.user.user_metadata.local_security_run === run.id, 'Never clean unrelated accounts')
    const result = await service.auth.admin.deleteUser(id); if (result.error) throw new Error('Exact local fixture Auth cleanup failed')
  }
  if (run.users.length) sql(`DELETE FROM private.account_deletion_barriers WHERE user_id IN (${run.users.map(id => `'${id}'::uuid`).join(',')});`)
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
    await pausedDelete(race.user_id, async () => { path = await upload(race.id, true) })
    record('upload_after_guard_must_not_outlive_deleted_account', await accountExists(race.user_id) || !await fileExists(`${race.id}/local-security-${suffix}.pdf`), 'Same service-role Storage API upload and same final deletion boundary; the writer waits, then is rejected.')
    record('delete_first_service_upload_is_explicitly_rejected', path === null && !await accountExists(race.user_id))
    const buyerId = await user('checkout-race')
    const orderId = randomUUID()
    let orderResult
    await pausedDelete(buyerId, async () => {
      orderResult = await service.from('payment_orders').insert({ id: orderId, kind: 'products', buyer_id: buyerId, creator_id: pub.id, account_id: null, gross_cents: 0, platform_fee_cents: 0, coach_net_cents: 0, stripe_livemode: false, reference: { local_security_run: run.id, productIds: [product.id] } })
      if (!orderResult.error) (run.tables.payment_orders ??= []).push(orderId)
    })
    const persisted = db(await service.from('payment_orders').select('id').eq('id', orderId).maybeSingle())
    record('checkout_order_after_preflight_must_keep_valid_buyer_account', await accountExists(buyerId) || !persisted, 'Only a local zero-value frozen order; no Stripe API calls, sessions or payments.')
    record('delete_first_order_is_explicitly_rejected', orderResult.error?.code === '55000' && !await accountExists(buyerId))

    stage = 'durable_write_barrier'
    const lockedCoach = await coach('barrier-coach')
    const browser = await clientFor(lockedCoach.user_id)
    const start = await service.rpc('begin_account_deletion', { p_user_id: lockedCoach.user_id })
    assert.ok(!start.error && typeof start.data === 'string')
    const token = start.data
    const directClient = await browser.rpc('begin_account_deletion', { p_user_id: lockedCoach.user_id })
    record('browser_cannot_invoke_deletion_lifecycle_rpc', !!directClient.error)
    const duplicateStart = await service.rpc('begin_account_deletion', { p_user_id: lockedCoach.user_id })
    record('concurrent_deletion_worker_cannot_steal_active_lease', duplicateStart.error?.code === '55000')
    const blockedPath = `${lockedCoach.id}/local-security-${suffix}.pdf`
    const browserUpload = await browser.storage.from('verification-docs').upload(blockedPath, Buffer.from('Local fictional fixture'), { contentType: 'application/pdf' })
    record('browser_storage_upload_denied_during_durable_deletion', !!browserUpload.error && !await fileExists(blockedPath))
    record('service_storage_upload_also_denied_during_durable_deletion', await upload(lockedCoach.id, true) === null)
    const blockedOrderId = randomUUID(), blockedSubscriptionId = randomUUID()
    ;(run.tables.payment_orders ??= []).push(blockedOrderId)
    ;(run.tables.subscriptions ??= []).push(blockedSubscriptionId)
    // Track exact attempted IDs even if a broken guard unexpectedly allows one.
    if (!run.files.includes(blockedPath)) run.files.push(blockedPath)
    const blockedOrder = await service.from('payment_orders').insert({ id: blockedOrderId, kind: 'products', buyer_id: own, creator_id: lockedCoach.id, account_id: null, gross_cents: 0, platform_fee_cents: 0, coach_net_cents: 0, stripe_livemode: false, reference: {} })
    record('checkout_for_deleting_coach_is_denied', blockedOrder.error?.code === '55000')
    const blockedSubscription = await service.from('subscriptions').insert({ id: blockedSubscriptionId, buyer_id: own, creator_id: lockedCoach.id, tier_id: tier.id, stripe_subscription_id: `free_${run.id}`, status: 'active' })
    record('late_subscription_cannot_change_deletion_snapshot', blockedSubscription.error?.code === '55000')
    // Lease expiry is NOT write permission. A new worker can resume but an old
    // token can neither mark Auth work nor release the new worker's barrier.
    sql(`UPDATE private.account_deletion_barriers SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id='${lockedCoach.user_id}';`)
    record('expired_worker_lease_still_blocks_uploads', await upload(lockedCoach.id, true) === null)
    const resumed = await service.rpc('begin_account_deletion', { p_user_id: lockedCoach.user_id })
    assert.ok(!resumed.error && resumed.data !== token)
    const staleRelease = await service.rpc('release_account_deletion', { p_user_id: lockedCoach.user_id, p_attempt_id: token })
    const staleAuth = await service.rpc('mark_account_deletion_auth', { p_user_id: lockedCoach.user_id, p_attempt_id: token })
    record('old_worker_token_cannot_release_or_authorize_auth', staleRelease.data === false && staleAuth.data === false && await upload(lockedCoach.id, true) === null)
    const released = await service.rpc('release_account_deletion', { p_user_id: lockedCoach.user_id, p_attempt_id: resumed.data })
    record('pre_auth_failure_can_safely_release_matching_attempt', released.data === true && !!await upload(lockedCoach.id))

    const uncertain = await user('ambiguous-auth')
    const uncertainStart = db(await service.rpc('begin_account_deletion', { p_user_id: uncertain }))
    record('auth_request_requires_explicit_durable_fencing', db(await service.rpc('mark_account_deletion_auth', { p_user_id: uncertain, p_attempt_id: uncertainStart })) === true)
    const cannotReopen = await service.rpc('release_account_deletion', { p_user_id: uncertain, p_attempt_id: uncertainStart })
    record('ambiguous_auth_call_never_reopens_writes', cannotReopen.data === false)
    sql(`UPDATE private.account_deletion_barriers SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id='${uncertain}';`)
    const uncertainRetry = db(await service.rpc('begin_account_deletion', { p_user_id: uncertain }))
    const retryRelease = await service.rpc('release_account_deletion', { p_user_id: uncertain, p_attempt_id: uncertainRetry })
    record('retry_preserves_prior_ambiguous_auth_barrier', retryRelease.data === false)

    stage = 'writer_first_order'
    const firstBuyer = await user('order-first'), firstOrder = randomUUID(), writer = session()
    ;(run.tables.payment_orders ??= []).push(firstOrder)
    await send(writer, `BEGIN; INSERT INTO public.payment_orders(id,kind,buyer_id,creator_id,account_id,gross_cents,platform_fee_cents,coach_net_cents,stripe_livemode,reference) VALUES('${firstOrder}','products','${firstBuyer}','${pub.id}',NULL,0,0,0,false,'{}');`)
    const removing = service.auth.admin.deleteUser(firstBuyer)
    try {
      for (let i = 0; i < 60; i++) {
        if (sql("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted);") === 't') break
        if (i === 59) throw new Error('Deletion did not wait for in-flight writer')
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    } finally { await send(writer, 'COMMIT;') }
    const kept = await removing
    record('writer_first_uncommitted_order_blocks_delete_after_commit', !!kept.error && await accountExists(firstBuyer) && !!db(await service.from('payment_orders').select('id').eq('id',firstOrder).maybeSingle()))

    stage = 'actual_deletion_orchestration'
    const actualUser = await user('actual-safe-delete')
    await deleteAccountSafely({ service, userId: actualUser, getProvider: providerForbidden })
    record('actual_app_orchestration_deletes_empty_local_account', !await accountExists(actualUser))
    record('successful_app_delete_retains_tombstone_against_stale_writers', sql(`SELECT auth_started FROM private.account_deletion_barriers WHERE user_id='${actualUser}';`) === 't')
    const retainedUser = await user('actual-retained-order')
    await insert('payment_orders', { kind:'products',buyer_id:retainedUser,creator_id:pub.id,account_id:null,gross_cents:0,platform_fee_cents:0,coach_net_cents:0,stripe_livemode:false,reference:{} })
    let retainedStatus
    try { await deleteAccountSafely({ service,userId:retainedUser,getProvider:providerForbidden }) } catch (error) { retainedStatus = error.status }
    record('actual_app_retention_failure_preserves_account_and_releases_pre_auth_barrier', retainedStatus === 409 && await accountExists(retainedUser) && sql(`SELECT NOT EXISTS(SELECT 1 FROM private.account_deletion_barriers WHERE user_id='${retainedUser}');`) === 't')
    const ambiguousUser = await user('actual-ambiguous-auth')
    const failTransport = new Proxy(service, { get(target, key) {
      if (key === 'auth') return { admin: { ...target.auth.admin, deleteUser: async () => { throw new Error('Explicit LOCAL Auth transport fault') } } }
      const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value
    } })
    try { await deleteAccountSafely({ service:failTransport,userId:ambiguousUser,getProvider:providerForbidden }) } catch { /* expected local transport fault */ }
    record('actual_auth_transport_failure_preserves_account_and_durable_barrier', await accountExists(ambiguousUser) && sql(`SELECT auth_started FROM private.account_deletion_barriers WHERE user_id='${ambiguousUser}';`) === 't')
    sql(`UPDATE private.account_deletion_barriers SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id='${ambiguousUser}';`)
    await deleteAccountSafely({ service,userId:ambiguousUser,getProvider:providerForbidden })
    record('actual_app_retry_after_ambiguous_auth_can_complete_safely', !await accountExists(ambiguousUser))

    stage = 'duplicate_delete'
    const duplicate = await user('double-delete')
    const results = await Promise.all([service.auth.admin.deleteUser(duplicate), service.auth.admin.deleteUser(duplicate)])
    record('parallel_duplicate_delete_has_no_false_retained_account', results.some(r => !r.error) && !await accountExists(duplicate))

    stage = 'group_retention_and_races'
    const startsAt = new Date(Date.now() + 7 * 86400000).toISOString()
    async function groupClass(host, price = 0) {
      return insert('video_classes', { creator_id: host.id, title: 'LOCAL group agreement', schedule_type: 'once',
        starts_at: startsAt, duration_minutes: 45, price_cents: price, included_in_subscription: false,
        max_participants: 9, active: true })
    }
    async function reserve(course, buyerId) {
      return service.rpc('reserve_group_class_booking', { p_class_id: course.id, p_buyer_id: buyerId,
        p_request_id: randomUUID(), p_occurrence_start: startsAt, p_livemode: course.price_cents ? false : null,
        p_account_id: course.price_cents ? 'acct_LocalFixture' : null, p_expected_price_cents: course.price_cents })
    }
    async function retainedByApp(id) {
      let status
      try { await deleteAccountSafely({ service, userId: id, getProvider: providerForbidden }) } catch (error) { status = error.status }
      return status === 409 && await accountExists(id)
    }
    for (const price of [0, 500]) {
      const host = await coach(`group-host-${price}`, true), participant = await user(`group-buyer-${price}`)
      const course = await groupClass(host, price)
      const agreement = db(await reserve(course, participant))
      assert.ok(agreement.reservation?.id)
      record(`group_${price}_buyer_and_host_history_prevents_app_deletion_before_stripe`,
        await retainedByApp(participant) && await retainedByApp(host.user_id))
      const direct = await service.auth.admin.deleteUser(participant)
      record(`group_${price}_buyer_history_also_blocks_direct_auth_delete`, !!direct.error && await accountExists(participant))
    }
    const emptyHost = await coach('occurrence-only-host', true), emptyCourse = await groupClass(emptyHost)
    db(await service.rpc('ensure_group_class_occurrence', { p_class_id: emptyCourse.id, p_occurrence_start: startsAt }))
    record('host_initialized_occurrence_without_participants_prevents_app_deletion', await retainedByApp(emptyHost.user_id))

    const raceHost = await coach('group-race-host', true), raceCourse = await groupClass(raceHost)
    db(await service.rpc('ensure_group_class_occurrence', { p_class_id: raceCourse.id, p_occurrence_start: startsAt }))
    const raceBuyer = await user('group-delete-first')
    let reservationResult
    const groupDelete = await pausedDelete(raceBuyer, async () => { reservationResult = await reserve(raceCourse, raceBuyer) })
    record('delete_first_group_rpc_rejects_stale_buyer_without_orphan_reservation', !groupDelete.error
      && !await accountExists(raceBuyer) && reservationResult.error?.code === '55000'
      && db(await service.from('group_booking_reservations').select('id').eq('buyer_id', raceBuyer)).length === 0)

    const busyHost = await coach('group-deleting-host', true), busyCourse = await groupClass(busyHost), newcomer = await user('group-newcomer')
    const busyToken = db(await service.rpc('begin_account_deletion', { p_user_id: busyHost.user_id }))
    const blockedGroup = await reserve(busyCourse, newcomer)
    record('durable_coach_barrier_rejects_group_rpc_and_rolls_back_occurrence', blockedGroup.error?.code === '55000'
      && db(await service.from('video_class_occurrences').select('video_class_id').eq('video_class_id', busyCourse.id)).length === 0)
    db(await service.rpc('release_account_deletion', { p_user_id: busyHost.user_id, p_attempt_id: busyToken }))

    const writingBuyer = await user('group-writer-first'), writingRequest = randomUUID(), groupWriter = session()
    await send(groupWriter, `BEGIN; SELECT public.reserve_group_class_booking('${raceCourse.id}','${writingBuyer}','${writingRequest}','${startsAt}',NULL,NULL,0);`)
    stage = 'writer_first_group_app_deletion'
    const groupRemoving = deleteAccountSafely({ service, userId: writingBuyer, getProvider: providerForbidden })
      .then(() => ({ status: 200 }), error => ({ status: error.status }))
    try {
      for (let i = 0; i < 60; i++) {
        if (sql("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted);") === 't') break
        if (i === 59) throw new Error('Deletion did not wait for in-flight writer')
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    } finally { await send(groupWriter, 'COMMIT;') }
    record('writer_first_group_rpc_commit_preserves_buyer_and_retained_agreement', (await groupRemoving).status === 409
      && await accountExists(writingBuyer) && db(await service.from('group_booking_reservations').select('id').eq('buyer_id', writingBuyer)).length === 1)

    stage = 'stripe_faults_with_real_local_auth'
    const stripeBuyer = await user('stripe-fault-buyer')
    const localProviderId = `sub_local${suffix}`
    await insert('subscriptions', { buyer_id: stripeBuyer, creator_id: pub.id, tier_id: tier.id,
      stripe_subscription_id: localProviderId, stripe_livemode: false, status: 'active', current_period_end: '2099-01-01T00:00:00Z' })
    let providerStatus = 'active', cancelCount = 0, fault = 'cancel'
    const fakeProvider = { subscriptions: {
      async retrieve() { if (fault === 'retrieve') throw new Error('Local injected Stripe failure'); return { id: localProviderId, livemode: false, status: providerStatus,
        metadata: { buyer_id: stripeBuyer, creator_id: pub.id, tier_id: tier.id } } },
      async cancel() { cancelCount++; if (fault === 'cancel') throw new Error('Local injected Stripe failure'); providerStatus = 'canceled';
        if (fault === 'timeout') throw new Error('Local injected ambiguous Stripe timeout') },
    } }
    for (const injected of ['retrieve', 'cancel', 'timeout']) {
      fault = injected; let status
      try { await deleteAccountSafely({ service, userId: stripeBuyer, getProvider: async () => ({ provider: fakeProvider, livemode: false }) }) } catch (error) { status = error.status }
      record(`stripe_${injected}_fault_keeps_real_local_account_and_subscription`, status === 503 && await accountExists(stripeBuyer)
        && db(await service.from('subscriptions').select('id').eq('buyer_id', stripeBuyer)).length === 1)
    }
    const priorCancels = cancelCount; fault = null
    const parallelApp = await Promise.allSettled(Array.from({ length: 4 }, () => deleteAccountSafely({ service, userId: stripeBuyer,
      getProvider: async () => ({ provider: fakeProvider, livemode: false }) })))
    record('parallel_actual_app_retry_after_stripe_timeout_deletes_once_without_recancellation',
      parallelApp.filter(r => r.status === 'fulfilled').length === 1 && !await accountExists(stripeBuyer) && cancelCount === priorCancels)
  }
  stage = 'cleanup'
  await cleanup()
  record('all_created_local_auth_fixtures_removed_existing_users_preserved', sql('SELECT count(*) FROM auth.users;') === baseline)
} catch (error) {
  const known = ['Local fixture upload failed','Expected local race boundary not reached','Concurrent writer did not reach the shared account lock','Local SQL barrier unavailable','Isolated SQL operation failed','Local fixture database operation failed','Deletion did not wait for in-flight writer']
  record('runner_completed_without_unexpected_fixture_error', false, `stage=${stage}; ${known.includes(error.message) ? error.message : 'raw service output suppressed'}`)
  try { await cleanup() } catch { record('exact_fixture_cleanup_completed', false) }
}
const reportIndex = args.indexOf('--report')
if (reportIndex >= 0) writeFileSync(args[reportIndex + 1], JSON.stringify(run, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ checks: run.results.length, failed: run.blockers, productionAccess: false, stripeApiCalls: false }))
process.exitCode = run.blockers.length ? 1 : 0
