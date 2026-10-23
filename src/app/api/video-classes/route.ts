import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { groupClassBodyKeysValid, groupClassMutationError, parseGroupClassInput } from '@/lib/group-class-input'
import { appOrigin } from '@/lib/app-url'

const headers = { 'Cache-Control': 'private, no-store' }

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

export async function GET() {
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { data, error } = await supabase
    .from('video_classes')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Die Kurse konnten nicht geladen werden.' }, { status: 503, headers })

  const classes = data ?? []
  const classIds = classes.map((c: { id: string }) => c.id)

  let participantCounts: Record<string, number> | null = {}
  if (classIds.length > 0) {
    const { data: bookings, error: bookingError } = await supabase
      .from('video_class_bookings')
      .select('video_class_id')
      .eq('status', 'confirmed')
      .in('video_class_id', classIds)
    if (bookingError) participantCounts = null
    else for (const b of (bookings ?? []) as { video_class_id: string }[]) {
      participantCounts[b.video_class_id] = (participantCounts[b.video_class_id] ?? 0) + 1
    }
  }

  return NextResponse.json({ classes, participantCounts, videoReady: Boolean(process.env.DAILY_API_KEY?.trim()) }, { headers })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin || ![new URL(req.url).origin, appOrigin()].includes(origin) || req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers })
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return NextResponse.json({ error: 'Ungültige Kursdaten' }, { status: 400, headers })
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Ungültige Kursdaten' }, { status: 400, headers }) }
  const course = groupClassBodyKeysValid(body) ? parseGroupClassInput(body) : null
  if (!course || course.schedule_type === 'once' && Date.parse(course.starts_at!) <= Date.now()) return NextResponse.json({ error: 'Bitte prüfe Titel, zukünftigen Termin, Dauer, Teilnehmerzahl und Preis. Bezahlte Termine sind ab 0,50 € möglich.' }, { status: 400, headers })

  const { data, error } = await supabase
    .from('video_classes')
    .insert({
      ...course, creator_id: creatorId, active: true,
    })
    .select()
    .single()

  if (error) { const failure = groupClassMutationError(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }) }
  return NextResponse.json({ videoClass: data }, { headers })
}
