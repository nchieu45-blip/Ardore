// Explicitly opt-in production verification using synthetic users and Stripe TEST
// payments only. Credentials and auth cookies stay in memory; cleanup is scoped
// exclusively to IDs created by this execution. Stripe retains immutable test
// payment/refund history; all mutable test accounts/DB records are removed.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import Stripe from 'stripe'

if (!process.argv.includes('--run-production-synthetic')) {
  console.log('Skipped: requires --run-production-synthetic and local TEST credentials.')
  process.exit(0)
}
process.loadEnvFile('.env.local')
const base = 'https://www.ardore-health.com'
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'yboeyxqeileicecqpwke.supabase.co')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'TEST key required')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })
const run = `ardore-refund-${randomUUID()}`
const startedAt = Math.floor(Date.now() / 1000)
const users = [], bookings = [], intents = [], sessions = []
let coach, connectedAccount
const results = []
const check = async query => { const result = await query; if (result.error) throw new Error(`Database operation failed: ${result.error.code}`); return result.data }
const pass = label => { results.push(label); console.log(`PASS ${label}`) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const id = object => typeof object === 'string' ? object : object?.id

async function syntheticUser(role) {
  const email = `delivered+${run}-${role}@resend.dev`
  const password = randomBytes(32).toString('base64url')
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { role, full_name: 'Synthetic refund verification' } })
  if (result.error) throw new Error(`Synthetic user creation failed: ${result.error.code}`)
  users.push(result.data.user.id)
  const jar = new Map()
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: cookies => cookies.forEach(cookie => jar.set(cookie.name, cookie.value)) },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error('Synthetic login failed')
  return { userId: result.data.user.id, email, client,
    cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }
}
async function api(path, actor, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Cookie: actor.cookie(), Origin: base,
  }, body: JSON.stringify(body), redirect: 'manual' })
  const data = await response.json()
  return { status: response.status, data }
}
async function booking(buyer, { hours = 72, free = false, completed = false } = {}) {
  const data = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: buyer.userId,
    buyer_email: buyer.email, buyer_name: 'Synthetic refund verification',
    scheduled_at: new Date(Date.now() + hours * 3600000).toISOString(), duration_minutes: 5,
    price_cents: free ? 0 : 500, status: completed ? 'completed' : 'confirmed',
    payment_status: free ? 'not_required' : 'paid', stripe_livemode: free ? null : false,
  }).select('*').single())
  bookings.push(data.id)
  return data
}
async function pay(row, destination) {
  const payment = await stripe.paymentIntents.create({ amount: row.price_cents, currency: 'eur',
    payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { checkout_type: 'coaching_session', booking_id: row.id, buyer_id: row.buyer_id,
      creator_id: row.creator_id, ardore_synthetic_run: run },
    ...(destination ? { application_fee_amount: 50, transfer_data: { destination } } : {}),
  }, { idempotencyKey: `${run}-${row.id}-payment` })
  assert.equal(payment.livemode, false)
  assert.equal(payment.status, 'succeeded')
  intents.push(payment.id)
  return check(service.from('bookings').update({ stripe_payment_intent_id: payment.id,
    amount_paid_cents: payment.amount_received }).eq('id', row.id).select('*').single())
}
async function refundState(row) {
  return check(service.from('booking_refunds').select('*').eq('booking_id', row.id).single())
}
async function verifyFullRefund(row, owner) {
  const ledger = await refundState(row)
  assert.equal(ledger.state, 'succeeded')
  assert.equal(ledger.amount_cents, 500)
  assert.equal(ledger.processing_fee_cost_owner, owner)
  const saved = await check(service.from('bookings').select('*').eq('id', row.id).single())
  assert.equal(saved.status, 'cancelled'); assert.equal(saved.payment_status, 'refunded')
  assert.equal(saved.refund_status, 'succeeded'); assert.equal(saved.amount_refunded_cents, 500)
  const list = await stripe.refunds.list({ payment_intent: row.stripe_payment_intent_id })
  assert.equal(list.data.length, 1); assert.equal(list.data[0].amount, 500)
  assert.equal(list.data[0].status, 'succeeded'); assert.equal(list.data[0].id, ledger.stripe_refund_id)
  return ledger
}

