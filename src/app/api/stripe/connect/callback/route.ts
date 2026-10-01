import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function GET() {
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

  if (creator.stripe_account_id) {
    try {
      const account = await stripe.accounts.retrieve(creator.stripe_account_id)
      const isActive = account.charges_enabled && account.payouts_enabled
      const service = await createServiceClient()
      // Status is derived from Stripe, never from callback/query/body input.
      const { data: updatedCreator, error: updateError } = await service
        .from('creator_profiles')
        .update({ stripe_account_active: isActive })
        .eq('id', creator.id)
        .eq('user_id', user.id)
        .eq('stripe_account_id', creator.stripe_account_id)
        .select('id')
        .maybeSingle()

      if (updateError) {
        return NextResponse.json({ error: 'Stripe-Status konnte nicht gespeichert werden. Bitte versuche es erneut.' }, { status: 500 })
      }
      if (!updatedCreator) {
        return NextResponse.json({ error: 'Stripe-Verknüpfung wurde geändert. Bitte versuche es erneut.' }, { status: 409 })
      }
    } catch {
      return NextResponse.json({ error: 'Stripe-Status konnte nicht geladen werden. Bitte versuche es erneut.' }, { status: 502 })
    }
  }

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/creator/settings`)
}
