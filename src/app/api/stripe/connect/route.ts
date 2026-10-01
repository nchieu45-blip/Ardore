import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

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

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'DE',
        email: user.email,
        metadata: { ardore_creator_id: creator.id },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      }, { idempotencyKey: `ardore-connect-${creator.id}` })

      // Account ownership is authority data. Only this authenticated, owner-scoped
      // server operation may persist the account created by Stripe.
      const service = await createServiceClient()
      const { data: linkedCreator, error: linkError } = await service
        .from('creator_profiles')
        .update({ stripe_account_id: account.id })
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
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL!
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/creator/settings/payout`,
      return_url: `${appUrl}/api/stripe/connect/callback`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ url: accountLink.url })
  } catch {
    return NextResponse.json({ error: 'Stripe-Verbindung konnte nicht hergestellt werden. Bitte versuche es erneut.' }, { status: 502 })
  }
}
