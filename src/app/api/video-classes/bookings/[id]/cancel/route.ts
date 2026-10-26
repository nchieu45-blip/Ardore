import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { cancelGroupBooking, validGroupId } from '@/lib/group-booking-payments'
import { GROUP_PRIVATE_HEADERS, groupRequestError, groupResult } from '@/lib/group-booking-http'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const invalid = groupRequestError(request)
  if (invalid) return invalid
  const { id } = await params
  const body: unknown = await request.json().catch(() => null)
  if (!validGroupId(id) || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400, headers: GROUP_PRIVATE_HEADERS })
  }
  try {
    const client = await createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers: GROUP_PRIVATE_HEADERS })
    return groupResult(await cancelGroupBooking({ service: await createServiceClient(), bookingId: id, actorId: user.id }))
  } catch {
    return NextResponse.json({ error: 'Die Stornierung konnte momentan nicht bestätigt werden.' }, { status: 503, headers: GROUP_PRIVATE_HEADERS })
  }
}
