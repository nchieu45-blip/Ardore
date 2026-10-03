import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function fixture(options = {}) {
  const reads = []
  const account = {
    id: 'acct_synthetic', metadata: { ardore_creator_id: 'synthetic-creator' },
    charges_enabled: true, payouts_enabled: true, details_submitted: true,
    capabilities: { card_payments: 'active', transfers: 'active' },
    requirements: { disabled_reason: null, past_due: [], currently_due: [] },
    ...options.account,
  }
  const v2Account = {
    id: 'acct_synthetic', metadata: { ardore_creator_id: 'synthetic-creator' },
    livemode: false, closed: false, applied_configurations: ['merchant', 'recipient'],
    ...options.v2Account,
  }
  const provider = {
    accounts: { retrieve: async id => {
      reads.push(['stripe-v1', id])
      if (options.providerError) throw new Error('Secret provider detail')
      return account
    } },
    v2: { core: { accounts: { retrieve: async id => {
      reads.push(['stripe-v2', id])
      if (options.v2ProviderError) throw new Error('Secret provider detail')
      return v2Account
    } } } },
  }
  let databaseRead = 0
  const service = {
    from(table) {
      assert.equal(table, 'creator_profiles')
      return {
        select(columns) {
          assert.equal(columns, 'id,stripe_account_id', 'Cached flags must not authorize settlement')
          return {
            eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'synthetic-creator'); return this },
            async maybeSingle() {
              reads.push(['database', ++databaseRead])
              if (options.databaseThrows || (databaseRead === 2 && options.recheckThrows)) throw new Error('Secret database transport detail')
              if (options.databaseError || (databaseRead === 2 && options.recheckError)) {
                return { data: null, error: { message: 'Secret database detail' } }
              }
              if (options.creatorMissing) return { data: null, error: null }
              const stripeAccountId = options.accountMissing ? null : databaseRead === 2 && options.reassigned ? 'acct_other' : 'acct_synthetic'
              return { data: { id: 'synthetic-creator', stripe_account_id: stripeAccountId, stripe_account_active: true }, error: null }
            },
          }
        },
        update() { assert.fail('Readiness checks may not write to the database') },
      }
    },
  }
  const source = readFileSync(new URL('../src/lib/stripe/connect-readiness.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
  const loaded = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => { assert.equal(name, '@/lib/stripe/server'); return { stripe: provider } },
    loaded.exports, loaded,
    { env: { STRIPE_SECRET_KEY: options.credential ?? 'sk_test_synthetic' } },
  )
  return { ...loaded.exports, account, v2Account, service, provider, reads }
}

test('Fresh authoritative payout-ready account passes and rechecks protected association', async () => {
  const f = fixture()
  const result = await f.requirePayoutReadyCoach(f.service, 'synthetic-creator')
  assert.equal(result.ready, true)
  assert.equal(result.accountId, 'acct_synthetic')
  assert.equal(result.creatorId, 'synthetic-creator')
  assert.equal(result.livemode, false)
  assert.deepEqual(f.reads, [['database', 1], ['stripe-v1', 'acct_synthetic'], ['stripe-v2', 'acct_synthetic'], ['database', 2]])
})

for (const [name, account] of [
  ['charges disabled', { charges_enabled: false }],
  ['payouts disabled despite active transfers', { payouts_enabled: false }],
  ['details not submitted', { details_submitted: false }],
  ['card payments inactive', { capabilities: { card_payments: 'inactive', transfers: 'active' } }],
  ['transfers inactive', { capabilities: { card_payments: 'active', transfers: 'inactive' } }],
  ['transfers pending', { capabilities: { card_payments: 'active', transfers: 'pending' } }],
  ['capabilities unavailable', { capabilities: undefined }],
  ['requirements restricted', { requirements: { disabled_reason: 'rejected.fraud', past_due: [] } }],
  ['requirements past due', { requirements: { disabled_reason: null, past_due: ['identity'] } }],
  ['requirements unavailable', { requirements: undefined }],
  ['past-due list unavailable', { requirements: { disabled_reason: null } }],
]) {
  test(`Fail closed for ${name} even if cached database flag remains true`, async () => {
    const f = fixture({ account })
    assert.equal(f.isPayoutReadyAccount(f.account, 'synthetic-creator'), false)
    const status = await f.inspectConnectAccount('acct_synthetic', 'synthetic-creator')
    assert.equal(status.ready, false)
    await assert.rejects(f.requirePayoutReadyCoach(f.service, 'synthetic-creator'), { code: 'connect_account_not_ready', status: 409 })
  })
}

