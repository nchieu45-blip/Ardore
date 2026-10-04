// Opt-in real Stripe TEST settlement checks. Only this run's GoTrue accounts,
// coach, orders, charges, transfers and ledger rows may be mutated or cleaned.
// Provider history is immutable; no secret or personal provider error is logged.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import Stripe from 'stripe'
import ts from 'typescript'
import { createSyntheticConnectFixture, cleanupSyntheticConnectFixture } from './prepare-synthetic-connect-fixture.mjs'

if (!process.argv.includes('--run-production-synthetic')) {
  console.log('Skipped: requires --run-production-synthetic, an applied settlement migration, and TEST credentials.')
  process.exit(0)
}
process.loadEnvFile('.env.local')
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true, 'Synthetic settlement requires a Stripe TEST key')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'yboeyxqeileicecqpwke.supabase.co')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = 'https://www.ardore-health.com'
const require = createRequire(import.meta.url)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 })
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })
const run = randomUUID()
const tag = `ardore-settlement-${run.slice(0, 12)}`
const startedAt = Math.floor(Date.now() / 1000)
const users = [], actors = [], orders = new Set(), intents = new Set(), sessions = new Set(), customers = new Set()
const bookings = new Set(), products = new Set(), tiers = new Set(), subscriptions = new Set(), stripeProducts = new Set(), stripePrices = new Set()
const restrictedFixtures = []
const testClocks = new Set(), invoices = new Set(), ownedReversals = new Set(), ownedRefunds = new Set()
const immutableCatalogIds = new Set()
const ownedTransfers = new Set(), ownedCharges = new Set(), settlements = new Set(), results = []
let coach, fixture, library
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const objectId = value => typeof value === 'string' ? value : value?.id
const check = async promise => {
  const value = await promise
  if (value.error) throw Object.assign(new Error('Synthetic database operation failed'), { code: value.error.code })
  return value.data
}
const code = error => typeof error?.code === 'string' && /^[a-zA-Z0-9_]{1,90}$/.test(error.code) ? error.code : error?.name ?? 'test_failed'
const pass = label => { results.push(label); console.log(`PASS ${label}`) }

async function adoptInvoicePayment(invoiceId, customerId) {
  assert.ok(customers.has(customerId), 'Only an owned synthetic customer may be inspected')
  const invoice = await stripe.invoices.retrieve(invoiceId)
  assert.equal(invoice.livemode, false)
  assert.equal(objectId(invoice.customer), customerId)
  invoices.add(invoice.id)
  const rows = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 })
  assert.ok(!rows.has_more, 'Owned invoice payment discovery must not truncate')
  for (const row of rows.data) {
    const paymentId = objectId(row.payment.payment_intent)
    if (!paymentId) continue
    const payment = await stripe.paymentIntents.retrieve(paymentId)
    assert.equal(payment.livemode, false)
    assert.equal(objectId(payment.customer), customerId)
    // Billing does not propagate subscription metadata. The invoice/customer
    // chain proves this intent was created by this run before adding its marker.
    await stripe.paymentIntents.update(paymentId, { metadata: { ardore_synthetic_run: run } })
    intents.add(paymentId)
    if (objectId(payment.latest_charge)) {
      ownedCharges.add(objectId(payment.latest_charge))
      await stripe.charges.update(objectId(payment.latest_charge), { metadata: { ardore_synthetic_run: run } })
    }
  }
}

async function adoptCheckoutCatalog(sessionId) {
  const lines = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 })
  assert.equal(lines.has_more, false)
  for (const line of lines.data) {
    const price = line.price
    if (!price) continue
    assert.equal(price.livemode, false)
    const productId = objectId(price.product)
    const product = await stripe.products.retrieve(productId)
    assert.equal(product.livemode, false)
    // The owned Session -> line_items chain proves these immutable catalog IDs.
    // Inline objects can have no normal created timestamp and reject updates.
    // Archive only explicitly created fixtures already tagged by this run.
    if (price.metadata?.ardore_synthetic_run === run) {
      stripePrices.add(price.id)
    } else immutableCatalogIds.add(price.id)
    if (product.metadata?.ardore_synthetic_run === run) {
      stripeProducts.add(productId)
    } else immutableCatalogIds.add(productId)
  }
}

async function discoverCheckoutObjects(sessionId) {
  assert.ok(sessions.has(sessionId))
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  assert.equal(session.livemode, false)
  assert.equal(session.metadata.ardore_synthetic_run, run)
  await adoptCheckoutCatalog(sessionId)
  const paymentId = objectId(session.payment_intent)
  if (paymentId) {
    const payment = await stripe.paymentIntents.retrieve(paymentId)
    assert.equal(payment.livemode, false)
    if (payment.metadata.ardore_synthetic_run !== run) {
      assert.ok(orders.has(payment.metadata.ardore_order_id))
      assert.equal(payment.metadata.creator_id, coach.id)
      assert.ok(users.includes(payment.metadata.buyer_id))
      await stripe.paymentIntents.update(paymentId, { metadata: { ardore_synthetic_run: run } })
    }
    intents.add(paymentId)
    if (objectId(payment.latest_charge)) {
      ownedCharges.add(objectId(payment.latest_charge))
      await stripe.charges.update(objectId(payment.latest_charge), { metadata: { ardore_synthetic_run: run } })
    }
  }
  const subscriptionId = objectId(session.subscription)
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    assert.equal(subscription.livemode, false)
    if (subscription.metadata.ardore_synthetic_run !== run) {
      assert.ok(orders.has(subscription.metadata.ardore_order_id))
      assert.equal(subscription.metadata.creator_id, coach.id)
      assert.ok(users.includes(subscription.metadata.buyer_id))
      await stripe.subscriptions.update(subscriptionId, { metadata: { ardore_synthetic_run: run } })
    }
    const customerId = objectId(subscription.customer)
    if (!customers.has(customerId)) {
      assert.equal(objectId(session.customer), customerId)
      const customer = await stripe.customers.retrieve(customerId)
      assert.equal(customer.deleted, undefined); assert.equal(customer.livemode, false)
      const buyer = actors.find(value => value.id === subscription.metadata.buyer_id)
      assert.ok(buyer); assert.equal(customer.email, buyer.email)
      assert.ok(customer.created >= startedAt, 'Only a customer created for this owned Checkout may be adopted')
      await stripe.customers.update(customerId, { metadata: { ardore_synthetic_run: run } })
      customers.add(customerId)
    }
    assert.ok(customers.has(customerId))
    subscriptions.add(subscriptionId)
    const rows = await stripe.invoices.list({ subscription: subscriptionId, limit: 100 })
    assert.ok(!rows.has_more, 'Owned subscription invoice discovery must not truncate')
    for (const invoice of rows.data) await adoptInvoicePayment(invoice.id, customerId)
  }
  return session
}

// The actual production library is used, with its Stripe/Supabase dependencies
// supplied in memory. This requires no tsx installation or secret-bearing build.
const loaded = new Map()
function loadSource(path) {
  const full = resolve(root, path)
  if (loaded.has(full)) return loaded.get(full).exports
  const source = readFileSync(full, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText
  const loadedModule = { exports: {} }
  loaded.set(full, loadedModule)
  const resolveDependency = name => {
    if (name === '@/lib/stripe/server') return { stripe }
    if (name === '@/lib/supabase/server') return { createServiceClient: async () => service }
    if (name.startsWith('@/') || name.startsWith('.')) {
      const requested = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(full), name)
      const candidate = [requested, `${requested}.ts`, `${requested}.tsx`, resolve(requested, 'index.ts')].find(existsSync)
      assert.ok(candidate, 'Synthetic test source dependency must exist')
      return loadSource(candidate)
    }
    return require(name)
  }
  new Function('require', 'exports', 'module', 'process', compiled)(resolveDependency, loadedModule.exports, loadedModule, process)
  return loadedModule.exports
}

async function actor(role) {
  const email = `delivered+${tag}-${role}-${users.length}@resend.dev`
  const password = randomBytes(32).toString('base64url')
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { role, full_name: 'Synthetic settlement verification' } })
  if (created.error) throw Object.assign(new Error('GoTrue fixture creation failed'), { code: created.error.code })
  users.push(created.data.user.id)
  const cookies = new Map()
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)) },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw Object.assign(new Error('Synthetic login failed'), { code: login.error.code })
  const value = { id: created.data.user.id, email, client,
    refreshLogin: async () => {
      const result = await client.auth.signInWithPassword({ email, password })
      assert.equal(result.error, null, 'Synthetic session refresh must succeed')
    },
    loginPage: async page => {
      await page.getByLabel('E-Mail-Adresse').fill(email)
      await page.getByLabel('Passwort', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
    },
    cookie: () => [...cookies].map(([name, item]) => `${name}=${item}`).join('; ') }
  actors.push(value)
  return value
}

