import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isValidCoachingDuration } from '@/lib/coaching-booking'

const nonNegativeInteger = z.number().int().min(0).max(2_147_483_647)

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!creator) return NextResponse.json({ error: 'Creator nicht gefunden' }, { status: 404 })

  const {
    is_enabled, price_cents, duration_minutes, description,
    buffer_minutes, min_notice_hours, max_horizon_days, cancellation_policy_hours,
  } = await req.json()
  const parsedDuration = Number(duration_minutes)
  if (!isValidCoachingDuration(parsedDuration)) {
    return NextResponse.json({ error: 'Ungültige Sitzungsdauer' }, { status: 400 })
  }
  const parsedPrice = nonNegativeInteger.default(8000).safeParse(price_cents)
  if (!parsedPrice.success) {
    return NextResponse.json({ error: 'Ungültiger Preis' }, { status: 400 })
  }
  const parsedNoticeHours = nonNegativeInteger.default(24).safeParse(min_notice_hours)
  if (!parsedNoticeHours.success) {
    return NextResponse.json({ error: 'Ungültige Mindestvorlaufzeit' }, { status: 400 })
  }
  const parsedCancellationHours = Number(cancellation_policy_hours)

  const { data, error } = await supabase
    .from('coaching_offers')
    .upsert({
      creator_id:                 creator.id,
      is_enabled:                 !!is_enabled,
      price_cents:                parsedPrice.data,
      duration_minutes:           parsedDuration,
      description:                description?.trim() || null,
      buffer_minutes:             [0, 15, 30].includes(Number(buffer_minutes)) ? Number(buffer_minutes) : 0,
      min_notice_hours:           parsedNoticeHours.data,
      max_horizon_days:           Math.max(1, Number(max_horizon_days) || 60),
      cancellation_policy_hours:  Number.isFinite(parsedCancellationHours)
        ? Math.min(168, Math.max(0, parsedCancellationHours))
        : 24,
      updated_at:                 new Date().toISOString(),
    }, { onConflict: 'creator_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ offer: data })
}
