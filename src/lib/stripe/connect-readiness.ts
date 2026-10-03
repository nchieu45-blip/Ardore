import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

export type ConnectReadinessCode =
  | 'creator_unavailable'
  | 'connect_account_missing'
  | 'connect_account_not_ready'
  | 'connect_account_mismatch'
  | 'connect_mode_mismatch'
  | 'connect_configuration_unavailable'
  | 'connect_provider_unavailable'

export class ConnectReadinessError extends Error {
  constructor(public readonly code: ConnectReadinessCode, public readonly status = 409) {
    super(status === 503
      ? 'Der Auszahlungsstatus kann momentan nicht geprüft werden. Bitte versuche es erneut.'
      : 'Dieser Coach kann momentan keine bezahlten Buchungen oder Käufe annehmen.')
    this.name = 'ConnectReadinessError'
  }
}

export type ConnectAccountReadiness = {
  creatorId: string
  accountId: string
  livemode: boolean
  ready: boolean
  account: Stripe.Account
  v2Account: Stripe.V2.Core.Account
}

export type PayoutReadyCoach = ConnectAccountReadiness & { ready: true }

export function configuredStripeLivemode(): boolean {
  const credential = process.env.STRIPE_SECRET_KEY
  if (credential?.startsWith('sk_test_') || credential?.startsWith('rk_test_')) return false
  if (credential?.startsWith('sk_live_') || credential?.startsWith('rk_live_')) return true
  throw new ConnectReadinessError('connect_configuration_unavailable', 503)
}

// Cached database flags are presentation data, never authority for money movement.
// Future currently_due requirements do not disable an otherwise enabled account;
// past_due requirements and any provider restriction do.
export function isPayoutReadyAccount(account: Stripe.Account, creatorId: string): boolean {
  return account.metadata?.ardore_creator_id === creatorId
    && account.charges_enabled === true
    && account.payouts_enabled === true
    && account.details_submitted === true
    && account.capabilities?.card_payments === 'active'
    && account.capabilities?.transfers === 'active'
    && !!account.requirements
    && !account.requirements.disabled_reason
    && Array.isArray(account.requirements.past_due)
    && account.requirements.past_due.length === 0
}

export async function inspectConnectAccount(
  accountId: string,
  creatorId: string,
  provider: Stripe = stripe,
): Promise<ConnectAccountReadiness> {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new ConnectReadinessError('connect_account_mismatch')
  }
  const expectedMode = configuredStripeLivemode()
  let account: Stripe.Account
  let v2Account: Stripe.V2.Core.Account
  try {
    // Accounts v2 supplies the mode; the interoperable v1 view supplies the
    // current charges/payouts flags used by Ardore's destination-charge model.
    ;[account, v2Account] = await Promise.all([
      provider.accounts.retrieve(accountId),
      provider.v2.core.accounts.retrieve(accountId),
    ])
  } catch {
    throw new ConnectReadinessError('connect_provider_unavailable', 503)
  }
  if (account.id !== accountId || v2Account.id !== accountId
    || account.metadata?.ardore_creator_id !== creatorId
    || v2Account.metadata?.ardore_creator_id !== creatorId) {
    throw new ConnectReadinessError('connect_account_mismatch')
  }
  if (v2Account.livemode !== expectedMode) {
    throw new ConnectReadinessError('connect_mode_mismatch')
  }
  return {
    creatorId, accountId, livemode: v2Account.livemode, account, v2Account,
    ready: !v2Account.closed && isPayoutReadyAccount(account, creatorId),
  }
}

export async function requirePayoutReadyCoach(
  service: SupabaseClient,
  creatorId: string,
  provider: Stripe = stripe,
): Promise<PayoutReadyCoach> {
  const readAccount = async () => {
    try {
      const { data, error } = await service.from('creator_profiles')
        .select('id,stripe_account_id').eq('id', creatorId).maybeSingle()
      if (error) throw new ConnectReadinessError('creator_unavailable', 503)
      return data
    } catch {
      throw new ConnectReadinessError('creator_unavailable', 503)
    }
  }
  const creator = await readAccount()
  if (!creator || creator.id !== creatorId) throw new ConnectReadinessError('creator_unavailable')
  if (!creator.stripe_account_id) throw new ConnectReadinessError('connect_account_missing')
  const readiness = await inspectConnectAccount(creator.stripe_account_id, creatorId, provider)
  if (!readiness.ready) throw new ConnectReadinessError('connect_account_not_ready')
  // Catch a server-side reassignment during the provider request. Settlement
  // callers still snapshot this account and independently verify paid charges.
  const current = await readAccount()
  if (current?.stripe_account_id !== readiness.accountId) {
    throw new ConnectReadinessError('connect_account_mismatch')
  }
  return { ...readiness, ready: true }
}
