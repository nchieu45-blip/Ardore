import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { configuredStripeLivemode } from '@/lib/stripe/connect-readiness'
import { recoverCoachSettlements } from '@/lib/stripe/settlement'

async function ownedCreator() {
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return { response: NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }) }
    const { data: creator, error } = await client.from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
    if (error) return { response: NextResponse.json({ error: 'Profil konnte nicht geladen werden.' }, { status: 503 }) }
    if (!creator) return { response: NextResponse.json({ error: 'Coach-Profil nicht gefunden.' }, { status: 404 }) }
    return { creatorId: creator.id as string }
  } catch {
    return { response: NextResponse.json({ error: 'Anmeldung konnte nicht geprüft werden. Bitte versuche es erneut.' }, { status: 503 }) }
  }
}

export async function GET() {
  const owner = await ownedCreator()
  if (owner.response) return owner.response
  try {
    const service = await createServiceClient()
    const { data, error } = await service.from('payment_settlements')
      .select('id,kind,state,gross_cents,platform_fee_cents,coach_net_cents,transfer_amount_cents,amount_reversed_cents,stripe_transfer_id,amount_refunded_cents,created_at')
      .eq('creator_id', owner.creatorId).eq('stripe_livemode', configuredStripeLivemode())
      .order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error('Settlement read failed')
    return NextResponse.json({ settlements: (data ?? []).map(row => ({ id: row.id, kind: row.kind, state: row.state,
      grossCents: row.gross_cents, feeCents: row.platform_fee_cents, coachNetCents: row.coach_net_cents,
      transferredCents: row.stripe_transfer_id ? row.transfer_amount_cents - row.amount_reversed_cents : 0,
      refundedCents: row.amount_refunded_cents, createdAt: row.created_at })) })
  } catch {
    return NextResponse.json({ error: 'Abrechnungen konnten nicht geladen werden. Bitte versuche es erneut.' }, { status: 503 })
  }
}

export async function POST() {
  const owner = await ownedCreator()
  if (owner.response) return owner.response
  try {
    const service = await createServiceClient()
    // No client-supplied coach, amount, account or status is accepted.
    return NextResponse.json(await recoverCoachSettlements({ service, creatorId: owner.creatorId }))
  } catch {
    return NextResponse.json({ error: 'Offene Abrechnungen konnten nicht geprüft werden. Bitte versuche es erneut.' }, { status: 503 })
  }
}