async function order(kind, buyer, reference = {}, grossCents = 500, accountId = fixture.accountId) {
  let orderId = randomUUID()
  if (kind === 'booking') {
    const booking = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: buyer.id,
      buyer_email: buyer.email, buyer_name: 'Synthetic settlement verification',
      scheduled_at: new Date(Date.now() + 7 * 86_400_000 + bookings.size * 7_200_000).toISOString(),
      duration_minutes: 60, price_cents: grossCents, status: 'pending_payment', payment_status: 'pending', stripe_livemode: false,
      cancellation_policy_hours: 24, reservation_expires_at: new Date(Date.now() + 1_860_000).toISOString() }).select('*').single())
    bookings.add(booking.id)
    const claimed = await check(service.rpc('begin_coaching_payment_attempt', { p_booking_id: booking.id, p_buyer_id: buyer.id,
      p_livemode: false, p_expires_at: booking.reservation_expires_at, p_destination_account_id: accountId,
      p_application_fee_cents: Math.round(grossCents / 10), p_charge_architecture: 'separate' }))
    assert.ok(claimed.attempt?.id)
    orderId = claimed.attempt.id
    reference = { bookingId: booking.id, attemptId: orderId }
  } else if (kind === 'products' && !reference.items) {
    const product = await check(service.from('products').insert({ creator_id: coach.id,
      title: 'Synthetic settlement verification', description: 'Disposable TEST fixture', type: 'pdf',
      price: grossCents / 100, is_published: false }).select('id').single())
    products.add(product.id)
    reference = { items: [{ productId: product.id, amountCents: grossCents }],
      withdrawalConsentAt: new Date().toISOString(), withdrawalConsentVersion: 'widerruf-v1' }
  }
  const created = await library.createSettlementOrder({ service, id: orderId, kind, buyerId: buyer.id,
    creatorId: coach.id, accountId, grossCents, livemode: false, reference })
  assert.ok(created.id, 'Durable settlement order must exist')
  orders.add(created.id)
  return created
}

async function payment(orderRow, extra = {}) {
  assert.ok(orders.has(orderRow.id))
  if (orderRow.kind === 'booking') {
    const bookingId = orderRow.reference.bookingId
    assert.ok(bookings.has(bookingId))
    const metadata = { ardore_order_id: orderRow.id, ardore_synthetic_run: run,
      checkout_type: 'coaching_session', booking_id: bookingId, payment_attempt_id: orderRow.id,
      creator_id: coach.id, buyer_id: orderRow.buyer_id }
    const buyer = actors.find(value => value.id === orderRow.buyer_id)
    assert.ok(buyer)
    const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], customer_email: buyer.email,
      metadata, payment_intent_data: { metadata, transfer_group: `ardore-order-${orderRow.id}` },
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: orderRow.gross_cents,
        product_data: { name: 'Synthetic settlement coaching' } } }],
      expires_at: Math.floor((Date.now() + 1_860_000) / 1000),
      success_url: `${base}/buyer/sessions`, cancel_url: `${base}/buyer/sessions`,
    }, { idempotencyKey: `${tag}-${orderRow.id}-checkout-v1` })
    sessions.add(session.id)
    await check(service.rpc('register_coaching_checkout', { p_attempt_id: orderRow.id, p_session_id: session.id, p_session_url: session.url }))
    await library.registerSettlementCheckout({ service, orderId: orderRow.id, sessionId: session.id })
    const method = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' },
      billing_details: { name: 'Synthetic settlement verification', email: buyer.email } })
    await stripe.rawRequest('GET', `/v1/payment_pages/${session.id}`)
    await stripe.rawRequest('POST', `/v1/payment_pages/${session.id}/confirm`, {
      payment_method: method.id, expected_amount: orderRow.gross_cents,
    })
    const fresh = await stripe.checkout.sessions.retrieve(session.id)
    const paymentId = objectId(fresh.payment_intent)
    assert.ok(paymentId)
    intents.add(paymentId)
    const paid = await stripe.paymentIntents.retrieve(paymentId)
    if (objectId(paid.latest_charge)) ownedCharges.add(objectId(paid.latest_charge))
    assert.equal(fresh.payment_status, 'paid'); assert.equal(paid.status, 'succeeded'); assert.equal(paid.livemode, false)
    assert.equal(paid.transfer_data, null); assert.equal(paid.application_fee_amount, null)
    const lifecycle = loadSource('src/lib/coaching-payment-lifecycle.ts')
    await lifecycle.reconcileCoachingCheckout({ service, sessionId: session.id, stripeLivemode: false })
    const saved = await check(service.from('bookings').select('*').eq('id', bookingId).single())
    assert.equal(saved.payment_status, 'paid'); assert.equal(saved.status, 'confirmed')
    return paid
  }
  const payment = await stripe.paymentIntents.create({ amount: orderRow.gross_cents ?? 500, currency: 'eur',
    payment_method: 'pm_card_visa', confirm: true, payment_method_types: ['card'],
    transfer_group: `ardore-order-${orderRow.id}`,
    metadata: { ardore_order_id: orderRow.id, creator_id: coach.id, buyer_id: orderRow.buyer_id,
      ardore_synthetic_run: run }, ...extra,
  }, { idempotencyKey: `${tag}-${orderRow.id}-payment-v1` })
  intents.add(payment.id)
  if (objectId(payment.latest_charge)) ownedCharges.add(objectId(payment.latest_charge))
  assert.equal(payment.livemode, false)
  assert.equal(payment.status, 'succeeded')
  assert.equal(payment.transfer_data, null, 'NEW payments must retain funds on platform before settlement')
  assert.equal(payment.application_fee_amount, null, 'Platform fee must not silently double-charge')
  return payment
}

async function recorded(orderRow, paymentRow, extra = {}) {
  const value = await library.recordSuccessfulSettlement({ service, orderId: orderRow.id,
    paymentIntentId: paymentRow.id, ...extra })
  const settlement = value.settlement ?? value
  assert.ok(settlement.id)
  settlements.add(settlement.id)
  return settlement
}

async function ledgerFor(paymentRow) {
  const rows = await check(service.from('payment_settlements').select('*').eq('stripe_payment_intent_id', paymentRow.id))
  assert.equal(rows.length, 1, 'One immutable earning/settlement row per successful payment')
  const row = rows[0]
  assert.equal(row.gross_cents, paymentRow.amount_received)
  assert.equal(row.platform_fee_cents, Math.round(paymentRow.amount_received / 10))
  assert.equal(row.coach_net_cents, row.gross_cents - row.platform_fee_cents)
  assert.equal(row.creator_id, coach.id)
  return row
}

async function transferFor(paymentRow) {
  const chargeId = objectId(paymentRow.latest_charge)
  assert.ok(ownedCharges.has(chargeId))
  const transfers = await stripe.transfers.list({ limit: 100, created: { gte: startedAt } }).autoPagingToArray({ limit: 1000 })
  assert.ok(transfers.length < 1000, 'Bounded transfer discovery must not truncate')
  const matched = transfers.filter(value => objectId(value.source_transaction) === chargeId)
  for (const value of matched) {
    assert.equal(value.livemode, false)
    assert.equal(objectId(value.destination), fixture.accountId)
    ownedTransfers.add(value.id)
  }
  return matched
}

async function fullRefund(paymentRow, expectedRefundCount = 1) {
  assert.ok(intents.has(paymentRow.id))
  const refundKey = `${tag}-${paymentRow.id}-full-refund-v1`
  await library.prepareSettlementRefund({ service, paymentIntentId: paymentRow.id,
    targetRefundedCents: paymentRow.amount_received, refundKey })
  const current = await stripe.refunds.list({ payment_intent: paymentRow.id, limit: 100 })
  const reserved = current.data.filter(value => !['failed', 'canceled'].includes(value.status)).reduce((sum, value) => sum + value.amount, 0)
  if (reserved < paymentRow.amount_received) {
    await stripe.refunds.create({ payment_intent: paymentRow.id, amount: paymentRow.amount_received - reserved,
      metadata: { ardore_synthetic_run: run } }, { idempotencyKey: refundKey })
  }
  await library.reconcileSettlementRefund({ service, paymentIntentId: paymentRow.id })
  const refunds = await stripe.refunds.list({ payment_intent: paymentRow.id, limit: 100 })
  for (const refund of refunds.data) ownedRefunds.add(refund.id)
  assert.equal(refunds.data.length, expectedRefundCount)
  assert.equal(refunds.data.reduce((sum, refund) => sum + refund.amount, 0), paymentRow.amount_received)
  assert.ok(refunds.data.every(refund => refund.status === 'succeeded'))
  const transfers = await transferFor(paymentRow)
  assert.ok(transfers.every(value => value.amount_reversed === value.amount), 'Full customer refund must reverse complete coach share')
  for (const transfer of transfers) {
    const reversals = await stripe.transfers.listReversals(transfer.id, { limit: 100 })
    for (const reversal of reversals.data) ownedReversals.add(reversal.id)
  }
  assert.equal((await ledgerFor(paymentRow)).state, 'refunded')
  return refunds.data[0]
}

async function waitFor(label, operation, timeoutMs = 120_000) {
  const expires = Date.now() + timeoutMs
  let nextProgress = Date.now() + 45_000
  while (Date.now() < expires) {
    const value = await operation()
    if (value) return value
    if (Date.now() >= nextProgress) { console.log(`WAIT ${label}`); nextProgress = Date.now() + 45_000 }
    await sleep(2000)
  }
  throw Object.assign(new Error('Synthetic provider verification timed out'), { code: label })
}

