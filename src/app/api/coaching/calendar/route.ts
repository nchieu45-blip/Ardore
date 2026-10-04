import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { addDaysToDateString, berlinDateTimeToIso, isValidDateString } from '@/lib/coaching-slots'
import { calendarDates } from '@/lib/coach-calendar'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers })

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams, date = params.get('date'), view = params.get('view')
  if (!date || !isValidDateString(date) || date < '1900-01-01' || date > '2100-12-31' || !['day', 'week'].includes(view ?? '')) return fail('Bitte wähle ein gültiges Datum und eine Ansicht.', 400)
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return fail('Bitte melde dich erneut an.', 401)
  // Never accept a coach identifier from the browser. RLS plus explicit ownership.
  const { data: coach, error: coachError } = await client.from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (coachError) return fail('Dein Kalender konnte nicht geladen werden.', 503)
  if (!coach) return fail('Kein Coach-Profil vorhanden.', 403)
  const dates = calendarDates(date, view as 'day' | 'week')
  const start = berlinDateTimeToIso(addDaysToDateString(dates[0], -1), '00:00')
  const end = berlinDateTimeToIso(addDaysToDateString(dates.at(-1)!, 1), '00:00')
  if (!start || !end) return fail('Das Datum liegt außerhalb des unterstützten Kalenderbereichs.', 400)
  const service = await createServiceClient()
  const [availability, bookings] = await Promise.all([
    service.rpc('get_coach_availability', { p_creator_id: coach.id, p_coach_user_id: user.id }),
    client.from('bookings').select('id, buyer_name, scheduled_at, duration_minutes, buffer_minutes, status, payment_status, price_cents, is_subscription_session')
      .eq('creator_id', coach.id).gte('scheduled_at', start).lt('scheduled_at', end).order('scheduled_at').limit(1001),
  ])
  if (availability.error || !availability.data || bookings.error || (bookings.data?.length ?? 0) > 1000) return fail('Der Kalender konnte nicht vollständig geladen werden. Bitte versuche es erneut.', 503)
  return NextResponse.json({ availability: availability.data, bookings: bookings.data ?? [], loadedAt: Date.now() }, { headers })
}
