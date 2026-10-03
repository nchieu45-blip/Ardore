import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { startOrResumeCoachingCheckout } from '@/lib/coaching-checkout'

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null)
  if (!payload || typeof payload.bookingId !== 'string' || !payload.bookingId) {
    return NextResponse.json({ error: 'Buchung fehlt.' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const service = await createServiceClient()
  const result = await startOrResumeCoachingCheckout({ service, bookingId: payload.bookingId, buyerId: user.id })
  const { status, ...body } = result
  return NextResponse.json(body, { status })
}