async function recurringTest(buyer) {
  const tier = await check(service.from('subscription_tiers').insert({ creator_id: coach.id,
    name: 'Synthetic settlement subscription', description: 'Disposable TEST fixture', price_monthly: 5,
    is_active: false }).select('id').single())
  tiers.add(tier.id)
  const ownedOrder = await order('subscription', buyer, { tierId: tier.id })
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: tag })
  testClocks.add(clock.id)
  const customer = await stripe.customers.create({ test_clock: clock.id, email: buyer.email,
    metadata: { ardore_synthetic_run: run }, name: 'Synthetic settlement verification' })
  customers.add(customer.id)
  const product = await stripe.products.create({ name: 'Synthetic settlement subscription', metadata: { ardore_synthetic_run: run } })
  stripeProducts.add(product.id)
  const price = await stripe.prices.create({ product: product.id, unit_amount: 500, currency: 'eur',
    recurring: { interval: 'month' }, metadata: { ardore_synthetic_run: run } })
  stripePrices.add(price.id)
  const metadata = { ardore_order_id: ownedOrder.id, ardore_synthetic_run: run,
    buyer_id: buyer.id, creator_id: coach.id, tier_id: tier.id }
  const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer: customer.id,
    payment_method_types: ['card'], line_items: [{ price: price.id, quantity: 1 }], metadata,
    subscription_data: { metadata }, success_url: `${base}/buyer`, cancel_url: `${base}/buyer`,
  }, { idempotencyKey: `${tag}-${ownedOrder.id}-subscription-checkout-v1` })
  sessions.add(session.id)
  await library.registerSettlementCheckout({ service, orderId: ownedOrder.id, sessionId: session.id })
  const method = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' },
    billing_details: { name: 'Synthetic settlement verification', email: buyer.email } })
  await stripe.rawRequest('GET', `/v1/payment_pages/${session.id}`)
  await stripe.rawRequest('POST', `/v1/payment_pages/${session.id}/confirm`, {
    payment_method: method.id, expected_amount: 500,
  })
  const completed = await stripe.checkout.sessions.retrieve(session.id)
  assert.equal(completed.livemode, false); assert.equal(completed.payment_status, 'paid')
  const subscriptionId = objectId(completed.subscription)
  assert.ok(subscriptionId)
  subscriptions.add(subscriptionId)
  await library.registerSettlementCheckout({ service, orderId: ownedOrder.id, sessionId: session.id, subscriptionId })
  const initial = await stripe.subscriptions.retrieve(subscriptionId)
  assert.equal(initial.metadata.ardore_order_id, ownedOrder.id)
  assert.equal(initial.transfer_data, null)
  assert.equal(initial.application_fee_percent, null)
  const invoicePayments = []
  async function reconcileInvoice(invoiceId) {
    const invoice = await stripe.invoices.retrieve(invoiceId)
    assert.equal(invoice.livemode, false); assert.equal(invoice.status, 'paid'); assert.equal(invoice.amount_paid, 500)
    assert.equal(objectId(invoice.customer), customer.id)
    invoices.add(invoice.id)
    const paymentRows = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100 })
    assert.equal(paymentRows.data.length, 1)
    const paymentId = objectId(paymentRows.data[0].payment.payment_intent)
    assert.ok(paymentId)
    const paymentRow = await stripe.paymentIntents.retrieve(paymentId)
    assert.equal(objectId(paymentRow.customer), customer.id)
    assert.equal(paymentRow.status, 'succeeded'); assert.equal(paymentRow.livemode, false)
    // Stripe Billing does not copy subscription metadata to PaymentIntent.
    // Mark only the intent just proven to belong to this owned paid invoice so
    // cleanup can independently establish ownership without printing its data.
    await stripe.paymentIntents.update(paymentId, { metadata: { ardore_synthetic_run: run } })
    intents.add(paymentId)
    if (objectId(paymentRow.latest_charge)) {
      ownedCharges.add(objectId(paymentRow.latest_charge))
      await stripe.charges.update(objectId(paymentRow.latest_charge), { metadata: { ardore_synthetic_run: run } })
    }
    await library.reconcileSettlementInvoice({ service, invoiceId: invoice.id })
    await library.reconcileSettlementInvoice({ service, invoiceId: invoice.id })
    const ledger = await ledgerFor(paymentRow)
    assert.equal(ledger.stripe_invoice_id, invoice.id)
    settlements.add(ledger.id)
    const transfers = await transferFor(paymentRow)
    assert.equal(transfers.length, 1); assert.equal(transfers[0].amount, 450)
    invoicePayments.push(paymentRow)
    return invoice
  }
  await reconcileInvoice(objectId(initial.latest_invoice))
  const nextPeriod = initial.items.data[0].current_period_end
  assert.ok(nextPeriod > clock.frozen_time)
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: nextPeriod + 3600 })
  await waitFor('subscription_test_clock_ready', async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === 'ready')
  const recurring = await waitFor('recurring_invoice_paid', async () => {
    const list = await stripe.invoices.list({ subscription: subscriptionId, limit: 10 })
    return list.data.find(value => value.billing_reason === 'subscription_cycle' && value.status === 'paid')
  })
  await reconcileInvoice(recurring.id)
  const ledgerRows = await check(service.from('payment_settlements').select('id,stripe_invoice_id').eq('order_id', ownedOrder.id))
  assert.equal(ledgerRows.length, 2)
  assert.equal(new Set(ledgerRows.map(value => value.stripe_invoice_id)).size, 2)
  const entitlements = await check(service.from('subscriptions').select('*').eq('stripe_subscription_id', subscriptionId))
  assert.equal(entitlements.length, 1)
  assert.equal(entitlements[0].buyer_id, buyer.id); assert.equal(entitlements[0].creator_id, coach.id)
  assert.equal(entitlements[0].status, 'active')
  pass('real recurring TEST subscription invoices create one settlement per cycle and one entitlement')
  await stripe.subscriptions.cancel(subscriptionId)
  for (const paymentRow of invoicePayments) await fullRefund(paymentRow)
  pass('recurring invoice transfers/refunds reconcile per captured cycle without duplicate earnings')
}

async function productionRequest(actor, path, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: {
    Cookie: actor.cookie(), 'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 ArdoreAuthorizedSyntheticSettlementVerification',
  }, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}), redirect: 'error' })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw Object.assign(new Error('Production API did not return JSON'), {
      code: response.status === 403 ? 'hostinger_browser_challenge' : 'production_api_non_json' })
  }
  const value = await response.json()
  assert.ok(response.status >= 200 && response.status < 300, `Owned synthetic production request failed with HTTP ${response.status}`)
  return value
}

async function completeProductionCheckout(url, buyer) {
  const address = new URL(url)
  assert.equal(address.hostname, 'checkout.stripe.com')
  const sessionId = address.pathname.split('/').at(-1)
  assert.match(sessionId, /^cs_test_[A-Za-z0-9]+$/)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  assert.equal(session.livemode, false)
  assert.equal(session.metadata.creator_id, coach.id)
  assert.equal(session.metadata.buyer_id, buyer.id)
  const row = await check(service.from('payment_orders').select('*').eq('id', session.metadata.ardore_order_id).single())
  assert.equal(row.creator_id, coach.id); assert.equal(row.buyer_id, buyer.id); assert.equal(row.stripe_livemode, false)
  assert.equal(row.gross_cents, 500); assert.equal(row.account_id, fixture.accountId)
  orders.add(row.id); sessions.add(sessionId)
  await stripe.checkout.sessions.update(sessionId, { metadata: { ardore_synthetic_run: run } })
  await adoptCheckoutCatalog(sessionId)
  const method = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' },
    billing_details: { name: 'Synthetic settlement verification', email: buyer.email } })
  try {
    await stripe.rawRequest('GET', `/v1/payment_pages/${sessionId}`)
    await stripe.rawRequest('POST', `/v1/payment_pages/${sessionId}/confirm`, { payment_method: method.id, expected_amount: 500 })
  } finally { await discoverCheckoutObjects(sessionId) }
  const completed = await stripe.checkout.sessions.retrieve(sessionId)
  assert.equal(completed.payment_status, 'paid')
  let paymentId = objectId(completed.payment_intent)
  if (completed.mode === 'subscription') {
    const invoiceId = objectId(completed.invoice)
    assert.ok(invoices.has(invoiceId))
    const invoiceRows = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 100 })
    assert.equal(invoiceRows.data.length, 1); assert.equal(invoiceRows.has_more, false)
    paymentId = objectId(invoiceRows.data[0].payment.payment_intent)
    assert.ok(intents.has(paymentId))
  }
  assert.ok(paymentId)
  const paid = await stripe.paymentIntents.retrieve(paymentId)
  assert.equal(paid.status, 'succeeded'); assert.equal(paid.transfer_data, null); assert.equal(paid.application_fee_amount, null)
  // Do not run the settlement library here. The deployed app and its genuine,
  // signed Stripe webhook must establish fulfillment and money movement.
  const saved = await waitFor('deployed_signed_webhook_settlement', async () => {
    const rows = await check(service.from('payment_settlements').select('*').eq('stripe_payment_intent_id', paid.id))
    assert.ok(rows.length <= 1)
    if (rows[0]?.id) settlements.add(rows[0].id)
    return rows[0]?.state === 'settled' && rows[0]?.fulfillment_state === 'fulfilled' ? rows[0] : null
  }, 240_000)
  const transfer = await transferFor(paid)
  assert.equal(transfer.length, 1); assert.equal(transfer[0].amount, 450)
  assert.equal(saved.stripe_transfer_id, transfer[0].id)
  return { row, paid, saved }
}

