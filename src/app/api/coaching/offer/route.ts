import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const { data, error } = await supabase
    .from('coaching_offers')
    .upsert({
      creator_id:                 creator.id,
      is_enabled:                 !!is_enabled,
      price_cents:                Math.max(0, Number(price_cents) || 8000),
      duration_minutes:           Number(duration_minutes) || 60,
      description:                description?.trim() || null,
      buffer_minutes:             [0, 15, 30].includes(Number(buffer_minutes)) ? Number(buffer_minutes) : 0,
      min_notice_hours:           Math.max(0, Number(min_notice_hours) || 24),
      max_horizon_days:           Math.max(1, Number(max_horizon_days) || 60),
      cancellation_policy_hours:  Math.max(0, Number(cancellation_policy_hours) || 24),
      updated_at:                 new Date().toISOString(),
    }, { onConflict: 'creator_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ offer: data })
}
