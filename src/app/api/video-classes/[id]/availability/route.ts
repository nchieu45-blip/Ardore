import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validGroupId, validGroupInstant } from '@/lib/group-booking-validation'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const startsAt = request.nextUrl.searchParams.get('startsAt')
  const headers = { 'Cache-Control': 'no-store' }
  if (!validGroupId(id) || !validGroupInstant(startsAt)) return NextResponse.json({ error: 'Ungültiger Kurstermin' }, { status: 400, headers })
  try {
    const service = await createServiceClient()
    const { data, error } = await service.rpc('group_class_availability', { p_class_id: id, p_occurrence_start: startsAt })
    if (error || !data) throw new Error('Availability unavailable')
    if (data.error) return NextResponse.json({ error: 'Dieser Kurstermin ist nicht verfügbar.' }, { status: 404, headers })
    return NextResponse.json({ occurrenceStart: data.occurrenceStart, capacity: data.capacity,
      remaining: data.remaining, isFull: data.isFull, videoReady: !!process.env.DAILY_API_KEY?.trim() }, { headers })
  } catch {
    return NextResponse.json({ error: 'Freie Plätze konnten momentan nicht geprüft werden.' }, { status: 503, headers })
  }
}