async function deployedTests(buyer) {
  const product = await check(service.from('products').insert({ creator_id: coach.id,
    title: 'Synthetic settlement verification', description: 'Disposable TEST fixture', type: 'pdf',
    price: 5, is_published: true }).select('id').single())
  products.add(product.id)
  const purchase = await productionRequest(buyer, '/api/stripe/checkout', { productId: product.id, withdrawalConsent: true })
  const productPayment = await completeProductionCheckout(purchase.url, buyer)
  const entitlement = await check(service.from('purchases').select('*').eq('product_id', product.id).eq('buyer_id', buyer.id))
  assert.equal(entitlement.length, 1); assert.equal(entitlement[0].payment_status, 'paid')
  pass('deployed product checkout and genuine signed webhook grant one entitlement and correct coach settlement')

  const booking = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: buyer.id,
    buyer_email: buyer.email, buyer_name: 'Synthetic settlement verification',
    scheduled_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), duration_minutes: 60,
    price_cents: 500, status: 'pending_payment', payment_status: 'pending', stripe_livemode: false,
    cancellation_policy_hours: 24, reservation_expires_at: new Date(Date.now() + 1_860_000).toISOString() }).select('id').single())
  bookings.add(booking.id)
  const checkout = await productionRequest(buyer, '/api/coaching/retry', { bookingId: booking.id })
  const bookingPayment = await completeProductionCheckout(checkout.checkoutUrl, buyer)
  const confirmed = await check(service.from('bookings').select('*').eq('id', booking.id).single())
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.payment_status, 'paid')
  pass('deployed booking checkout and genuine signed webhook confirm paid reservation and settle coach once')
  const cancel = await productionRequest(buyer, '/api/coaching/cancel', { bookingId: booking.id })
  assert.ok(['pending','succeeded'].includes(cancel.refundStatus))
  await waitFor('deployed_booking_refund_complete', async () => {
    const current = await check(service.from('bookings').select('refund_status').eq('id', booking.id).single())
    return current.refund_status === 'succeeded'
  })
  await productionRequest(buyer, '/api/coaching/cancel', { bookingId: booking.id })
  const refunds = await stripe.refunds.list({ payment_intent: bookingPayment.paid.id, limit: 100 })
  assert.equal(refunds.data.length, 1); assert.equal(refunds.data[0].amount, 500); assert.equal(refunds.data[0].status, 'succeeded')
  for (const refund of refunds.data) ownedRefunds.add(refund.id)
  assert.equal((await transferFor(bookingPayment.paid))[0].amount_reversed, 450)
  pass('deployed paid booking cancellation reverses exact coach share and fully refunds the customer once')
  const coachActor = actors.find(value => value.id !== buyer.id)
  const visible = await productionRequest(coachActor, '/api/stripe/settlements', undefined, 'GET')
  assert.ok(visible.settlements.every(value => settlements.has(value.id)))
  assert.ok(visible.settlements.some(value => value.id === productPayment.saved.id && value.coachNetCents === 450))
  await productionRequest(coachActor, '/api/stripe/settlements', {})
  assert.equal((await transferFor(productPayment.paid)).length, 1)
  pass('deployed coach earnings view and repeated recovery are owner scoped and do not duplicate transfers')
  await fullRefund(productPayment.paid)

  const tier = await check(service.from('subscription_tiers').insert({ creator_id: coach.id,
    name: 'Synthetic settlement subscription', description: 'Disposable TEST fixture', price_monthly: 5,
    is_active: true }).select('id').single())
  tiers.add(tier.id)
  const recurring = await productionRequest(buyer, '/api/stripe/subscription', { tierId: tier.id, creatorId: coach.id })
  const cycle = await completeProductionCheckout(recurring.url, buyer)
  const subscriptionRows = await check(service.from('subscriptions').select('*').eq('buyer_id', buyer.id)
    .eq('creator_id', coach.id).eq('stripe_subscription_id', cycle.saved.stripe_subscription_id))
  assert.equal(subscriptionRows.length, 1); assert.equal(subscriptionRows[0].status, 'active')
  await stripe.subscriptions.cancel(subscriptionRows[0].stripe_subscription_id)
  await fullRefund(cycle.paid)
  pass('deployed paid subscription initial invoice and genuine signed webhook create one entitlement and correct settlement')
}

