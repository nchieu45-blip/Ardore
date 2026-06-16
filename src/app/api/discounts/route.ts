import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    .from('discounts')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ discounts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const creatorId = await getCreatorId(supabase)
  if (!creatorId) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await req.json()
  const { code, type, value, applies_to, starts_at, ends_at, max_redemptions } = body

  if (!['percent', 'fixed'].includes(type)) {
    return NextResponse.json({ error: 'Ungültiger Rabatttyp' }, { status: 400 })
  }
  if (type === 'percent' && (value < 1 || value > 100)) {
    return NextResponse.json({ error: 'Prozent muss zwischen 1 und 100 liegen' }, { status: 400 })
  }
  if (type === 'fixed' && value < 1) {
    return NextResponse.json({ error: 'Betrag muss mindestens 1 Cent sein' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('discounts')
    .insert({
      creator_id:      creatorId,
      code:            code ? code.toUpperCase().trim() : null,
      type,
      value:           Number(value),
      applies_to:      applies_to ?? 'all',
      starts_at:       starts_at   ?? null,
      ends_at:         ends_at     ?? null,
      max_redemptions: max_redemptions ? Number(max_redemptions) : null,
      active:          true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ discount: data })
}
