import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { canAccessSessionMeeting, normalizeMeetingUrl } from '@/lib/session-meeting'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: privateHeaders })
type Context = { params: Promise<{ id: string }> }
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function PATCH(req: NextRequest, context: Context) {
  const { id } = await context.params
  if (!validId(id)) return reply('Buchung nicht gefunden', 404)
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply('Nicht angemeldet', 401)
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply('Ungültige Anfrage', 400)
  let body: { meetingUrl?: unknown }
  try { body = await req.json() } catch { return reply('Ungültige Anfrage', 400) }
  const url = normalizeMeetingUrl(body?.meetingUrl)
  if (!url) return reply('Bitte gib einen gültigen öffentlichen HTTPS-Meeting-Link ohne Zugangsdaten ein.', 400)
  const service = await createServiceClient()
  // The database locks the booking and rechecks ownership, payment and status
  // atomically with the write, including concurrent cancellation.
  const { data, error } = await service.rpc('set_booking_meeting_link', {
    p_booking_id: id, p_coach_user_id: user.id, p_meeting_url: url,
  })
  if (error) return reply('Der Meeting-Link konnte nicht gespeichert werden. Bitte versuche es erneut.', 503)
  if (data === 'not_found') return reply('Buchung nicht gefunden', 404)
  if (data !== 'saved') return reply('Nur bestätigte, gültige und noch nicht beendete Termine können geändert werden.', 409)
  return NextResponse.json({ ok: true }, { headers: privateHeaders })
}

export async function GET(_req: NextRequest, context: Context) {
  const { id } = await context.params
  if (!validId(id)) return reply('Buchung nicht gefunden', 404)
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply('Nicht angemeldet', 401)
  const { data: booking, error } = await client.from('bookings')
    .select('buyer_id, status, payment_status, stripe_livemode, scheduled_at, duration_minutes, creator_profiles(user_id)')
    .eq('id', id).maybeSingle()
  if (error) return reply('Die Session konnte nicht geladen werden.', 503)
  const coach = Array.isArray(booking?.creator_profiles) ? booking.creator_profiles[0] : booking?.creator_profiles
  if (!booking || (booking.buyer_id !== user.id && coach?.user_id !== user.id)) return reply('Buchung nicht gefunden', 404)
  if (!canAccessSessionMeeting(booking, Date.now())) return reply('Dieser Session-Zugang ist nicht mehr verfügbar.', 410)
  const { data: meeting, error: meetingError } = await client.from('booking_meeting_links')
    .select('meeting_url').eq('booking_id', id).maybeSingle()
  if (meetingError) return reply('Der Meeting-Link konnte nicht geladen werden.', 503)
  const url = normalizeMeetingUrl(meeting?.meeting_url)
  if (!url) return reply('Dein Coach hat noch keinen Meeting-Link hinterlegt. Bitte öffne die Sessiondetails.', 409)
  return NextResponse.redirect(url, { status: 303, headers: privateHeaders })
}

export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params
  if (!validId(id)) return reply('Buchung nicht gefunden', 404)
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply('Nicht angemeldet', 401)
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply('Ungültige Anfrage', 400)
  const service = await createServiceClient()
  const { data, error } = await service.rpc('request_booking_meeting_link', { p_booking_id: id, p_buyer_id: user.id })
  if (error) return reply('Deine Anfrage konnte nicht gespeichert werden. Bitte versuche es erneut.', 503)
  if (data === 'not_found') return reply('Buchung nicht gefunden', 404)
  if (!['requested', 'already_ready'].includes(data)) return reply('Dieser Termin ist nicht mehr verfügbar.', 409)
  return NextResponse.json({ ok: true, ready: data === 'already_ready' }, { headers: privateHeaders })
}
