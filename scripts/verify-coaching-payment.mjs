import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bookingRoute = readFileSync(new URL('../src/app/api/coaching/book/route.ts', import.meta.url), 'utf8')
const webhookRoute = readFileSync(new URL('../src/app/api/webhooks/stripe/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/025_add_coaching_payment_lifecycle.sql', import.meta.url), 'utf8')
const feeHelper = readFileSync(new URL('../src/lib/stripe/platformFee.ts', import.meta.url), 'utf8')
const paymentHelper = readFileSync(new URL('../src/lib/coaching-payment.ts', import.meta.url), 'utf8')
const reminderRoute = readFileSync(new URL('../src/app/api/cron/session-reminders/route.ts', import.meta.url), 'utf8')
const reviewPromptRoute = readFileSync(new URL('../src/app/api/cron/session-review-prompts/route.ts', import.meta.url), 'utf8')

assert.match(bookingRoute, /status: requiresPayment \? 'pending_payment' : 'confirmed'/)
assert.match(bookingRoute, /calculateArdorePlatformFee\(discountedPriceCents\)/)
assert.match(bookingRoute, /stripe\.checkout\.sessions\.create/)
assert.match(webhookRoute, /eq\('status', 'pending_payment'\)\.eq\('payment_status', 'pending'\)/)
assert.match(webhookRoute, /checkout\.session\.expired/)
assert.match(webhookRoute, /charge\.refunded/)
assert.match(webhookRoute, /charge\.dispute\.created/)
assert.match(webhookRoute, /event\.livemode !== configuredLiveMode/)
assert.match(migration, /WHERE \(status IN \('pending_payment', 'confirmed'\)\)/)
assert.match(migration, /stripe_livemode boolean/)
assert.match(feeHelper, /ARDORE_PLATFORM_FEE_BASIS_POINTS = 1_000/)
assert.match(paymentHelper, /payment_status === 'not_required'/)
assert.match(paymentHelper, /payment_status === 'paid' && booking\.stripe_livemode === true/)
assert.match(paymentHelper, /payment_status\.eq\.not_required,and\(payment_status\.eq\.paid,stripe_livemode\.eq\.true\)/)
assert.match(reminderRoute, /COACHING_PAYMENT_ELIGIBILITY_FILTER/)
assert.match(reviewPromptRoute, /COACHING_PAYMENT_ELIGIBILITY_FILTER/)

const fee = cents => Math.round(cents * 1_000 / 10_000)
assert.equal(fee(1000), 100)
assert.equal(fee(4999), 500)

console.log('Coaching payment lifecycle checks passed (18 assertions).')
