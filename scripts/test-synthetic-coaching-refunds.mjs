// Explicitly opt-in production verification using synthetic users and Stripe TEST
// payments only. Credentials and auth cookies stay in memory; cleanup is scoped
// exclusively to IDs created by this execution. Stripe retains immutable test
// payment/refund history; all mutable test accounts/DB records are removed.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import Stripe from 'stripe'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const run = `ardore-refund-${randomUUID().slice(0, 12)}`
const startedAt = Math.floor(Date.now() / 1000)
const users = [], bookings = [], intents = [], sessions = []
const ownedChargeIds = new Set()
const intentionallyFailedRefundIntents = new Set()
let coach, connectedAccount, cliDirectory, coachUserIdForCleanup
let transferVerification = 'not_run'
let asynchronousFailureVerification = 'not_run'
let captureResumeVerification = 'not_run'
const results = []
const check = async query => { const result = await query; if (result.error) throw new Error(`Database operation failed: ${result.error.code}`); return result.data }
const pass = label => { results.push(label); console.log(`PASS ${label}`) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const id = object => typeof object === 'string' ? object : object?.id

async function syntheticUser(role) {
  const email = `delivered+${run}-${role}-${users.length}@resend.dev`
  const password = randomBytes(32).toString('base64url')
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { role, full_name: 'Synthetic refund verification' } })
  if (result.error) throw Object.assign(new Error('Synthetic user creation failed'), { code: result.error.code, authStatus: result.error.status })
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
async function pay(row, destination, paymentMethod = 'pm_card_visa') {
  const payment = await stripe.paymentIntents.create({ amount: row.price_cents, currency: 'eur',
    payment_method: paymentMethod, confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { checkout_type: 'coaching_session', booking_id: row.id, buyer_id: row.buyer_id,
      creator_id: row.creator_id, ardore_synthetic_run: run },
    ...(destination ? { application_fee_amount: 50, transfer_data: { destination } } : {}),
  }, { idempotencyKey: `${run}-${row.id}-payment` })
  intents.push(payment.id)
  if (id(payment.latest_charge)) ownedChargeIds.add(id(payment.latest_charge))
  assert.equal(payment.livemode, false)
  assert.equal(payment.status, 'succeeded')
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
  coachUserIdForCleanup = coachUser.userId
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
  const unavailableProvider = await service.rpc('apply_coaching_refund_state', {
    p_booking_id: eligible.id, p_state: { state: 'failed', last_error_code: 'synthetic_provider_outage' },
    p_payment_status: 'paid', p_amount_paid_cents: null, p_amount_refunded_cents: null,
    p_provider_checked_at: new Date().toISOString(),
  })
  assert.equal(unavailableProvider.error, null)
  assert.equal(unavailableProvider.data.applied, false)
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

  const undelivered = await pay(await booking(buyer, { hours: -3 }))
  assert.equal((await api('/api/coaching/cancel', coachUser, { bookingId: undelivered.id })).status, 200)
  await verifyFullRefund(undelivered, 'coach')
  pass('elapsed appointment time does not prevent full coach refund for an undelivered confirmed booking')

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
  try {
  // New sandbox integrations require Accounts v2. The payment/refund APIs
  // remain interoperable; no production coach account is created or linked.
  connectedAccount = await stripe.v2.core.accounts.create({ dashboard: 'none',
    display_name: 'Synthetic refund verification', contact_email: coachUser.email,
    identity: { country: 'DE', entity_type: 'individual',
      individual: { given_name: 'Synthetic', surname: 'Verification', email: coachUser.email,
        phone: '0000000000', date_of_birth: { day: 1, month: 1, year: 1902 },
        address: { line1: 'address_full_match', city: 'Berlin', postal_code: '10115', country: 'DE' },
        documents: { primary_verification: { type: 'front_back', front_back: { front: 'file_identity_document_success' } } } },
      attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '127.0.0.1' } } } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } }, mcc: '7299' },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      profile: { business_url: 'https://accessible.stripe.com', product_description: 'Synthetic test coaching' } },
    include: ['configuration.merchant', 'configuration.recipient'],
    metadata: { ardore_synthetic_run: run },
  })
  // Official public German TEST bank fixture, never a real payout account.
  await stripe.accounts.createExternalAccount(connectedAccount.id, { external_account: {
    object: 'bank_account', country: 'DE', currency: 'eur', account_holder_name: 'Synthetic Verification',
    account_holder_type: 'individual', account_number: 'DE89370400440532013000',
  } })
  } catch (error) {
    if (error.type !== 'StripeInvalidRequestError' || !error.message?.includes("signed up for Connect")) throw error
    transferVerification = 'not_applicable_connect_not_enabled'
    console.log('SKIP actual transfer rehearsal: Connect not enabled; deployed TEST checkouts use platform payments.')
  }

  // Stripe's documented asynchronous failure test card (ending 5126).
  // The provider initially succeeds, then emits refund.failed; fresh webhook
  // reconciliation must remove the false final paid/refunded assumption.
  const bankFailed = await pay(await booking(buyer, { hours: 88 }), undefined, 'pm_card_refundFail')
  intentionallyFailedRefundIntents.add(bankFailed.stripe_payment_intent_id)
  const bankResponse = await api('/api/coaching/cancel', buyer, { bookingId: bankFailed.id })
  assert.ok([200, 202, 503].includes(bankResponse.status))
  const bankLedger = await refundState(bankFailed)
  assert.ok(bankLedger.stripe_refund_id)
  let bankFailureReconciled = false
  for (let attempt = 0; attempt < 48; attempt++) {
    const provider = await stripe.refunds.retrieve(bankLedger.stripe_refund_id)
    const ledger = await refundState(bankFailed)
    if (provider.status === 'failed' && ledger.state === 'failed') { bankFailureReconciled = true; break }
    await sleep(5000)
  }
  if (!bankFailureReconciled) {
    const provider = await stripe.refunds.retrieve(bankLedger.stripe_refund_id)
    assert.notEqual(provider.status, 'failed', 'A real provider failure must reconcile; only a missing simulation event may remain pending')
    asynchronousFailureVerification = 'pending_provider_simulation'
    console.log('PENDING asynchronous bank-failure rehearsal: Stripe has not emitted refund.failed within the observation window.')
  } else {
    asynchronousFailureVerification = 'verified'
    const afterBankFailure = await check(service.from('bookings').select('status,payment_status,amount_refunded_cents').eq('id', bankFailed.id).single())
    assert.equal(afterBankFailure.status, 'cancelled'); assert.equal(afterBankFailure.payment_status, 'paid')
    assert.equal(afterBankFailure.amount_refunded_cents, 0)
    assert.equal((await api('/api/coaching/cancel', buyer, { bookingId: bankFailed.id })).status, 503)
    assert.equal((await stripe.refunds.list({ payment_intent: bankFailed.stripe_payment_intent_id })).data.length, 1)
    pass('actual asynchronous Stripe refund failure reconciles payment and does not generate a replacement refund')
  }

  for (const [path, actor] of [['/buyer/sessions', buyer], ['/creator/sessions', coachUser]]) {
    const page = await fetch(`${base}${path}`, { headers: { Cookie: actor.cookie() }, redirect: 'manual' })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes('Die Erstattung wurde von Stripe bestätigt'))
    assert.ok(html.includes('Die vollständige Erstattung konnte noch nicht abgeschlossen werden'))
  }
  const feeLedger = await refundState(eligible)
  assert.equal(feeLedger.processing_fee_accounting_status, 'recorded')
  assert.ok(Number.isInteger(feeLedger.processing_fee_cents) && feeLedger.processing_fee_cents >= 0)
  pass('buyer/coach production dashboards display confirmed and failed refunds; processing fees remain internal')

  if (connectedAccount) {
  assert.equal(connectedAccount.livemode, false)
  let transfersActive = false
  for (let attempt = 0; attempt < 12; attempt++) {
    const account = await stripe.v2.core.accounts.retrieve(connectedAccount.id, { include: ['configuration.recipient', 'requirements'] })
    if (account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active') { transfersActive = true; break }
    if (attempt === 11) console.log(JSON.stringify({ syntheticTransferCapability: account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status,
      requirementDeadline: account.requirements?.summary?.minimum_deadline?.status }))
    await sleep(5000)
  }
  if (!transfersActive) {
    transferVerification = 'pending_provider_verification'
    console.log('PENDING actual transfer rehearsal: Stripe has not activated the synthetic TEST recipient.')
    process.exitCode = 2
  } else {
  const destinationBooking = await pay(await booking(buyer, { hours: 90 }), connectedAccount.id)
  const destCancel = await api('/api/coaching/cancel', coachUser, { bookingId: destinationBooking.id })
  if (![200, 202].includes(destCancel.status)) {
    const observed = await refundState(destinationBooking)
    console.log(JSON.stringify({ syntheticDestinationFinalStatus: destCancel.status,
      finalRefundErrorCode: observed.last_error_code }))
  }
  assert.ok([200, 202].includes(destCancel.status))
  if (destCancel.status === 202) {
    assert.equal(destCancel.data.refundStatus, 'pending')
    let completedByWebhook = false
    const observedCaptureStates = new Set()
    for (let attempt = 0; attempt < 30; attempt++) {
      const observed = await refundState(destinationBooking)
      observedCaptureStates.add(`${observed.state}:${observed.last_error_code ?? 'none'}`)
      if (observed.state === 'succeeded') { completedByWebhook = true; break }
      // Stripe's charge, refund, transfer and fee reads are separate observations.
      // Retain intermediate codes and require eventual verified reconciliation;
      // never mask a permanently failed claim with another cancellation request.
      await sleep(2000)
    }
    console.log(JSON.stringify({ observedCaptureStates: [...observedCaptureStates] }))
    assert.ok(completedByWebhook, 'Capture webhook must complete the existing refund claim without a customer retry')
    await sleep(3000)
    captureResumeVerification = 'verified'
    pass('actual automatic_async capture completes the pending refund via Stripe webhook without another cancellation request')
  } else {
    captureResumeVerification = 'not_observed_initially_complete'
  }
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
  transferVerification = 'verified'
  pass('actual Stripe TEST destination refund reverses associated transfer and entire application fee exactly once')
  }
  }

  // Provider-generated events, not forged unsigned requests, must reach the app.
  let acceptedEvent = false
  let acceptedEventId
  for (let attempt = 0; attempt < 18; attempt++) {
    const events = await stripe.events.list({ type: 'charge.refunded', limit: 100 })
    const event = events.data.find(event => event.data.object.metadata?.booking_id === eligible.id)
    if (event) {
      const stored = await check(service.from('stripe_webhook_events').select('event_id').eq('event_id', event.id))
      if (stored.length === 1) { acceptedEvent = true; acceptedEventId = event.id; break }
    }
    await sleep(5000)
  }
  assert.ok(acceptedEvent, 'Provider webhook must be accepted by deployed application')
  pass('Stripe-generated refund webhook accepted by deployed production endpoint')
  const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter(endpoint =>
    endpoint.url === `${base}/api/webhooks/stripe` && endpoint.status === 'enabled' && !endpoint.livemode)
  assert.equal(endpoints.length, 1)
  cliDirectory = mkdtempSync(join(tmpdir(), 'ardore-refund-cli-'))
  const replay = spawnSync('stripe', ['events', 'resend', acceptedEventId,
    '--webhook-endpoint', endpoints[0].id, '--confirm'], {
    env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY, XDG_CONFIG_HOME: cliDirectory },
    encoding: 'utf8', timeout: 30000,
  })
  // CLI output is intentionally never printed: it can include provider payloads.
  assert.equal(replay.status, 0, 'Stripe TEST event replay must be accepted')
  await sleep(5000)
  assert.equal((await check(service.from('stripe_webhook_events').select('event_id').eq('event_id', acceptedEventId))).length, 1)
  await verifyFullRefund(eligible, 'platform')
  pass('actual provider webhook replay leaves one event claim and one full refund')
} catch (error) {
  console.error(JSON.stringify({ failedAfter: results.at(-1) ?? 'setup', code: error.code ?? error.name, authStatus: error.authStatus, location: error.stack?.split('\n').find(line => line.includes('test-synthetic-coaching-refunds.mjs:'))?.trim() }))
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
      ownedChargeIds.add(charge.id)
      if (charge.amount_refunded < charge.amount_captured && !intentionallyFailedRefundIntents.has(intent.id)) {
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
  let preserveCoach = false
  if (coach) {
    // A concurrent real interaction must never be lost through parent cascades.
    for (const table of ['bookings', 'messages', 'subscriptions']) {
      const { count, error } = await service.from(table).select('id', { count: 'exact', head: true }).eq('creator_id', coach.id)
      if (error || (count ?? 0) > 0) preserveCoach = true
    }
    if (preserveCoach) cleanupErrors.push('unowned_interaction_preserved_for_review')
  }
  if (coach && !preserveCoach) {
    for (const table of ['availability_slots', 'coaching_offers', 'creator_profiles']) {
      try { await check(service.from(table).delete().eq(table === 'creator_profiles' ? 'id' : 'creator_id', coach.id)) }
      catch (error) { cleanupErrors.push(`${table}:${error.name}`) }
    }
  }
  if (users.length) {
    try { await check(service.from('notifications').delete().in('user_id', users.filter(userId => !preserveCoach || userId !== coachUserIdForCleanup))) } catch (error) { cleanupErrors.push(error.name) }
    for (const userId of users) {
      if (preserveCoach && userId === coachUserIdForCleanup) continue
      try { const result = await service.auth.admin.deleteUser(userId); if (result.error) throw new Error('Auth cleanup failed') }
      catch (error) { cleanupErrors.push(error.name) }
    }
  }
  if (connectedAccount) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try { await stripe.v2.core.accounts.close(connectedAccount.id, { applied_configurations: connectedAccount.applied_configurations }); break }
      catch (error) {
        if (error.code === 'pending_transactions_cannot_be_deleted' && attempt < 11) { await sleep(5000); continue }
        cleanupErrors.push(`connect:${error.code ?? error.type}`); break
      }
    }
  }
  try {
    const events = await stripe.events.list({ created: { gte: startedAt }, limit: 100 }).autoPagingToArray({ limit: 1000 })
    const owned = events.filter(event => {
      const object = event.data.object
      return object.metadata?.ardore_synthetic_run === run || bookings.includes(object.metadata?.booking_id)
        || intents.includes(object.id) || sessions.includes(object.id)
        || ownedChargeIds.has(object.id) || ownedChargeIds.has(id(object.source_transaction))
        || ownedChargeIds.has(id(object.originating_transaction))
    }).map(event => event.id)
    if (owned.length) await check(service.from('stripe_webhook_events').delete().in('event_id', owned))
  } catch (error) { cleanupErrors.push(`event_cleanup:${error.code ?? error.name}`) }
  if (cliDirectory) rmSync(cliDirectory, { recursive: true, force: true })
  console.log(JSON.stringify({ passed: results.length, transferVerification, captureResumeVerification, asynchronousFailureVerification, mutableSyntheticDataCleaned: cleanupErrors.length === 0, cleanupErrors }))
  if (cleanupErrors.length) process.exitCode = 1
}
