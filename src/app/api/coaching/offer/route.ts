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

  const { is_enabled, price_cents, duration_minutes, description } = await req.json()

  const { data, error } = await supabase
    .from('coaching_offers')
    .upsert({
      creator_id: creator.id,
      is_enabled: !!is_enabled,
      price_cents: Math.max(0, Number(price_cents) || 8000),
      duration_minutes: Number(duration_minutes) || 60,
      description: description?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'creator_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ offer: data })
}
