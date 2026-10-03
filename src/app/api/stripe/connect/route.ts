import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { ConnectReadinessError, configuredStripeLivemode, inspectConnectAccount } from '@/lib/stripe/connect-readiness'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: creator, error } = await supabase.from('creator_profiles')
    .select('id, stripe_account_id').eq('user_id', user.id).single()
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Creator-Profil konnte nicht geladen werden' }, { status: 500 })
  }
  if (!creator) return NextResponse.json({ error: 'Creator-Profil nicht gefunden' }, { status: 404 })
  if (!creator.stripe_account_id) return NextResponse.json({ connected: false, payoutReady: false })
  try {
    const readiness = await inspectConnectAccount(creator.stripe_account_id, creator.id)
    return NextResponse.json({ connected: true, payoutReady: readiness.ready })
  } catch (error) {
    const status = error instanceof ConnectReadinessError ? error.status : 502
    return NextResponse.json({ error: 'Stripe-Status konnte nicht geladen werden. Bitte versuche es erneut.' }, { status })
  }
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { data: creator, error: creatorError } = await supabase
    .from('creator_profiles')
    .select('id, stripe_account_id')
    .eq('user_id', user.id)
    .single()

  if (creatorError && creatorError.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Creator-Profil konnte nicht geladen werden' }, { status: 500 })
  }

  if (!creator) {
    return NextResponse.json({ error: 'Creator-Profil nicht gefunden' }, { status: 404 })
  }

  try {
    let accountId = creator.stripe_account_id
    let configurations: Array<'merchant' | 'recipient'>

    if (!accountId) {
      const account = await stripe.v2.core.accounts.create({
        dashboard: 'express',
        identity: { country: 'DE' },
        contact_email: user.email,
        metadata: { ardore_creator_id: creator.id },
        // Preserve the existing Express platform responsibility model.
        defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
        },
      }, { idempotencyKey: `ardore-connect-v2-${creator.id}` })
      if (!/^acct_[A-Za-z0-9]+$/.test(account.id)
        || account.metadata?.ardore_creator_id !== creator.id || account.closed) {
        throw new ConnectReadinessError('connect_account_mismatch')
      }
      if (account.livemode !== configuredStripeLivemode()) throw new ConnectReadinessError('connect_mode_mismatch')

      // Account ownership is authority data. Only this authenticated, owner-scoped
      // server operation may persist the account created by Stripe.
      const service = await createServiceClient()
      const { data: linkedCreator, error: linkError } = await service
        .from('creator_profiles')
        .update({ stripe_account_id: account.id, stripe_account_active: false })
        .eq('id', creator.id)
        .eq('user_id', user.id)
        .is('stripe_account_id', null)
        .select('id')
        .maybeSingle()

      if (linkError) {
        return NextResponse.json({ error: 'Stripe-Konto konnte nicht gespeichert werden. Bitte versuche es erneut.' }, { status: 500 })
      }
      if (!linkedCreator) {
        return NextResponse.json({ error: 'Stripe-Verknüpfung wurde bereits geändert. Bitte versuche es erneut.' }, { status: 409 })
      }
      accountId = account.id
      configurations = ['merchant', 'recipient']
    } else {
      // Onboarding may remediate an inactive account, but must never open a
      // client-supplied or another coach's connected account.
      const readiness = await inspectConnectAccount(accountId, creator.id)
      configurations = readiness.v2Account.applied_configurations
        .filter((configuration): configuration is 'merchant' | 'recipient' => configuration === 'merchant' || configuration === 'recipient')
      if (configurations.length === 0 || readiness.v2Account.closed) throw new ConnectReadinessError('connect_account_mismatch')
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com').replace(/\/$/, '')
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations,
          refresh_url: `${appUrl}/creator/settings/payout`,
          return_url: `${appUrl}/api/stripe/connect/callback`,
        },
      },
    })
    if (accountLink.account !== accountId || accountLink.livemode !== configuredStripeLivemode()) {
      throw new ConnectReadinessError('connect_account_mismatch')
    }

    return NextResponse.json({ url: accountLink.url })
  } catch (error) {
    return NextResponse.json({ error: 'Stripe-Verbindung konnte nicht hergestellt werden. Bitte versuche es erneut.' }, {
      status: error instanceof ConnectReadinessError ? error.status : 502,
    })
  }
}