test('Future requirements do not disable an otherwise payout-enabled account', async () => {
  const f = fixture({ account: { requirements: { disabled_reason: null, past_due: [], currently_due: ['future_information'] } } })
  assert.equal((await f.requirePayoutReadyCoach(f.service, 'synthetic-creator')).ready, true)
})

for (const [name, options, code, status] of [
  ['missing coach', { creatorMissing: true }, 'creator_unavailable', 409],
  ['missing account', { accountMissing: true }, 'connect_account_missing', 409],
  ['database failure', { databaseError: true }, 'creator_unavailable', 503],
  ['database transport failure', { databaseThrows: true }, 'creator_unavailable', 503],
  ['provider failure', { providerError: true }, 'connect_provider_unavailable', 503],
  ['v2 provider failure', { v2ProviderError: true }, 'connect_provider_unavailable', 503],
  ['v1 owner mismatch', { account: { metadata: { ardore_creator_id: 'other-creator' } } }, 'connect_account_mismatch', 409],
  ['v2 owner mismatch', { v2Account: { metadata: { ardore_creator_id: 'other-creator' } } }, 'connect_account_mismatch', 409],
  ['missing v1 ownership metadata', { account: { metadata: {} } }, 'connect_account_mismatch', 409],
  ['missing v2 ownership metadata', { v2Account: { metadata: {} } }, 'connect_account_mismatch', 409],
  ['v1 wrong account', { account: { id: 'acct_other' } }, 'connect_account_mismatch', 409],
  ['v2 wrong account', { v2Account: { id: 'acct_other' } }, 'connect_account_mismatch', 409],
  ['wrong Stripe mode', { v2Account: { livemode: true } }, 'connect_mode_mismatch', 409],
  ['closed account', { v2Account: { closed: true } }, 'connect_account_not_ready', 409],
  ['account reassigned during provider read', { reassigned: true }, 'connect_account_mismatch', 409],
  ['association recheck failure', { recheckError: true }, 'creator_unavailable', 503],
  ['association transport failure', { recheckThrows: true }, 'creator_unavailable', 503],
  ['unconfigured provider mode', { credential: 'synthetic-invalid' }, 'connect_configuration_unavailable', 503],
]) {
  test(`${name} refuses paid checkout with a sanitized typed error`, async () => {
    const f = fixture(options)
    await assert.rejects(f.requirePayoutReadyCoach(f.service, 'synthetic-creator'), error => {
      assert.equal(error instanceof f.ConnectReadinessError, true)
      assert.equal(error.code, code)
      assert.equal(error.status, status)
      assert.doesNotMatch(error.message, /Secret|synthetic-invalid/)
      return true
    })
  })
}

test('Malformed account IDs are rejected before provider calls', async () => {
  const f = fixture()
  await assert.rejects(f.inspectConnectAccount('acct_bad/input', 'synthetic-creator'), { code: 'connect_account_mismatch' })
  assert.deepEqual(f.reads, [])
})

test('Restricted test keys use test mode; live keys require an authoritative live account', async () => {
  assert.equal(fixture({ credential: 'rk_test_synthetic' }).configuredStripeLivemode(), false)
  const f = fixture({ credential: 'sk_live_synthetic', v2Account: { livemode: true } })
  assert.equal((await f.requirePayoutReadyCoach(f.service, 'synthetic-creator')).livemode, true)
})