try {
  const buyer = await syntheticUser('buyer')
  const coachUser = await syntheticUser('creator')
  const foreign = await syntheticUser('buyer')
  coach = await check(service.from('creator_profiles').insert({ user_id: coachUser.userId,
    display_name: 'Synthetic refund verification', slug: run }).select('id').single())
  await check(service.from('coaching_offers').insert({ creator_id: coach.id, is_enabled: true,
    price_cents: 500, duration_minutes: 5, min_notice_hours: 0, cancellation_policy_hours: 24 }))
  await check(service.from('availability_slots').insert(Array.from({ length: 7 }, (_, day_of_week) => ({
    creator_id: coach.id, day_of_week, start_time: '08:00', end_time: '20:00',
  }))))

  // The actual production booking endpoint must store the displayed cutoff.
  const date = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  const created = await api('/api/coaching/book', buyer, { creatorId: coach.id, date, time: '10:00',
    name: 'Synthetic refund verification', email: buyer.email, expectedCancellationPolicyHours: 24 })
  assert.equal(created.status, 200)
  bookings.push(created.data.bookingId)
  const old = await check(service.from('bookings').select('*').eq('id', created.data.bookingId).single())
  sessions.push(old.stripe_checkout_session_id)
  assert.equal(old.cancellation_policy_hours, 24)
  await check(coachUser.client.from('coaching_offers').update({ cancellation_policy_hours: 48, price_cents: 600 }).eq('creator_id', coach.id))
  const changed = await api('/api/coaching/book', buyer, { creatorId: coach.id, date, time: '11:00',
    name: 'Synthetic refund verification', email: buyer.email, expectedCancellationPolicyHours: 24 })
  assert.equal(changed.status, 409)
  const newer = await api('/api/coaching/book', buyer, { creatorId: coach.id, date, time: '11:00',
    name: 'Synthetic refund verification', email: buyer.email, expectedCancellationPolicyHours: 48 })
  assert.equal(newer.status, 200)
  bookings.push(newer.data.bookingId)
  const newRow = await check(service.from('bookings').select('*').eq('id', newer.data.bookingId).single())
  sessions.push(newRow.stripe_checkout_session_id)
  assert.equal(newRow.cancellation_policy_hours, 48); assert.equal(newRow.price_cents, 600)
  assert.equal((await check(service.from('bookings').select('cancellation_policy_hours').eq('id', old.id).single())).cancellation_policy_hours, 24)
  const immutable = await service.from('bookings').update({ cancellation_policy_hours: 12 }).eq('id', old.id)
  assert.equal(immutable.error?.code, '23514')
  pass('old cutoff preserved; new booking uses new cutoff; coach pricing remains editable; policy-change guard')
  await check(coachUser.client.from('coaching_offers').update({ cancellation_policy_hours: 24, price_cents: 500 }).eq('creator_id', coach.id))

  const eligible = await pay(await booking(buyer))
  assert.equal((await api('/api/coaching/cancel', foreign, { bookingId: eligible.id })).status, 403)
  const spoof = await buyer.client.from('bookings').update({ payment_status: 'refunded', refund_status: 'succeeded' }).eq('id', eligible.id)
  assert.ok(spoof.error)
  const rpcSpoof = await buyer.client.rpc('cancel_coaching_booking', { p_booking_id: eligible.id, p_actor_user_id: coachUser.userId })
  assert.ok(rpcSpoof.error)
  const deleted = await api('/api/account/delete', buyer, {})
  assert.equal(deleted.status, 409)
  pass('foreign-user/client authority denied; account deletion preserves financial records')
  const cancel = await api('/api/coaching/cancel', buyer, { bookingId: eligible.id })
  assert.equal(cancel.status, 200); assert.equal(cancel.data.refundStatus, 'succeeded')
  await verifyFullRefund(eligible, 'platform')
  const repeated = await Promise.all(Array.from({ length: 3 }, () => api('/api/coaching/cancel', buyer, { bookingId: eligible.id })))
  assert.ok(repeated.every(result => result.status === 200))
  await verifyFullRefund(eligible, 'platform')
  const visible = await check(buyer.client.from('booking_refunds').select('booking_id,state,amount_cents').eq('booking_id', eligible.id))
  assert.equal(visible.length, 1)
  assert.ok((await buyer.client.from('booking_refunds').select('processing_fee_cents').eq('booking_id', eligible.id)).error)
  assert.equal((await check(foreign.client.from('booking_refunds').select('booking_id,state,amount_cents').eq('booking_id', eligible.id))).length, 0)
  pass('customer full refund and repeated cancellation yield exactly one refund; participant ledger access scoped')

  const late = await pay(await booking(buyer, { hours: 12 }))
  assert.equal((await api('/api/coaching/cancel', buyer, { bookingId: late.id })).status, 403)
  assert.equal((await stripe.refunds.list({ payment_intent: late.stripe_payment_intent_id })).data.length, 0)
  assert.equal((await check(service.from('bookings').select('status').eq('id', late.id).single())).status, 'confirmed')
  pass('late customer cancellation refused without refund or booking mutation')
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: late.id })).status, 200)
  await verifyFullRefund(late, 'coach')
  pass('coach cancellation after customer cutoff refunds full actual payment')
  const coachEarly = await pay(await booking(buyer, { hours: 75 }))
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: coachEarly.id })).status, 200)
  await verifyFullRefund(coachEarly, 'coach')
  pass('coach cancellation before appointment refunds full actual payment')
  const ongoing = await pay(await booking(buyer, { hours: -0.01 }))
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: ongoing.id })).status, 200)
  await verifyFullRefund(ongoing, 'coach')
  pass('coach can abort ongoing not-yet-delivered session with full refund')

  const free = await booking(buyer, { hours: 80, free: true })
  const freeCancel = await api('/api/coaching/cancel', buyer, { bookingId: free.id })
  assert.equal(freeCancel.status, 200); assert.equal(freeCancel.data.refundStatus, 'not_requested')
  assert.equal((await check(service.from('booking_refunds').select('booking_id').eq('booking_id', free.id))).length, 0)
  pass('free booking cancellation has no refund request')
  const completed = await booking(buyer, { hours: 82, completed: true })
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: completed.id })).status, 400)
  pass('completed booking cannot enter automatic cancellation refund')
  const unavailable = await booking(buyer, { hours: 85 })
  await check(service.from('bookings').update({ stripe_payment_intent_id: 'pi_ardore_synthetic_missing' }).eq('id', unavailable.id))
  const failure = await api('/api/coaching/cancel', buyer, { bookingId: unavailable.id })
  assert.equal(failure.status, 503); assert.equal(failure.data.refundStatus, 'failed')
  assert.equal((await refundState(unavailable)).state, 'failed')
  const failedPayment = await check(service.from('bookings').select('payment_status,amount_refunded_cents').eq('id', unavailable.id).single())
  assert.equal(failedPayment.payment_status, 'paid'); assert.equal(failedPayment.amount_refunded_cents, 0)
  pass('Stripe API failure keeps payment paid and refund failed, without false success')

  // A fresh synthetic TEST connected account validates the live-style
  // destination architecture without altering any coach's Connect configuration.
  connectedAccount = await stripe.accounts.create({ type: 'custom', country: 'DE',
    business_type: 'individual', email: coachUser.email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { mcc: '7299', url: base, product_description: 'Synthetic test coaching' },
    individual: { first_name: 'Synthetic', last_name: 'Verification', email: coachUser.email,
      phone: '+4915112345678', dob: { day: 1, month: 1, year: 1990 },
      address: { line1: 'Teststrasse 1', city: 'Berlin', postal_code: '10115', country: 'DE' } },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
    metadata: { ardore_synthetic_run: run },
  })
  const destinationBooking = await pay(await booking(buyer, { hours: 90 }), connectedAccount.id)
  const destCancel = await api('/api/coaching/cancel', coachUser, { bookingId: destinationBooking.id })
  assert.equal(destCancel.status, 200)
  const destLedger = await verifyFullRefund(destinationBooking, 'coach')
  assert.equal(destLedger.transfer_status, 'succeeded')
  assert.ok(destLedger.transfer_reversal_ids.length > 0); assert.ok(destLedger.application_fee_refund_ids.length > 0)
  const transfer = await stripe.transfers.retrieve(destLedger.stripe_transfer_id)
  assert.equal(transfer.amount_reversed, transfer.amount)
  const charge = await stripe.charges.retrieve(id((await stripe.paymentIntents.retrieve(destinationBooking.stripe_payment_intent_id)).latest_charge))
  const fee = await stripe.applicationFees.retrieve(id(charge.application_fee))
  assert.equal(fee.amount_refunded, fee.amount)
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: destinationBooking.id })).status, 200)
  assert.equal((await stripe.refunds.list({ payment_intent: destinationBooking.stripe_payment_intent_id })).data.length, 1)
  pass('actual Stripe TEST destination refund reverses associated transfer and entire application fee exactly once')

  // Provider-generated events, not forged unsigned requests, must reach the app.
  let acceptedEvent = false
  for (let attempt = 0; attempt < 18; attempt++) {
    const events = await stripe.events.list({ type: 'charge.refunded', limit: 100 })
    const event = events.data.find(event => event.data.object.metadata?.booking_id === eligible.id)
    if (event) {
      const stored = await check(service.from('stripe_webhook_events').select('event_id').eq('event_id', event.id))
      if (stored.length === 1) { acceptedEvent = true; break }
    }
    await sleep(5000)
  }
  assert.ok(acceptedEvent, 'Provider webhook must be accepted by deployed application')
  pass('Stripe-generated refund webhook accepted by deployed production endpoint')
} catch (error) {
  console.error(JSON.stringify({ failedAfter: results.at(-1) ?? 'setup', code: error.code ?? error.name, location: error.stack?.split('\n').find(line => line.includes('test-synthetic-coaching-refunds.mjs:'))?.trim() }))
  process.exitCode = 1
} finally {
  const cleanupErrors = []
  for (const sessionId of sessions.filter(Boolean)) {
    try { const session = await stripe.checkout.sessions.retrieve(sessionId); if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId) }
    catch (error) { cleanupErrors.push(`checkout:${error.code ?? error.type}`) }
  }
  for (const intentId of intents) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId)
      assert.equal(intent.livemode, false); assert.equal(intent.metadata.ardore_synthetic_run, run)
      const charge = await stripe.charges.retrieve(id(intent.latest_charge))
      if (charge.amount_refunded < charge.amount_captured) {
        await stripe.refunds.create({ payment_intent: intent.id,
          ...(charge.transfer ? { reverse_transfer: true, refund_application_fee: Boolean(charge.application_fee) } : {}),
          metadata: { ardore_synthetic_run: run, cleanup: 'true' } }, { idempotencyKey: `${run}-${intent.id}-cleanup` })
      }
      await stripe.paymentIntents.update(intent.id, { metadata: { ardore_synthetic_cleanup: 'completed' } })
    } catch (error) { cleanupErrors.push(`payment:${error.code ?? error.type}`) }
  }
  // Let in-flight webhook handlers finish before removing fixture rows.
  if (intents.length) await sleep(5000)
  if (bookings.length) {
    try { await check(service.from('booking_refunds').delete().in('booking_id', bookings)); await check(service.from('bookings').delete().in('id', bookings)) }
    catch (error) { cleanupErrors.push(error.name) }
  }
  if (coach) {
    for (const table of ['availability_slots', 'coaching_offers', 'creator_profiles']) {
      try { await check(service.from(table).delete().eq(table === 'creator_profiles' ? 'id' : 'creator_id', coach.id)) }
      catch (error) { cleanupErrors.push(`${table}:${error.name}`) }
    }
  }
  if (users.length) {
    try { await check(service.from('notifications').delete().in('user_id', users)) } catch (error) { cleanupErrors.push(error.name) }
    for (const userId of users) {
      try { const result = await service.auth.admin.deleteUser(userId); if (result.error) throw new Error('Auth cleanup failed') }
      catch (error) { cleanupErrors.push(error.name) }
    }
  }
  if (connectedAccount) {
    try { await stripe.accounts.del(connectedAccount.id) } catch (error) { cleanupErrors.push(`connect:${error.code ?? error.type}`) }
  }
  try {
    const events = await stripe.events.list({ created: { gte: startedAt }, limit: 100 }).autoPagingToArray({ limit: 1000 })
    const owned = events.filter(event => {
      const object = event.data.object
      return object.metadata?.ardore_synthetic_run === run || bookings.includes(object.metadata?.booking_id)
        || intents.includes(object.id) || sessions.includes(object.id)
    }).map(event => event.id)
    if (owned.length) await check(service.from('stripe_webhook_events').delete().in('event_id', owned))
  } catch (error) { cleanupErrors.push(`event_cleanup:${error.code ?? error.name}`) }
  console.log(JSON.stringify({ passed: results.length, mutableSyntheticDataCleaned: cleanupErrors.length === 0, cleanupErrors }))
  if (cleanupErrors.length) process.exitCode = 1
}
