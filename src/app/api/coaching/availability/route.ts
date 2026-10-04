import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { availabilityInput, availabilityValidationError, availabilitySaveError } from '@/lib/coaching-availability'

async function owner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }) }
  const { data: creator, error } = await supabase.from('creator_profiles').select('id').eq('user_id', user.id).single()
  if (error && error.code !== 'PGRST116') return { response: NextResponse.json({ error: 'Einstellungen konnten nicht geladen werden.' }, { status: 503 }) }
  if (!creator) return { response: NextResponse.json({ error: 'Coach nicht gefunden' }, { status: 404 }) }
  return { creator, user }
}

export async function GET() {
  const auth = await owner()
  if (auth.response) return auth.response
  const service = await createServiceClient()
  const { data, error } = await service.rpc('get_coach_availability', { p_creator_id: auth.creator.id, p_coach_user_id: auth.user.id })
  if (error || !data) return NextResponse.json({ error: 'Einstellungen konnten nicht geladen werden. Bitte versuche es erneut.' }, { status: 503 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await owner()
  if (auth.response) return auth.response
  const parsed = availabilityInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Einstellungen. Bitte prüfe deine Eingaben und lade bei Bedarf die Seite neu.' }, { status: 400 })
  const invalid = availabilityValidationError(parsed.data)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
  const { slots, dateOverrides, expectedRevision, offer } = parsed.data
  const service = await createServiceClient()
  const { data, error } = await service.rpc('replace_coach_availability', {
    p_creator_id: auth.creator.id, p_coach_user_id: auth.user.id,
    p_slots: slots, p_date_overrides: dateOverrides, p_expected_revision: expectedRevision,
    p_offer: offer ? { ...offer, description: offer.description?.trim() || null } : null,
  })
  if (error || !data) {
    const failure = availabilitySaveError(error ?? {})
    return NextResponse.json(failure, { status: failure.status })
  }
  return NextResponse.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'private, no-store' } })
}
