import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: creator } = await supabase
      .from('creator_profiles')
      .select('stripe_account_id')
      .eq('user_id', user.id)
      .single()

    if (creator?.stripe_account_id) {
      const account = await stripe.accounts.retrieve(creator.stripe_account_id)
      const isActive = account.charges_enabled && account.payouts_enabled

      await supabase
        .from('creator_profiles')
        .update({ stripe_account_active: isActive })
        .eq('user_id', user.id)
    }
  }

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/creator/settings`)
}
