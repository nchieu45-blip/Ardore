// Opt-in production TEST verification. No real accounts/payments or raw secrets.
// Fixtures are identified by IDs created here; all credentials remain in memory.
// Checkout confirmation mirrors Stripe CLI's official TEST fixture, allowing real
// Stripe-generated signed webhooks instead of fabricated success event payloads.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import Stripe from 'stripe'
import { createInterface } from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
if (!process.argv.includes('--run-production-synthetic')) {
  console.log('Skipped: requires --run-production-synthetic and TEST credentials.'); process.exit(0)
}
process.loadEnvFile('.env.local')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'yboeyxqeileicecqpwke.supabase.co')
const base = 'https://www.ardore-health.com'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })
const run = `ardore-lifecycle-${randomUUID().slice(0, 12)}`
const startedAt = Math.floor(Date.now() / 1000)
const users = [], bookings = [], sessions = new Set(), intentIds = new Set(), chargeIds = new Set()
const pass = label => { console.log(`PASS ${label}`); results.push(label) }
const results = []
const check = async query => { const value = await query; if (value.error) throw Object.assign(new Error('Database operation failed'), { code: value.error.code }); return value.data }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const objectId = value => typeof value === 'string' ? value : value?.id
let coach, coachActor, buyer, foreign, cliDirectory
const input = createInterface({ input: process.stdin, output: process.stdout })
async function syntheticUser(role) {
  const email = `delivered+${run}-${role}-${users.length}@resend.dev`
  const password = randomBytes(32).toString('base64url')
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { role, full_name: 'Synthetic lifecycle verification' } })
  if (created.error) throw Object.assign(new Error('GoTrue fixture creation failed'), { code: created.error.code })
  users.push(created.data.user.id)
  const jar = new Map()
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: cookies => cookies.forEach(cookie => jar.set(cookie.name, cookie.value)) },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error('Synthetic login failed')
  return { id: created.data.user.id, email, client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }
}
async function api(path, actor, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    Cookie: actor.cookie(), Origin: base }, body: JSON.stringify(body), redirect: 'manual' })
  return { status: response.status, data: await response.json() }
}
async function row(id) { return check(service.from('bookings').select('*').eq('id', id).single()) }
async function attempt(id) { return check(service.from('coaching_payment_attempts').select('*').eq('id', id).single()) }
async function waitFor(label, fn, timeout = 60000) {
  const until = Date.now() + timeout
  let printed = Date.now()
  while (Date.now() < until) {
    const value = await fn(); if (value) return value
    if (Date.now() - printed > 45000) { console.log(`WAIT ${label}`); printed = Date.now() }
    await sleep(2000)
  }
  throw Object.assign(new Error('Verification timed out'), { code: label.replaceAll(' ', '_') })
}
async function book(time, requestId = randomUUID()) {
  const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const body = { creatorId: coach.id, date, time, name: 'Synthetic lifecycle verification', email: buyer.email,
    expectedCancellationPolicyHours: 24, requestId }
  const response = await api('/api/coaching/book', buyer, body)
  assert.equal(response.status, 200)
  assert.ok(response.data.bookingId); if (!bookings.includes(response.data.bookingId)) bookings.push(response.data.bookingId)
  const saved = await row(response.data.bookingId); if (saved.stripe_checkout_session_id) sessions.add(saved.stripe_checkout_session_id)
  return { row: saved, body, response }
}
async function confirm(saved, paymentMethod = 'pm_card_visa', expectedFailure = false) {
  const session = await stripe.checkout.sessions.retrieve(saved.stripe_checkout_session_id)
  assert.equal(session.livemode, false); assert.equal(session.status, 'open')
  assert.equal(session.metadata.booking_id, saved.id); assert.equal(session.metadata.buyer_id, buyer.id)
  assert.equal(session.metadata.payment_attempt_id, saved.current_payment_attempt_id)
  assert.equal(session.amount_total, saved.price_cents)
  // Official stripe-cli fixture endpoints; never a client-supplied webhook.
  if (paymentMethod === 'pm_card_visa' || paymentMethod === 'pm_card_chargeDeclined') {
    const method = await stripe.paymentMethods.create({ type: 'card',
      card: { token: paymentMethod === 'pm_card_visa' ? 'tok_visa' : 'tok_chargeDeclined' },
      billing_details: { email: buyer.email, name: 'Synthetic lifecycle verification' } })
    paymentMethod = method.id
  }
  await stripe.rawRequest('GET', `/v1/payment_pages/${session.id}`)
  let failure = null
  try { await stripe.rawRequest('POST', `/v1/payment_pages/${session.id}/confirm`, {
    payment_method: paymentMethod, expected_amount: session.amount_total,
  }) } catch (error) { failure = error }
  if (expectedFailure) assert.ok(failure && ['card_declined', 'insufficient_funds'].includes(failure.code))
  else if (failure) throw failure
  const fresh = await stripe.checkout.sessions.retrieve(session.id)
  const pi = objectId(fresh.payment_intent); if (pi) intentIds.add(pi)
  return fresh
}
async function paid(saved) {
  return waitFor('paid_booking', async () => { const fresh = await row(saved.id); return fresh.status === 'confirmed' && fresh.payment_status === 'paid' ? fresh : null })
}
async function trackIntent(saved) {
  const session = await stripe.checkout.sessions.retrieve(saved.stripe_checkout_session_id)
  const pi = objectId(session.payment_intent); if (pi) intentIds.add(pi)
  return pi
}
async function releaseSyntheticHold(saved) {
  assert.ok(bookings.includes(saved.id)); const fresh = await row(saved.id)
  assert.equal(fresh.status, 'pending_payment'); assert.ok(!fresh.fulfilled_payment_attempt_id)
  // Inject a historical reservation-release condition on this owned fixture.
  // Provider-paid state is never fabricated: the real Checkout still must pay.
  await check(service.from('bookings').update({ status: 'expired', payment_status: 'expired',
    reservation_expires_at: new Date(Date.now() - 60000).toISOString() }).eq('id', saved.id).eq('buyer_id', buyer.id))
}
async function secondBuyerOccupies(saved) {
  const inserted = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: foreign.id,
    buyer_name: 'Synthetic competing booking', buyer_email: foreign.email, scheduled_at: saved.scheduled_at,
    duration_minutes: saved.duration_minutes, price_cents: 0, status: 'confirmed', payment_status: 'not_required' }).select('*').single())
  bookings.push(inserted.id); return inserted
}
async function asyncCheckout(time, iban) {
  const scheduled = new Date(Date.now() + 15 * 86400000); scheduled.setUTCHours(time, 0, 0, 0)
  const saved = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: buyer.id,
    buyer_name: 'Synthetic lifecycle verification', buyer_email: buyer.email, scheduled_at: scheduled.toISOString(),
    duration_minutes: 5, price_cents: 500, status: 'pending_payment', payment_status: 'pending', stripe_livemode: false,
    reservation_expires_at: new Date(Date.now() + 1860000).toISOString() }).select('*').single())
  bookings.push(saved.id)
  const claim = await check(service.rpc('begin_coaching_payment_attempt', { p_booking_id: saved.id,
    p_buyer_id: buyer.id, p_livemode: false, p_expires_at: saved.reservation_expires_at }))
  const a = claim.attempt
  const metadata = { checkout_type: 'coaching_session', booking_id: saved.id, buyer_id: buyer.id,
    creator_id: coach.id, payment_attempt_id: a.id, ardore_synthetic_run: run }
  const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['sepa_debit'],
    customer_email: buyer.email, metadata, payment_intent_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 500, product_data: { name: 'Synthetic lifecycle verification' } } }],
    expires_at: Math.floor(new Date(saved.reservation_expires_at).getTime() / 1000),
    success_url: `${base}/buyer/sessions`, cancel_url: `${base}/buyer/sessions` }, { idempotencyKey: a.checkout_idempotency_key })
  sessions.add(session.id)
  await check(service.rpc('register_coaching_checkout', { p_attempt_id: a.id, p_session_id: session.id, p_session_url: session.url }))
  const method = await stripe.paymentMethods.create({ type: 'sepa_debit', sepa_debit: { iban },
    billing_details: { email: buyer.email, name: 'Synthetic lifecycle verification' } })
  return { row: await row(saved.id), method: method.id }
}
async function replay(event) {
  assert.equal(event.livemode, false)
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  const endpoint = endpoints.data.find(item => item.url === `${base}/api/webhooks/stripe` && item.status === 'enabled')
  assert.ok(endpoint)
  cliDirectory ??= mkdtempSync(join(tmpdir(), 'ardore-lifecycle-stripe-cli-'))
  const response = spawnSync('/opt/homebrew/bin/stripe', ['events', 'resend', event.id, '--webhook-endpoint', endpoint.id], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY,
      XDG_CONFIG_HOME: cliDirectory }, maxBuffer: 1000000 })
  assert.equal(response.status, 0)
}
async function eventsFor(saved, type) {
  const pi = await trackIntent(saved)
  const events = await stripe.events.list({ type, created: { gte: startedAt }, limit: 100 })
  return events.data.filter(event => event.data.object.metadata?.booking_id === saved.id
    || event.data.object.id === pi || event.data.object.id === saved.stripe_checkout_session_id)
}
async function tests() {
  foreign = await syntheticUser('buyer')
  coach = await check(service.from('creator_profiles').insert({ user_id: coachActor.id,
    display_name: 'Synthetic lifecycle verification', slug: run }).select('id').single())
  await check(service.from('coaching_offers').insert({ creator_id: coach.id, is_enabled: true, price_cents: 500,
    duration_minutes: 5, min_notice_hours: 0, cancellation_policy_hours: 24 }))
  await check(service.from('availability_slots').insert(Array.from({ length: 7 }, (_, day_of_week) => ({
    creator_id: coach.id, day_of_week, start_time: '08:00', end_time: '20:00' }))))
  const normal = await book('10:00')
  const repeated = await Promise.all([api('/api/coaching/book', buyer, normal.body), api('/api/coaching/book', buyer, normal.body)])
  assert.ok(repeated.every(value => value.status === 200 && value.data.bookingId === normal.row.id
    && value.data.checkoutUrl === normal.response.data.checkoutUrl))
  assert.equal((await check(service.from('coaching_payment_attempts').select('id').eq('booking_id', normal.row.id))).length, 1)
  pass('repeated booking request creates one booking and one Checkout attempt')
  assert.equal((await api('/api/coaching/retry', foreign, { bookingId: normal.row.id })).status, 404)
  assert.ok((await buyer.client.from('bookings').update({ payment_status: 'paid', status: 'confirmed' }).eq('id', normal.row.id)).error)
  assert.ok((await buyer.client.from('coaching_payment_attempts').select('*')).error)
  assert.ok((await buyer.client.rpc('observe_coaching_payment_attempt', {})).error)
  pass('foreign retry and client payment/attempt authority denied')
  await confirm(normal.row); const normalPaid = await paid(normal.row)
  assert.equal(normalPaid.amount_paid_cents, 500)
  const secondCharge = await api('/api/coaching/retry', buyer, { bookingId: normal.row.id })
  assert.equal(secondCharge.data.confirmed, true); assert.ok(!secondCharge.data.checkoutUrl)
  const completed = await eventsFor(normal.row, 'checkout.session.completed'); assert.ok(completed.length)
  await replay(completed[0]); await replay(completed[0]); await sleep(3000)
  assert.equal((await row(normal.row.id)).fulfilled_payment_attempt_id, normalPaid.fulfilled_payment_attempt_id)
  assert.equal((await check(service.from('coaching_payment_attempts').select('id').eq('booking_id', normal.row.id))).length, 1)
  pass('real provider success confirms once; duplicate completed delivery does not create another booking/payment')

  const failed = await book('11:00')
  await confirm(failed.row, 'pm_card_chargeDeclined', true)
  await waitFor('failed_open_checkout', async () => { const value = await row(failed.row.id); return value.status === 'pending_payment' && value.payment_status === 'failed' })
  const retry = await api('/api/coaching/retry', buyer, { bookingId: failed.row.id })
  assert.equal(retry.status, 200); assert.equal(retry.data.bookingId, failed.row.id)
  assert.equal(retry.data.checkoutUrl, failed.response.data.checkoutUrl)
  await confirm(failed.row); const afterRetry = await paid(failed.row)
  const failures = await eventsFor(failed.row, 'payment_intent.payment_failed'); assert.ok(failures.length)
  await replay(failures[0]); await replay(failures[0]); await sleep(3000)
  assert.equal((await row(failed.row.id)).payment_status, 'paid'); assert.equal((await row(failed.row.id)).fulfilled_payment_attempt_id, afterRetry.fulfilled_payment_attempt_id)
  assert.equal((await check(service.from('coaching_payment_attempts').select('id').eq('booking_id', failed.row.id))).length, 1)
  pass('actual declined card retains hold; customer retry succeeds; late duplicated failure cannot undo payment')

  const expired = await book('12:00')
  await stripe.checkout.sessions.expire(expired.row.stripe_checkout_session_id)
  await waitFor('checkout_expired', async () => (await row(expired.row.id)).status === 'expired')
  await check(coachActor.client.from('coaching_offers').update({ price_cents: 800, cancellation_policy_hours: 48 }).eq('creator_id', coach.id))
  const retries = await Promise.all([api('/api/coaching/retry', buyer, { bookingId: expired.row.id }), api('/api/coaching/retry', buyer, { bookingId: expired.row.id })])
  assert.ok(retries.every(value => value.status === 200)); assert.equal(retries[0].data.checkoutUrl, retries[1].data.checkoutUrl)
  const retryRow = await row(expired.row.id); sessions.add(retryRow.stripe_checkout_session_id)
  assert.notEqual(retryRow.current_payment_attempt_id, expired.row.current_payment_attempt_id)
  assert.equal(retryRow.price_cents, 500); assert.equal(retryRow.cancellation_policy_hours, 24)
  assert.equal((await check(service.from('coaching_payment_attempts').select('id').eq('booking_id', expired.row.id))).length, 2)
  await confirm(retryRow); await paid(retryRow)
  const expirations = await eventsFor(expired.row, 'checkout.session.expired'); assert.ok(expirations.length)
  await replay(expirations[0]); await sleep(3000)
  assert.equal((await row(expired.row.id)).payment_status, 'paid')
  pass('expiration releases hold; concurrent retry has one new Checkout with agreed price/cutoff; late old expiry harmless')
  await check(coachActor.client.from('coaching_offers').update({ price_cents: 500, cancellation_policy_hours: 24 }).eq('creator_id', coach.id))

  const late = await book('13:00'); await releaseSyntheticHold(late.row); await confirm(late.row); await paid(late.row)
  pass('real delayed success restores an available released reservation atomically')
  const conflict = await book('14:00'); await releaseSyntheticHold(conflict.row)
  const occupied = await secondBuyerOccupies(conflict.row)
  await confirm(conflict.row)
  await waitFor('late_conflict_full_refund', async () => { const value = await attempt(conflict.row.current_payment_attempt_id); return value.refund_status === 'succeeded' && value.fulfillment_state === 'reconciled' ? value : null })
  const conflictAttempt = await attempt(conflict.row.current_payment_attempt_id)
  assert.equal(conflictAttempt.reconciliation_reason, 'slot_unavailable'); assert.equal(conflictAttempt.amount_refunded_cents, 500)
  assert.equal((await row(occupied.id)).status, 'confirmed'); assert.equal((await row(conflict.row.id)).status, 'refunded')
  const refunds = await stripe.refunds.list({ payment_intent: conflictAttempt.stripe_payment_intent_id })
  assert.equal(refunds.data.length, 1); assert.equal(refunds.data[0].amount, 500)
  const conflictSuccess = await eventsFor(conflict.row, 'checkout.session.completed'); await replay(conflictSuccess[0]); await sleep(3000)
  assert.equal((await stripe.refunds.list({ payment_intent: conflictAttempt.stripe_payment_intent_id })).data.length, 1)
  pass('real paid occupied-slot conflict creates one full refund, no double booking; webhook replay no duplicate refund')

  const delayed = await asyncCheckout(10, 'AT611904300234573201')
  await confirm(delayed.row, delayed.method)
  const asyncRow = await paid(delayed.row)
  assert.equal(asyncRow.amount_paid_cents, 500)
  pass('actual asynchronous TEST Checkout confirms only after Stripe succeeds')
  const asynchronousConflict = await asyncCheckout(11, 'AT611904300234573201')
  await releaseSyntheticHold(asynchronousConflict.row); const asyncOccupied = await secondBuyerOccupies(asynchronousConflict.row)
  await confirm(asynchronousConflict.row, asynchronousConflict.method)
  await waitFor('async_conflict_refund', async () => {
    const value = await attempt(asynchronousConflict.row.current_payment_attempt_id)
    return value.refund_status === 'succeeded' && value.amount_refunded_cents === 500 ? value : null
  }, 180000)
  assert.equal((await row(asyncOccupied.id)).status, 'confirmed')
  assert.equal((await stripe.refunds.list({ payment_intent: await trackIntent(asynchronousConflict.row) })).data.length, 1)
  pass('actual asynchronous late payment on an occupied slot receives full reconciliation without double booking')
  const bankFailed = await asyncCheckout(12, 'IT60X0542811101000000123456')
  await confirm(bankFailed.row, bankFailed.method)
  await waitFor('async_bank_failed', async () => (await row(bankFailed.row.id)).status === 'payment_failed', 180000)
  const bankRetry = await api('/api/coaching/retry', buyer, { bookingId: bankFailed.row.id })
  assert.equal(bankRetry.status, 200); const bankRetryRow = await row(bankFailed.row.id); sessions.add(bankRetryRow.stripe_checkout_session_id)
  assert.notEqual(bankRetryRow.current_payment_attempt_id, bankFailed.row.current_payment_attempt_id)
  await confirm(bankRetryRow); await paid(bankRetryRow)
  pass('actual asynchronous failure releases hold and later retry fulfills same booking once')
}
async function cleanup() {
  const errors = []
  for (const sessionId of sessions) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId); assert.equal(session.livemode, false)
      assert.ok(bookings.includes(session.metadata?.booking_id))
      if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId)
      const pi = objectId(session.payment_intent); if (pi) intentIds.add(pi)
    } catch (error) { errors.push(`checkout:${error.code ?? error.name}`) }
  }
  for (const pi of intentIds) {
    try {
      const intent = await stripe.paymentIntents.retrieve(pi); assert.equal(intent.livemode, false)
      assert.ok(bookings.includes(intent.metadata.booking_id)); assert.equal(intent.metadata.buyer_id, buyer.id)
      if (intent.status === 'processing') throw Object.assign(new Error('Retain processing fixture'), { code: 'payment_still_processing' })
      const chargeId = objectId(intent.latest_charge)
      if (chargeId) {
        chargeIds.add(chargeId); const charge = await stripe.charges.retrieve(chargeId)
        if (charge.paid && charge.amount_refunded < charge.amount_captured) await stripe.refunds.create({ payment_intent: pi,
          ...(charge.transfer ? { reverse_transfer: true, refund_application_fee: Boolean(charge.application_fee) } : {}),
          metadata: { ardore_synthetic_run: run, cleanup: 'true' } }, { idempotencyKey: `${run}-${pi}-cleanup` })
      }
      await stripe.paymentIntents.update(pi, { metadata: { ardore_synthetic_run: run, ardore_synthetic_cleanup: 'completed' } })
    } catch (error) { errors.push(`payment:${error.code ?? error.name}`) }
  }
  if (errors.length) { console.log(JSON.stringify({ cleanupBlocked: errors })); return false }
  if (intentIds.size) await sleep(5000)
  if (bookings.length) {
    await check(service.from('booking_refunds').delete().in('booking_id', bookings))
    await check(service.from('bookings').delete().in('id', bookings))
  }
  if (coach) {
    for (const table of ['bookings', 'messages', 'subscriptions']) {
      const { count, error } = await service.from(table).select('id', { count: 'exact', head: true }).eq('creator_id', coach.id)
      if (error || count) throw new Error('Unowned interaction preserved')
    }
    for (const table of ['availability_slots', 'coaching_offers', 'creator_profiles']) await check(service.from(table).delete().eq(table === 'creator_profiles' ? 'id' : 'creator_id', coach.id))
  }
  if (users.length) await check(service.from('notifications').delete().in('user_id', users))
  for (const userId of users) { const deleted = await service.auth.admin.deleteUser(userId); if (deleted.error) throw new Error('GoTrue cleanup failed') }
  const events = await stripe.events.list({ created: { gte: startedAt }, limit: 100 }).autoPagingToArray({ limit: 1000 })
  const ownedEvents = events.filter(event => {
    const object = event.data.object
    return bookings.includes(object.metadata?.booking_id) || intentIds.has(object.id) || sessions.has(object.id)
      || chargeIds.has(object.id) || chargeIds.has(objectId(object.charge))
  }).map(event => event.id)
  if (ownedEvents.length) await check(service.from('stripe_webhook_events').delete().in('event_id', ownedEvents))
  if (cliDirectory) rmSync(cliDirectory, { recursive: true, force: true })
  return true
}
try {
  buyer = await syntheticUser('buyer'); coachActor = await syntheticUser('creator')
  console.log(JSON.stringify({ syntheticBuyer: buyer.id, syntheticCoach: coachActor.id }))
  console.log('Waiting for SQL fixture checks and verified deployment; enter run or cleanup.')
  const command = await input.question('')
  if (command.trim() === 'run') await tests()
  else assert.equal(command.trim(), 'cleanup')
} catch (error) {
  console.error(JSON.stringify({ failedAfter: results.at(-1) ?? 'setup', code: error.code ?? error.name,
    location: error.stack?.split('\n').find(line => line.includes('test-synthetic-coaching-payment-lifecycle.mjs:'))?.trim() }))
  process.exitCode = 1
} finally {
  try { console.log(JSON.stringify({ passed: results.length, mutableSyntheticDataCleaned: await cleanup() })) }
  catch (error) { console.error(JSON.stringify({ cleanupError: error.code ?? error.name })); process.exitCode = 1 }
  input.close()
}