async function purchaseLifecycleTests(buyer) {
  const other = await actor('buyer')
  const productRows = await check(service.from('products').insert(['purchased', 'unrelated', 'canceled', 'failed'].map(name => ({
    creator_id: coach.id, title: `Synthetic purchase ${name}`, description: 'Disposable Stripe TEST purchase lifecycle fixture',
    type: 'pdf', price: 5, is_published: true,
  }))).select('id,title'))
  productRows.forEach(row => products.add(row.id))
  const [product, unrelated, canceled, failed] = productRows
  async function status(id, who = buyer) { return productionRequest(who, `/api/stripe/purchase-status?session_id=${id}`, undefined, 'GET') }
  async function checkout(productId) {
    const created = await productionRequest(buyer, '/api/stripe/checkout', { productId, withdrawalConsent: true })
    const id = new URL(created.url).pathname.split('/').at(-1)
    const row = await stripe.checkout.sessions.retrieve(id)
    assert.equal(row.livemode, false); assert.equal(row.metadata.buyer_id, buyer.id); assert.equal(row.metadata.creator_id, coach.id)
    sessions.add(id); orders.add(row.metadata.ardore_order_id)
    await stripe.checkout.sessions.update(id, { metadata: { ardore_synthetic_run: run } })
    await adoptCheckoutCatalog(id)
    return { id, url: created.url }
  }
  const purchase = await checkout(product.id)
  assert.equal((await status(purchase.id)).state, 'awaiting_payment')
  pass('unpaid deployed Checkout has no completed purchase or entitlement')
  const payment = await completeProductionCheckout(purchase.url, buyer)
  assert.equal((await status(purchase.id)).state, 'completed')
  assert.deepEqual((await status(purchase.id)).productIds, [product.id])
  const foreign = await fetch(`${base}/api/stripe/purchase-status?session_id=${purchase.id}`, { headers: { Cookie: other.cookie() } })
  assert.equal(foreign.status, 404)
  pass('genuine signed deployed TEST webhook completes exactly one owner-visible purchase')
  await library.reconcileSettlementCheckout({ service, sessionId: purchase.id })
  await library.reconcileSettlementCheckout({ service, sessionId: purchase.id })
  const rows = await check(service.from('purchases').select('id').eq('buyer_id', buyer.id).eq('product_id', product.id))
  assert.equal(rows.length, 1); assert.equal((await transferFor(payment.paid)).length, 1)
  pass('duplicate fulfillment observation creates no duplicate entitlement or transfer')
  const repeated = await fetch(`${base}/api/stripe/checkout`, { method: 'POST', headers: { Cookie: buyer.cookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: product.id, withdrawalConsent: true }) })
  assert.equal(repeated.status, 409)
  pass('deployed repeat digital purchase is blocked before a new checkout is created')
  const expired = await checkout(canceled.id)
  await stripe.checkout.sessions.expire(expired.id)
  assert.equal((await status(expired.id)).state, 'canceled')
  assert.equal((await check(service.from('purchases').select('id').eq('buyer_id', buyer.id).eq('product_id', canceled.id))).length, 0)
  pass('expired/canceled TEST checkout never grants a library item')
  const rejected = await checkout(failed.id)
  const decline = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_chargeDeclined' },
    billing_details: { name: 'Synthetic settlement verification', email: buyer.email } })
  try {
    await stripe.rawRequest('GET', `/v1/payment_pages/${rejected.id}`)
    await stripe.rawRequest('POST', `/v1/payment_pages/${rejected.id}/confirm`, { payment_method: decline.id, expected_amount: 500 })
    assert.fail('Declining TEST card must not complete payment')
  } catch (error) {
    if (error.type !== 'StripeCardError' && error.code !== 'card_declined') {
      console.error(JSON.stringify({ syntheticDeclineType: error.type ?? 'unknown', syntheticDeclineCode: code(error) }))
      throw new Error('Expected an actual TEST card decline')
    }
  }
  await discoverCheckoutObjects(rejected.id)
  assert.ok(['payment_failed', 'awaiting_payment'].includes((await status(rejected.id)).state))
  assert.equal((await check(service.from('purchases').select('id').eq('buyer_id', buyer.id).eq('product_id', failed.id))).length, 0)
  pass('declined real Stripe TEST payment creates no entitlement')

  const playwrightPath = process.env.ARDORE_PLAYWRIGHT_MODULE
  assert.ok(playwrightPath, 'Provide installed Playwright path for required mobile production verification')
  const { chromium } = require(playwrightPath)
  const browser = await chromium.launch({ headless: true, ...(process.env.ARDORE_CHROME_EXECUTABLE ? { executablePath: process.env.ARDORE_CHROME_EXECUTABLE } : {}) })
  try {
    for (const width of [375, 390]) {
      await buyer.refreshLogin()
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      await context.addCookies(buyer.cookie().split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: 'www.ardore-health.com', path: '/', secure: true, sameSite: 'Lax' } }))
      await context.addInitScript(({ owned, extra, coachId, slug }) => {
        if (!localStorage.getItem('ardore_fixture_cart_seeded')) {
          const item = row => ({ id: row.id, title: row.title, type: 'pdf', price: 5, thumbnail_url: null, creatorId: coachId, creatorName: 'Synthetic verification', creatorSlug: slug })
          localStorage.setItem('ardore_cart', JSON.stringify([item(owned), item(extra)])); localStorage.setItem('ardore_fixture_cart_seeded', '1')
        }
      }, { owned: product, extra: unrelated, coachId: coach.id, slug: tag })
      const page = await context.newPage()
      let probes = 0
      await page.route('**/api/stripe/purchase-status?*', async route => {
        probes += 1
        if (probes <= 2) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'processing', productIds: [], testMode: true }) })
        await route.continue()
      })
      await page.goto(`${base}/buyer/library?session_id=${purchase.id}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: 'Kauf wird verarbeitet' }).waitFor()
      await page.getByRole('heading', { name: 'Kauf bestätigt' }).waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Nur notwendige', exact: true }).click()
      assert.equal(await page.getByRole('heading', { name: product.title, exact: true }).count(), 1)
      assert.equal(await page.getByText('Testkauf', { exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Herunterladen' }).count(), 0)
      await page.waitForFunction(id => JSON.parse(localStorage.getItem('ardore_cart')).every(item => item.id !== id), product.id)
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('ardore_cart')))
      assert.deepEqual(cart.map(item => item.id), [unrelated.id])
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: 'Kauf bestätigt' }).waitFor()
      await page.getByRole('heading', { name: product.title, exact: true }).waitFor()
      assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('ardore_cart')))).map(item => item.id), [unrelated.id])
      pass(`production verified purchase, delayed-status UI, library refresh and cart at ${width}px`)
      // Use the real logout and login UI; unrelated cart storage must survive.
      // Leave the return URL first so its asynchronous router.refresh cannot
      // race the navbar interaction under test.
      await page.goto(`${base}/buyer/library`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: product.title, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click()
      await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
      await page.waitForURL(`${base}/`, { waitUntil: 'domcontentloaded' })
      await page.goto(`${base}/buyer/library`, { waitUntil: 'domcontentloaded' })
      assert.equal(new URL(page.url()).pathname, '/login')
      await buyer.loginPage(page)
      await page.waitForURL(`${base}/buyer/library`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: product.title, exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: product.title, exact: true }).count(), 1)
      assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('ardore_cart')))).map(item => item.id), [unrelated.id])
      await context.close()
      pass(`production library, delayed-status UI, cart preservation and logout/login at ${width}px`)
    }
  } finally { await browser.close() }
}

async function partialRefundTests(buyer) {
  for (const timing of ['before', 'after']) {
    const ownedOrder = await order('products', buyer)
    const paid = await payment(ownedOrder)
    const row = await recorded(ownedOrder, paid)
    if (timing === 'after') await library.settlePayment({ service, settlementId: row.id })
    await library.prepareSettlementRefund({ service, paymentIntentId: paid.id, targetRefundedCents: 100,
      refundKey: `${tag}-${paid.id}-partial-refund-v1` })
    const partial = await stripe.refunds.create({ payment_intent: paid.id, amount: 100,
      metadata: { ardore_synthetic_run: run } }, { idempotencyKey: `${tag}-${paid.id}-partial-refund-v1` })
    ownedRefunds.add(partial.id)
    assert.equal(partial.status, 'succeeded')
    await library.reconcileSettlementRefund({ service, paymentIntentId: paid.id })
    await library.reconcileSettlementRefund({ service, paymentIntentId: paid.id })
    await library.settlePayment({ service, settlementId: row.id })
    await library.settlePayment({ service, settlementId: row.id })
    await library.reconcileSettlementRefund({ service, paymentIntentId: paid.id })
    const transfer = await transferFor(paid)
    assert.equal(transfer.length, 1)
    assert.equal(transfer[0].amount - transfer[0].amount_reversed, 360)
    assert.equal(transfer[0].amount, timing === 'before' ? 360 : 450)
    assert.equal(transfer[0].amount_reversed, timing === 'before' ? 0 : 90)
    const entitlements = await check(service.from('purchases').select('payment_status,amount_refunded')
      .eq('buyer_id', buyer.id).eq('product_id', [...products].at(-1)).eq('stripe_payment_intent_id', paid.id))
    assert.equal(entitlements.length, 1); assert.equal(entitlements[0].payment_status, 'partially_refunded')
    assert.equal(entitlements[0].amount_refunded, 1)
    await fullRefund(paid, 2)
    await fullRefund(paid, 2)
    const reversals = await stripe.transfers.listReversals(transfer[0].id, { limit: 100 })
    assert.equal(reversals.data.length, timing === 'before' ? 1 : 2)
    assert.equal(reversals.data.reduce((sum, value) => sum + value.amount, 0), transfer[0].amount)
    const terminal = await ledgerFor(paid)
    const stale = await check(service.rpc('observe_payment_settlement', { p_settlement_id: terminal.id,
      p_snapshot: { refunded_cents: 0, reversed_cents: 0, reversal_ids: [],
        checked_at: new Date(Date.now() + 1000).toISOString() } }))
    assert.equal(stale.state, 'refunded'); assert.equal(stale.fulfillment_state, 'refunded')
    assert.equal(stale.amount_refunded_cents, 500); assert.equal(stale.amount_reversed_cents, transfer[0].amount)
    assert.equal(stale.stripe_transfer_id, transfer[0].id)
    assert.deepEqual(new Set(stale.transfer_reversal_ids), new Set(terminal.transfer_reversal_ids))
    pass(`real partial refund ${timing} transfer retains exact net share and cumulative full refund never over-reverses`)
  }
}

async function historicalDestinationTest(buyer) {
  const booking = await check(service.from('bookings').insert({ creator_id: coach.id, buyer_id: buyer.id,
    buyer_email: buyer.email, buyer_name: 'Synthetic settlement verification',
    scheduled_at: new Date(Date.now() + 8 * 86_400_000).toISOString(), duration_minutes: 60,
    price_cents: 500, status: 'pending_payment', payment_status: 'pending', stripe_livemode: false,
    cancellation_policy_hours: 24, reservation_expires_at: new Date(Date.now() + 1_860_000).toISOString() }).select('*').single())
  bookings.add(booking.id)
  const claim = await check(service.rpc('begin_coaching_payment_attempt', { p_booking_id: booking.id, p_buyer_id: buyer.id,
    p_livemode: false, p_expires_at: booking.reservation_expires_at, p_destination_account_id: fixture.accountId,
    p_application_fee_cents: 50, p_charge_architecture: 'destination' }))
  assert.equal(claim.attempt.charge_architecture, 'destination')
  const metadata = { ardore_synthetic_run: run, checkout_type: 'coaching_session', booking_id: booking.id,
    payment_attempt_id: claim.attempt.id, buyer_id: buyer.id, creator_id: coach.id, scheduled_at: booking.scheduled_at }
  const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'],
    customer_email: buyer.email, metadata, payment_intent_data: { metadata,
      application_fee_amount: 50, transfer_data: { destination: fixture.accountId } },
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 500,
      product_data: { name: 'Synthetic historical destination-charge compatibility' } } }],
    expires_at: Math.floor((Date.now() + 1_860_000) / 1000), success_url: `${base}/buyer/sessions`, cancel_url: `${base}/buyer/sessions`,
  }, { idempotencyKey: `${tag}-${booking.id}-historical-checkout-v1` })
  sessions.add(session.id)
  await check(service.rpc('register_coaching_checkout', { p_attempt_id: claim.attempt.id,
    p_session_id: session.id, p_session_url: session.url }))
  const method = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' },
    billing_details: { name: 'Synthetic settlement verification', email: buyer.email } })
  try {
    await stripe.rawRequest('GET', `/v1/payment_pages/${session.id}`)
    await stripe.rawRequest('POST', `/v1/payment_pages/${session.id}/confirm`, { payment_method: method.id, expected_amount: 500 })
  } finally { await discoverCheckoutObjects(session.id) }
  const paidSession = await stripe.checkout.sessions.retrieve(session.id)
  const paid = await stripe.paymentIntents.retrieve(objectId(paidSession.payment_intent))
  assert.equal(paid.status, 'succeeded'); assert.equal(paid.application_fee_amount, 50)
  const lifecycle = loadSource('src/lib/coaching-payment-lifecycle.ts')
  await lifecycle.reconcileCoachingCheckout({ service, sessionId: session.id, stripeLivemode: false })
  const confirmed = await check(service.from('bookings').select('*').eq('id', booking.id).single())
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.payment_status, 'paid')
  const ledgerRows = await check(service.from('payment_settlements').select('id').eq('stripe_payment_intent_id', paid.id))
  assert.equal(ledgerRows.length, 0, 'Historical destination charge must not create a separate transfer ledger')
  const cancellation = await check(service.rpc('cancel_coaching_booking', { p_booking_id: booking.id, p_actor_user_id: buyer.id }))
  assert.equal(cancellation.booking.status, 'cancelled'); assert.ok(cancellation.refund)
  const refunds = loadSource('src/lib/coaching-refund.ts')
  const first = await refunds.processCoachingRefund({ service, booking: cancellation.booking, request: cancellation.refund })
  assert.ok(['pending', 'succeeded'].includes(first.state))
  const repeated = await waitFor('legacy_destination_refund_succeeded', async () => {
    const result = await refunds.processCoachingRefund({ service, booking: cancellation.booking, request: cancellation.refund })
    assert.notEqual(result.state, 'failed')
    return result.state === 'succeeded' ? result : null
  })
  assert.equal(repeated.state, 'succeeded')
  const providerRefunds = await stripe.refunds.list({ payment_intent: paid.id, limit: 100 })
  assert.equal(providerRefunds.data.length, 1); assert.equal(providerRefunds.data[0].amount, 500)
  assert.equal(providerRefunds.data[0].status, 'succeeded'); ownedRefunds.add(providerRefunds.data[0].id)
  const charge = await stripe.charges.retrieve(objectId(paid.latest_charge))
  const transfer = await stripe.transfers.retrieve(objectId(charge.transfer))
  assert.equal(objectId(transfer.destination), fixture.accountId); assert.equal(transfer.amount_reversed, transfer.amount)
  ownedTransfers.add(transfer.id)
  const reversals = await stripe.transfers.listReversals(transfer.id, { limit: 100 })
  assert.equal(reversals.data.length, 1)
  for (const value of reversals.data) ownedReversals.add(value.id)
  const fee = await stripe.applicationFees.retrieve(objectId(charge.application_fee))
  assert.equal(fee.amount, 50); assert.equal(fee.amount_refunded, 50)
  pass('genuine historical destination charge keeps legacy fulfillment and reverses transfer/application fee on one full refund')
}

async function restrictedCoachTest(buyer) {
  // Stripe does not expose payouts_enabled as a writable status. Create a
  // genuinely incomplete owned TEST account and inspect its actual provider
  // restriction, rather than pretending a mocked response is provider proof.
  const account = await stripe.v2.core.accounts.create({ dashboard: 'none',
    contact_email: buyer.email, display_name: 'Synthetic restricted settlement verification',
    identity: { country: 'DE', entity_type: 'individual',
      attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '127.0.0.1' } } } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } }, mcc: '7299' },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    defaults: { currency: 'eur', responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      profile: { business_url: 'https://accessible.stripe.com', product_description: 'Synthetic settlement verification' } },
    metadata: { ardore_synthetic: 'settlement', test_run: run, ardore_creator_id: coach.id },
  }, { idempotencyKey: `${tag}-restricted-account-v1` })
  assert.equal(account.livemode, false); assert.equal(account.metadata.test_run, run)
  restrictedFixtures.push({ accountId: account.id, testRun: run })
  const providerState = await stripe.accounts.retrieve(account.id)
  assert.equal(providerState.payouts_enabled, false)
  await check(service.from('creator_profiles').update({ stripe_account_id: account.id }).eq('id', coach.id).in('user_id', users))
  try {
    const readiness = loadSource('src/lib/stripe/connect-readiness.ts')
    await assert.rejects(readiness.requirePayoutReadyCoach(service, coach.id), { code: 'connect_account_not_ready' })
    const ownedOrder = await order('products', buyer, {}, 500, account.id)
    const paid = await payment(ownedOrder)
    const saved = await recorded(ownedOrder, paid)
    const held = await library.settlePayment({ service, settlementId: saved.id })
    assert.equal(held.state, 'held'); assert.equal(held.stripe_transfer_id, null)
    assert.equal((await transferFor(paid)).length, 0)
    await fullRefund(paid)
    pass('genuine Stripe payouts-disabled account cannot authorize checkout or settlement and held TEST payment fully refunds')
  } finally {
    await check(service.from('creator_profiles').update({ stripe_account_id: fixture.accountId }).eq('id', coach.id).in('user_id', users))
  }
}

async function tests(buyer) {
  for (const kind of ['booking', 'products']) {
    const ownedOrder = await order(kind, buyer)
    const paid = await payment(ownedOrder)
    const first = await recorded(ownedOrder, paid)
    const duplicate = await recorded(ownedOrder, paid)
    assert.equal(first.id, duplicate.id)
    const simultaneous = await Promise.allSettled([library.settlePayment({ service, settlementId: first.id }),
      library.settlePayment({ service, settlementId: first.id })])
    assert.ok(simultaneous.some(value => value.status === 'fulfilled'))
    assert.ok(simultaneous.every(value => value.status === 'fulfilled' || value.reason?.code === 'settlement_busy'))
    await library.settlePayment({ service, settlementId: first.id })
    const transfers = await transferFor(paid)
    assert.equal(transfers.length, 1)
    assert.equal(transfers[0].amount, 450)
    assert.equal(transfers[0].currency, 'eur')
    assert.equal((ownedOrder.platform_fee_cents ?? 50), 50)
    assert.equal((await ledgerFor(paid)).stripe_transfer_id, transfers[0].id)
    pass(`real TEST ${kind} payment has one correct coach transfer and 10% platform fee`)
    const refund = await fullRefund(paid)
    const repeated = await fullRefund(paid)
    assert.equal(refund.id, repeated.id)
    const reversals = await stripe.transfers.listReversals(transfers[0].id, { limit: 100 })
    assert.equal(reversals.data.length, 1)
    assert.equal(reversals.data[0].amount, 450)
    pass(`${kind} full refund and repeated reconciliation reverse/refund exactly once`)
  }

  const failedOrder = await order('products', buyer)
  const failedPayment = await payment(failedOrder)
  const failedSettlement = await recorded(failedOrder, failedPayment)
  const actualCreate = stripe.transfers.create.bind(stripe.transfers)
  stripe.transfers.create = async () => { throw Object.assign(new Error('Synthetic provider rejection'), {
    type: 'StripeInvalidRequestError', code: 'balance_insufficient' }) }
  try { await library.settlePayment({ service, settlementId: failedSettlement.id }).catch(() => {}) }
  finally { stripe.transfers.create = actualCreate }
  assert.equal((await transferFor(failedPayment)).length, 0)
  await library.settlePayment({ service, settlementId: failedSettlement.id })
  assert.equal((await transferFor(failedPayment)).length, 1)
  await fullRefund(failedPayment)
  pass('known transfer rejection retries once without duplicate earnings or movement')

  const lostOrder = await order('products', buyer)
  const lostPayment = await payment(lostOrder)
  const lostSettlement = await recorded(lostOrder, lostPayment)
  let createCalls = 0
  stripe.transfers.create = async (...args) => {
    createCalls++
    await actualCreate(...args)
    throw Object.assign(new Error('Synthetic response lost after provider accepted'), {
      type: 'StripeConnectionError', code: 'synthetic_connection_lost' })
  }
  try { await library.settlePayment({ service, settlementId: lostSettlement.id }).catch(() => {}) }
  finally { stripe.transfers.create = actualCreate }
  assert.equal(createCalls, 1)
  assert.equal((await transferFor(lostPayment)).length, 1)
  await library.settlePayment({ service, settlementId: lostSettlement.id })
  assert.equal((await transferFor(lostPayment)).length, 1)
  assert.ok((await ledgerFor(lostPayment)).stripe_transfer_id)
  await fullRefund(lostPayment)
  pass('lost transfer response recovers existing provider transfer without a duplicate POST or earning')

  const heldOrder = await order('products', buyer)
  const heldPayment = await payment(heldOrder)
  const heldSettlement = await recorded(heldOrder, heldPayment)
  // Only this run's coach association changes. A historic transfer may never be
  // redirected to a replacement account while ownership is unavailable.
  await check(service.from('creator_profiles').update({ stripe_account_id: null }).eq('id', coach.id).in('user_id', users))
  const readiness = loadSource('src/lib/stripe/connect-readiness.ts')
  await assert.rejects(readiness.requirePayoutReadyCoach(service, coach.id), { code: 'connect_account_missing' })
  await library.settlePayment({ service, settlementId: heldSettlement.id }).catch(() => {})
  assert.equal((await transferFor(heldPayment)).length, 0)
  await check(service.from('creator_profiles').update({ stripe_account_id: fixture.accountId }).eq('id', coach.id).in('user_id', users))
  await library.settlePayment({ service, settlementId: heldSettlement.id })
  assert.equal((await transferFor(heldPayment)).length, 1)
  await fullRefund(heldPayment)
  pass('lost coach association holds settlement safely and restores only frozen original destination')

  const earlyRefundOrder = await order('products', buyer)
  const earlyRefundPayment = await payment(earlyRefundOrder)
  const earlyRefundSettlement = await recorded(earlyRefundOrder, earlyRefundPayment)
  await fullRefund(earlyRefundPayment)
  await library.settlePayment({ service, settlementId: earlyRefundSettlement.id })
  assert.equal((await transferFor(earlyRefundPayment)).length, 0)
  assert.equal((await ledgerFor(earlyRefundPayment)).amount_refunded_cents, 500)
  pass('refund before settlement blocks late duplicate payment events from transferring coach funds')

  const rejectedThenRefundedOrder = await order('products', buyer)
  const rejectedThenRefundedPayment = await payment(rejectedThenRefundedOrder)
  const rejectedThenRefundedSettlement = await recorded(rejectedThenRefundedOrder, rejectedThenRefundedPayment)
  stripe.transfers.create = async () => { throw Object.assign(new Error('Synthetic provider rejection'), {
    type: 'StripeInvalidRequestError', code: 'balance_insufficient' }) }
  try { await library.settlePayment({ service, settlementId: rejectedThenRefundedSettlement.id }).catch(() => {}) }
  finally { stripe.transfers.create = actualCreate }
  await fullRefund(rejectedThenRefundedPayment)
  await library.settlePayment({ service, settlementId: rejectedThenRefundedSettlement.id })
  assert.equal((await transferFor(rejectedThenRefundedPayment)).length, 0)
  pass('full refund after a definitely rejected transfer finishes without phantom reversal or later transfer')

  const lostReversalOrder = await order('products', buyer)
  const lostReversalPayment = await payment(lostReversalOrder)
  const lostReversalSettlement = await recorded(lostReversalOrder, lostReversalPayment)
  await library.settlePayment({ service, settlementId: lostReversalSettlement.id })
  const actualReverse = stripe.transfers.createReversal.bind(stripe.transfers)
  let reverseCalls = 0
  stripe.transfers.createReversal = async (...args) => {
    reverseCalls++
    await actualReverse(...args)
    throw Object.assign(new Error('Synthetic reversal response lost after provider accepted'), {
      type: 'StripeConnectionError', code: 'synthetic_connection_lost' })
  }
  try {
    await library.prepareSettlementRefund({ service, paymentIntentId: lostReversalPayment.id,
      targetRefundedCents: 500, refundKey: `${tag}-${lostReversalPayment.id}-full-refund-v1` }).catch(() => {})
  } finally { stripe.transfers.createReversal = actualReverse }
  assert.equal(reverseCalls, 1)
  await fullRefund(lostReversalPayment)
  const reversalActions = await check(service.from('payment_settlement_actions').select('*')
    .eq('settlement_id', lostReversalSettlement.id).eq('kind', 'reversal'))
  assert.equal(reversalActions.length, 1)
  assert.ok(reversalActions[0].stripe_object_id)
  assert.equal(reversalActions[0].uncertain, false)
  pass('lost reversal response is adopted into durable action and never creates a second reversal')
  await recurringTest(buyer)
  await partialRefundTests(buyer)
  await historicalDestinationTest(buyer)
  await restrictedCoachTest(buyer)
}

async function assertNoUnexpectedInteractions() {
  if (!coach) return
  const ownedUsers = new Set(users)
  const profiles = await check(service.from('creator_profiles').select('id,user_id').eq('id', coach.id))
  assert.equal(profiles.length, 1)
  assert.ok(ownedUsers.has(profiles[0].user_id), 'Synthetic coach owner must remain owned')
  for (const [table, expected] of [['products', products], ['subscription_tiers', tiers], ['bookings', bookings],
    ['payment_orders', orders], ['payment_settlements', settlements]]) {
    const rows = await check(service.from(table).select(table === 'products' || table === 'subscription_tiers'
      ? 'id' : table === 'payment_settlements' ? 'id,buyer_id,order_id' : 'id,buyer_id').eq('creator_id', coach.id))
    assert.ok(rows.every(row => expected.has(row.id)), 'Preserve untracked synthetic-coach commerce records')
    assert.ok(rows.every(row => !('buyer_id' in row) || ownedUsers.has(row.buyer_id)), 'Preserve any outside buyer interaction')
    if (table === 'payment_settlements') assert.ok(rows.every(row => orders.has(row.order_id)), 'Preserve untracked financial orders')
  }
  for (const [table, userColumn] of [['subscriptions', 'buyer_id'], ['session_reviews', 'buyer_id'],
    ['chat_conversations', 'buyer_id'], ['chat_last_read', 'buyer_id'], ['messages', 'sender_id']]) {
    const rows = await check(service.from(table).select(userColumn).eq('creator_id', coach.id))
    assert.ok(rows.every(row => ownedUsers.has(row[userColumn])), 'Preserve any outside coach interaction')
  }
  const conversations = await check(service.from('chat_conversations').select('id').eq('creator_id', coach.id))
  if (conversations.length) {
    const participants = await check(service.from('chat_conversation_participants').select('user_id')
      .in('conversation_id', conversations.map(row => row.id)))
    assert.ok(participants.every(row => ownedUsers.has(row.user_id)), 'Preserve any outside chat participant')
  }
  if (products.size) {
    for (const table of ['purchases', 'reviews']) {
      const rows = await check(service.from(table).select('buyer_id').in('product_id', [...products]))
      assert.ok(rows.every(row => ownedUsers.has(row.buyer_id)), 'Preserve any outside product interaction')
    }
  }
  if (tiers.size) {
    const rows = await check(service.from('subscriptions').select('buyer_id').in('tier_id', [...tiers]))
    assert.ok(rows.every(row => ownedUsers.has(row.buyer_id)), 'Preserve any outside tier subscription')
  }
  const favoriteRows = await check(service.from('favorites').select('user_id').in('item_id', [coach.id, ...products, ...tiers]))
  assert.ok(favoriteRows.every(row => ownedUsers.has(row.user_id)), 'Preserve any outside favorite')
  // This matrix never creates discounts, so any coach/product/tier discount is
  // untracked and must not be removed through a commercial parent cascade.
  const discounts = await check(service.from('discounts').select('id').eq('creator_id', coach.id))
  assert.equal(discounts.length, 0, 'Preserve any untracked coach discount')
  for (const [column, ids] of [['target_product_id', products], ['target_tier_id', tiers]]) {
    if (ids.size) {
      const rows = await check(service.from('discounts').select('id').in(column, [...ids]))
      assert.equal(rows.length, 0, 'Preserve any untracked offer discount')
    }
  }
}

async function cleanup() {
  const errors = []
  try { await assertNoUnexpectedInteractions() }
  catch {
    console.error(JSON.stringify({ cleanupPreservedForUnexpectedInteraction: true }))
    return false
  }
  // Remove only this run's offers from discovery while financial cleanup runs.
  // Existing outside references, if any, were preserved by the guard above.
  if (coach && products.size) await check(service.from('products').update({ is_published: false })
    .in('id', [...products]).eq('creator_id', coach.id))
  if (coach && tiers.size) await check(service.from('subscription_tiers').update({ is_active: false })
    .in('id', [...tiers]).eq('creator_id', coach.id))
  // Discover provider objects even when Checkout confirmation throws after
  // Stripe accepted payment, before allowing any functional fixture deletion.
  for (const sessionId of sessions) {
    try { await discoverCheckoutObjects(sessionId) }
    catch (error) { errors.push(`checkout_discovery:${code(error)}`) }
  }
  for (const subscriptionId of subscriptions) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      assert.equal(subscription.metadata.ardore_synthetic_run, run)
      if (subscription.status !== 'canceled') await stripe.subscriptions.cancel(subscriptionId)
    } catch (error) { errors.push(`subscription:${code(error)}`) }
  }
  for (const sessionId of sessions) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      assert.equal(session.metadata.ardore_synthetic_run, run)
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id)
    } catch (error) { errors.push(`session:${code(error)}`) }
  }
  for (const paymentId of intents) {
    try {
      const paid = await stripe.paymentIntents.retrieve(paymentId)
      assert.equal(paid.metadata.ardore_synthetic_run, run)
      assert.equal(paid.livemode, false)
      const chargeId = objectId(paid.latest_charge)
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId)
        assert.equal(charge.metadata.ardore_synthetic_run, run)
        if (paid.status === 'succeeded') {
          // This fallback is scoped to owned provider IDs and remains safe if
          // the assertion under test prevented the normal library cleanup.
          const transfers = await transferFor(paid)
          for (const transfer of transfers) {
            const remaining = transfer.amount - transfer.amount_reversed
            if (remaining > 0) {
              const reversed = await stripe.transfers.createReversal(transfer.id,
              { amount: remaining, metadata: { ardore_synthetic_run: run, cleanup: 'true' } },
              { idempotencyKey: `${tag}-${transfer.id}-cleanup-reversal-v1` })
              ownedReversals.add(reversed.id)
            }
            const reversals = await stripe.transfers.listReversals(transfer.id, { limit: 100 })
            assert.ok(!reversals.has_more)
            for (const reversed of reversals.data) ownedReversals.add(reversed.id)
          }
          const refunds = await stripe.refunds.list({ payment_intent: paymentId, limit: 100 })
          assert.ok(!refunds.has_more)
          for (const refund of refunds.data) ownedRefunds.add(refund.id)
          const reserved = refunds.data.filter(value => !['failed', 'canceled'].includes(value.status)).reduce((sum, value) => sum + value.amount, 0)
          if (reserved < charge.amount_captured) {
            const refunded = await stripe.refunds.create({ payment_intent: paymentId,
            amount: charge.amount_captured - reserved, metadata: { ardore_synthetic_run: run, cleanup: 'true' } },
            { idempotencyKey: `${tag}-${paymentId}-cleanup-refund-v1` })
            ownedRefunds.add(refunded.id)
          }
          if (objectId(charge.application_fee)) {
            const fee = await stripe.applicationFees.retrieve(objectId(charge.application_fee))
            assert.equal(fee.livemode, false); assert.equal(objectId(fee.account), fixture.accountId)
            assert.equal(objectId(fee.originating_transaction), charge.id)
            const remainingFee = fee.amount - fee.amount_refunded
            if (remainingFee > 0) await stripe.applicationFees.createRefund(fee.id,
              { amount: remainingFee, metadata: { ardore_synthetic_run: run, cleanup: 'true' } },
              { idempotencyKey: `${tag}-${fee.id}-cleanup-refund-v1` })
          }
        }
      }
      if (!['succeeded', 'canceled'].includes(paid.status)) await stripe.paymentIntents.cancel(paymentId)
      await stripe.paymentIntents.update(paymentId, { metadata: { ardore_synthetic_cleanup: 'completed' } })
    } catch (error) { errors.push(`payment:${code(error)}`) }
  }
  if (errors.length) { console.error(JSON.stringify({ financialCleanupBlocked: errors })); return false }
  if (intents.size) await sleep(5000)
  // TEST Stripe history cannot be deleted. Keep only its proven owned object
  // IDs as a private tombstone so delayed signed events cannot recreate fixtures
  // or retry forever after GoTrue/commerce rows and clocks have been removed.
  const retiredIds = [...new Set([...sessions, ...intents, ...ownedCharges, ...subscriptions,
    ...invoices, ...ownedTransfers, ...ownedReversals, ...ownedRefunds, ...customers, ...immutableCatalogIds])]
  if (retiredIds.length) await check(service.from('retired_stripe_test_runs').upsert({ id: run,
    object_ids: retiredIds }, { onConflict: 'id' }))
  for (const customerId of customers) {
    const customer = await stripe.customers.retrieve(customerId)
    assert.equal(customer.metadata.ardore_synthetic_run, run)
    await stripe.customers.del(customerId)
  }
  for (const priceId of stripePrices) {
    const price = await stripe.prices.retrieve(priceId)
    assert.equal(price.metadata.ardore_synthetic_run, run)
    await stripe.prices.update(priceId, { active: false, metadata: { ardore_synthetic_cleanup: 'completed' } })
  }
  for (const productId of stripeProducts) {
    const product = await stripe.products.retrieve(productId)
    assert.equal(product.metadata.ardore_synthetic_run, run)
    await stripe.products.update(productId, { active: false, metadata: { ardore_synthetic_cleanup: 'completed' } })
  }
  for (const clockId of testClocks) await stripe.testHelpers.testClocks.del(clockId)
  // Check again immediately before parent deletions can cascade. A real visitor
  // might have interacted with a briefly published fixture during cleanup.
  try { await assertNoUnexpectedInteractions() }
  catch {
    console.error(JSON.stringify({ cleanupPreservedForUnexpectedInteraction: true }))
    return false
  }
  // The exact ledger table names are derived only from the repository's owned
  // settlement migration. Child rows are removed before their synthetic order.
  const migrationNames = readdirSync(resolve(root, 'supabase/migrations')).filter(name => /settlement.*\.sql$/.test(name)).sort()
  if (orders.size && migrationNames.length) {
    const migration = migrationNames.map(name => readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')).join('\n')
    const tables = [...new Set([...migration.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z_][a-z0-9_]*)/gi)]
      .map(match => match[1]).filter(name => name !== 'retired_stripe_test_runs'))]
    for (const table of [...tables].reverse()) {
      if (/orders/.test(table)) await check(service.from(table).delete().in('id', [...orders]).eq('creator_id', coach.id))
      else if (/actions/.test(table)) {
        if (settlements.size) await check(service.from(table).delete().in('settlement_id', [...settlements]))
      } else await check(service.from(table).delete().in('order_id', [...orders]))
    }
  }
  if (fixture) await cleanupSyntheticConnectFixture({ stripe, ...fixture,
    onProgress: value => console.log(JSON.stringify({ phase: 'fixture_cleanup', ...value })) })
  for (const restricted of restrictedFixtures) await cleanupSyntheticConnectFixture({ stripe, ...restricted })
  if (coach) {
    if (bookings.size) {
      await check(service.from('booking_refunds').delete().in('booking_id', [...bookings]))
      await check(service.from('bookings').delete().in('id', [...bookings]).eq('creator_id', coach.id))
    }
    if (products.size) {
      await check(service.from('purchases').delete().in('product_id', [...products]).in('buyer_id', users))
      await check(service.from('products').delete().in('id', [...products]).eq('creator_id', coach.id))
    }
    if (subscriptions.size) await check(service.from('subscriptions').delete().in('stripe_subscription_id', [...subscriptions]).eq('creator_id', coach.id))
    if (tiers.size) await check(service.from('subscription_tiers').delete().in('id', [...tiers]).eq('creator_id', coach.id))
    const interactions = await check(service.from('bookings').select('id').eq('creator_id', coach.id))
    assert.equal(interactions.length, 0, 'Preserve any unexpected interaction with synthetic coach')
    await check(service.from('creator_profiles').delete().eq('id', coach.id).in('user_id', users))
  }
  for (const value of actors) await value.client.auth.signOut()
  if (users.length) await check(service.from('notifications').delete().in('user_id', users))
  for (const userId of users) {
    const deleted = await service.auth.admin.deleteUser(userId)
    if (deleted.error) throw Object.assign(new Error('GoTrue cleanup failed'), { code: deleted.error.code })
  }
  return true
}

try {
  assert.equal((await stripe.balance.retrieve()).livemode, false)
  const libraryPath = ['src/lib/stripe/settlement.ts', 'src/lib/payment-settlement.ts', 'src/lib/settlement.ts'].find(path => existsSync(resolve(root, path)))
  assert.ok(libraryPath, 'Settlement implementation must exist before fixture creation')
  library = loadSource(libraryPath)
  for (const name of ['createSettlementOrder','registerSettlementCheckout','recordSuccessfulSettlement','settlePayment','prepareSettlementRefund','reconcileSettlementRefund','reconcileSettlementInvoice']) {
    assert.equal(typeof library[name], 'function', `Production library must expose ${name}`)
  }
  const buyer = await actor('buyer'), coachActor = await actor('creator')
  coach = await check(service.from('creator_profiles').insert({ user_id: coachActor.id,
    display_name: 'Synthetic settlement verification', slug: tag, categories: ['yoga'], category: 'yoga', is_published: true, onboarding_step: 5 }).select('id').single())
  fixture = await createSyntheticConnectFixture({ stripe, testRun: run,
    onProgress: value => console.log(JSON.stringify({ phase: 'readiness', ...value })) })
  const ownedAccount = await stripe.v2.core.accounts.retrieve(fixture.accountId)
  assert.equal(ownedAccount.metadata.test_run, run)
  await stripe.v2.core.accounts.update(fixture.accountId, { metadata: { ...ownedAccount.metadata, ardore_creator_id: coach.id } },
    { idempotencyKey: `${tag}-coach-owner-v1` })
  await check(service.from('creator_profiles').update({ stripe_account_id: fixture.accountId }).eq('id', coach.id).eq('user_id', coachActor.id))
  if (process.argv.includes('--purchase-lifecycle-only')) await purchaseLifecycleTests(buyer)
  else if (process.argv.includes('--deployed-flow')) await deployedTests(buyer)
  else if (process.argv.includes('--partial-only')) await partialRefundTests(buyer)
  else if (process.argv.includes('--compatibility-only')) await historicalDestinationTest(buyer)
  else if (process.argv.includes('--additional-only')) {
    await partialRefundTests(buyer)
    await historicalDestinationTest(buyer)
    await restrictedCoachTest(buyer)
  }
  else await tests(buyer)
} catch (error) {
  console.error(JSON.stringify({ failedAfter: results.at(-1) ?? 'setup', code: code(error),
    location: error.stack?.split('\n').find(line => line.includes('test-synthetic-settlement.mjs:'))?.trim() }))
  process.exitCode = 1
} finally {
  try { console.log(JSON.stringify({ passed: results.length, mutableSyntheticDataCleaned: await cleanup() })) }
  catch (error) { console.error(JSON.stringify({ cleanupFailed: true, code: code(error) })); process.exitCode = 1 }
}
