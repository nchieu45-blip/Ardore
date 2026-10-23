import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { reserveGroupBooking, validGroupId, validGroupInstant } from '@/lib/group-booking-payments'
import { GROUP_PRIVATE_HEADERS, groupRequestError, groupResult } from '@/lib/group-booking-http'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const invalid = groupRequestError(request)
  if (invalid) return invalid
  const { id } = await params
  const body: unknown = await request.json().catch(() => null)
  if (!validGroupId(id) || !body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Ungültige Buchungsanfrage' }, { status: 400, headers: GROUP_PRIVATE_HEADERS })
  }
  const payload = body as Record<string, unknown>
  if (!validGroupId(payload.requestId) || !Number.isSafeInteger(payload.expectedPriceCents)
    || (payload.occurrenceStart !== undefined && !validGroupInstant(payload.occurrenceStart))
    || Object.keys(payload).some(key => !['requestId', 'expectedPriceCents', 'occurrenceStart'].includes(key))) {
    return NextResponse.json({ error: 'Bitte prüfe Termin und Preis des Angebots.' }, { status: 400, headers: GROUP_PRIVATE_HEADERS })
  }
  try {
    const client = await createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers: GROUP_PRIVATE_HEADERS })
    const service = await createServiceClient()
    return groupResult(await reserveGroupBooking({ service, classId: id, buyerId: user.id, requestId: payload.requestId,
      expectedPriceCents: payload.expectedPriceCents as number, occurrenceStart: payload.occurrenceStart as string | undefined }))
  } catch {
    return NextResponse.json({ error: 'Die Anmeldung konnte noch nicht sicher bestätigt werden. Bitte versuche dieselbe Buchung erneut.' }, { status: 503, headers: GROUP_PRIVATE_HEADERS })
  }
}
