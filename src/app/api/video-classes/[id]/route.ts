import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { groupClassBodyKeysValid, groupClassMutationError, parseGroupClassInput } from '@/lib/group-class-input'

const headers = { 'Cache-Control': 'private, no-store' }
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  return Boolean(origin && [new URL(request.url).origin, appOrigin()].includes(origin) && request.headers.get('sec-fetch-site') !== 'cross-site')
}

async function getCreatorId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  return creator?.id ?? null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers })
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return NextResponse.json({ error: 'Ungültige Kursdaten' }, { status: 400, headers })
  const { id } = await params
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Ungültige Kursdaten' }, { status: 400, headers }) }
  if (!groupClassBodyKeysValid(body)) return NextResponse.json({ error: 'Ungültige Kursdaten' }, { status: 400, headers })
  const current = await supabase.from('video_classes')
    .select('title,description,schedule_type,starts_at,recurring_weekday,recurring_time,duration_minutes,max_participants,price_cents,included_in_subscription,active')
    .eq('id', id).eq('creator_id', creatorId).maybeSingle()
  if (current.error) return NextResponse.json({ error: 'Der Kurs konnte nicht geladen werden.' }, { status: 503, headers })
  if (!current.data) return NextResponse.json({ error: 'Kurs nicht gefunden' }, { status: 404, headers })
  const course = parseGroupClassInput({ ...current.data, ...body })
  if (!course) return NextResponse.json({ error: 'Bitte prüfe Titel, Termin, Dauer, Teilnehmerzahl und Preis. Bezahlte Termine sind ab 0,50 € möglich.' }, { status: 400, headers })
  // Only submit changed fields. A concurrent price edit must not be overwritten
  // by an unrelated activation click that read an earlier row snapshot.
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(body) as (keyof typeof course)[]) patch[key] = course[key]
  if ('schedule_type' in body) {
    patch.starts_at = course.starts_at
    patch.recurring_weekday = course.recurring_weekday
    patch.recurring_time = course.recurring_time
  }

  const { data, error } = await supabase
    .from('video_classes')
    .update(patch)
    .eq('id', id)
    .eq('creator_id', creatorId)
    .select()
    .maybeSingle()

  if (error) { const failure = groupClassMutationError(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }) }
  if (!data) return NextResponse.json({ error: 'Kurs nicht gefunden' }, { status: 404, headers })
  return NextResponse.json({ videoClass: data }, { headers })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(_req)) return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers })
  const { id } = await params
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { data, error } = await supabase
    .from('video_classes')
    .delete()
    .eq('id', id)
    .eq('creator_id', creatorId)
    .select('id').maybeSingle()

  if (error) { const failure = groupClassMutationError(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }) }
  if (!data) return NextResponse.json({ error: 'Kurs nicht gefunden' }, { status: 404, headers })
  return NextResponse.json({ success: true }, { headers })
}
