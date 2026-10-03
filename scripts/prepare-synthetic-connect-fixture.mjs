import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'

// Published Stripe sandbox fixtures, never real identity or bank information.
// https://docs.stripe.com/connect/testing
// https://docs.stripe.com/api/v2/core/accounts/create
const SYNTHETIC_TYPE = 'settlement'
const TEST_IBAN = 'DE89370400440532013000'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function safeCode(error) {
  const code = error?.code
  return typeof code === 'string' && /^[a-z_]{1,100}$/.test(code) ? code : 'synthetic_connect_provider_error'
}

function assertRun(testRun) {
  assert.match(testRun, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
}

async function assertTestProvider(provider) {
  // Check the provider's actual mode before any mutation, even for callers
  // passing an existing Stripe instance rather than an API key.
  const balance = await provider.balance.retrieve()
  assert.equal(balance.livemode, false, 'Synthetic Connect fixtures require Stripe TEST mode')
}

function assertOwned(account, testRun) {
  assert.equal(account.livemode, false)
  assert.equal(account.metadata?.ardore_synthetic, SYNTHETIC_TYPE)
  assert.equal(account.metadata?.test_run, testRun)
}

export async function readSyntheticConnectFixture({ stripe: provider, accountId, testRun }) {
  assertRun(testRun)
  await assertTestProvider(provider)
  const [v2, v1] = await Promise.all([
    provider.v2.core.accounts.retrieve(accountId, { include: ['configuration.merchant', 'configuration.recipient', 'requirements'] }),
    provider.accounts.retrieve(accountId),
  ])
  assertOwned(v2, testRun)
  const recipient = v2.configuration?.recipient?.capabilities?.stripe_balance
  const merchant = v2.configuration?.merchant?.capabilities
  return {
    accountId: v2.id,
    closed: v2.closed === true,
    livemode: false,
    transfersStatus: recipient?.stripe_transfers?.status ?? 'unknown',
    payoutsStatus: recipient?.payouts?.status ?? merchant?.stripe_balance?.payouts?.status ?? 'unknown',
    cardPaymentsStatus: merchant?.card_payments?.status ?? 'unknown',
    chargesEnabled: v1.charges_enabled === true,
    payoutsEnabled: v1.payouts_enabled === true,
    requirementsDue: v1.requirements?.currently_due ?? [],
    requirementsPending: v1.requirements?.pending_verification ?? [],
    requirementDeadlineStatus: v2.requirements?.summary?.minimum_deadline?.status ?? null,
    // All fields above are status/field identifiers. Identity and bank details
    // are intentionally omitted from returned progress objects.
  }
}

/** Close only this caller's disposable test account, after its funds are settled. */
export async function cleanupSyntheticConnectFixture({ stripe: provider, accountId, testRun,
  maxWaitMs = 60_000, onProgress = () => {} }) {
  assertRun(testRun)
  await assertTestProvider(provider)
  const started = Date.now()
  while (true) {
    const account = await provider.v2.core.accounts.retrieve(accountId)
    assertOwned(account, testRun)
    if (account.closed) return { cleaned: true, livemode: false }
    try {
      const closed = await provider.v2.core.accounts.close(account.id, {
        applied_configurations: account.applied_configurations,
      })
      assert.equal(closed.closed, true)
      return { cleaned: true, livemode: false }
    } catch (error) {
      const code = safeCode(error)
      if (Date.now() - started >= maxWaitMs) throw new Error(`Synthetic Connect cleanup incomplete: ${code}`)
      onProgress({ cleanupPending: true, code, livemode: false })
      await sleep(5000)
    }
  }
}

/** Create an isolated payout-ready TEST recipient; this never changes a coach profile. */
export async function createSyntheticConnectFixture({ stripe: provider, testRun = randomUUID(),
  maxWaitMs = 360_000, onProgress = () => {} }) {
  assertRun(testRun)
  await assertTestProvider(provider)
  const email = `delivered+ardore-settlement-${testRun.slice(0, 12)}@resend.dev`
  let accountId = null
  try {
    const account = await provider.v2.core.accounts.create({
      dashboard: 'none',
      contact_email: email,
      display_name: 'Synthetic Ardore settlement verification',
      identity: {
        country: 'DE', entity_type: 'individual',
        individual: {
          given_name: 'Synthetic', surname: 'Settlement', email, phone: '0000000000',
          date_of_birth: { day: 1, month: 1, year: 1902 },
          address: { line1: 'address_full_match', city: 'Berlin', postal_code: '10115', country: 'DE' },
          documents: { primary_verification: { type: 'front_back', front_back: { front: 'file_identity_document_success' } } },
        },
        attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '127.0.0.1' } } },
      },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } }, mcc: '7299' },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        currency: 'eur',
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        profile: { business_url: 'https://accessible.stripe.com', product_description: 'Synthetic settlement test coaching' },
      },
      include: ['configuration.merchant', 'configuration.recipient'],
      metadata: { ardore_synthetic: SYNTHETIC_TYPE, test_run: testRun },
    }, { idempotencyKey: `ardore-synthetic-settlement-connect-${testRun}-v1` })
    accountId = account.id
    assertOwned(account, testRun)
    await provider.accounts.createExternalAccount(account.id, { external_account: {
      object: 'bank_account', country: 'DE', currency: 'eur', account_holder_name: 'Synthetic Settlement',
      account_holder_type: 'individual', account_number: TEST_IBAN,
    } }, { idempotencyKey: `ardore-synthetic-settlement-bank-${testRun}-v1` })
    const started = Date.now()
    while (true) {
      const status = await readSyntheticConnectFixture({ stripe: provider, accountId, testRun })
      onProgress(status)
      if (status.transfersStatus === 'active' && status.payoutsStatus === 'active'
        && status.chargesEnabled && status.payoutsEnabled) {
        return { accountId, testRun, status }
      }
      if (Date.now() - started >= maxWaitMs) {
        throw new Error(`Synthetic Connect readiness pending: transfers=${status.transfersStatus}, payouts=${status.payoutsStatus}, charges=${status.chargesEnabled}, payouts_enabled=${status.payoutsEnabled}`)
      }
      await sleep(10_000)
    }
  } catch (error) {
    if (accountId) {
      try { await cleanupSyntheticConnectFixture({ stripe: provider, accountId, testRun, onProgress }) }
      catch (cleanupError) {
        // Account identifiers/run identifiers are needed to safely retry cleanup;
        // API keys, identity and raw provider errors are never attached.
        throw Object.assign(new Error('Synthetic Connect probe failed and cleanup requires retry'), {
          accountId, testRun, code: safeCode(error), cleanupCode: safeCode(cleanupError),
        })
      }
    }
    if (error instanceof Error && error.message.startsWith('Synthetic Connect readiness pending:')) throw error
    throw Object.assign(new Error('Synthetic Connect fixture creation failed'), { code: safeCode(error) })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  assert.ok(process.argv.includes('--run-probe'), 'Pass --run-probe to opt into an isolated Stripe TEST fixture')
  process.loadEnvFile('.env.local')
  assert.match(process.env.STRIPE_SECRET_KEY ?? '', /^sk_test_/)
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 })
  let fixture
  try {
    fixture = await createSyntheticConnectFixture({ stripe,
      onProgress: status => console.log(JSON.stringify({ phase: 'readiness', ...status })),
    })
    console.log(JSON.stringify({ ready: true, status: fixture.status, livemode: false }))
  } catch (error) {
    console.log(JSON.stringify({ ready: false, reason: error.message, code: safeCode(error),
      ...(error.accountId ? { cleanupAccountId: error.accountId, cleanupRun: error.testRun } : {}), livemode: false }))
    process.exitCode = 1
  } finally {
    if (fixture) {
      const cleaned = await cleanupSyntheticConnectFixture({ stripe, ...fixture })
      console.log(JSON.stringify(cleaned))
    }
  }
}
