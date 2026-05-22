import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id, stripe_account_id')
    .eq('user_id', user.id)
    .single()

  if (!creator) {
    return NextResponse.json({ error: 'Creator-Profil nicht gefunden' }, { status: 404 })
  }

  let accountId = creator.stripe_account_id

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'DE',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })
    accountId = account.id

    await supabase
      .from('creator_profiles')
      .update({ stripe_account_id: accountId })
      .eq('id', creator.id)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/creator/settings/payout`,
    return_url: `${appUrl}/api/stripe/connect/callback`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url })
}
