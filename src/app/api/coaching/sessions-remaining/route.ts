import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const subscriptionId = searchParams.get('subscriptionId')
  if (!subscriptionId) return NextResponse.json({ error: 'Missing subscriptionId' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, buyer_id, tier_id, subscription_tiers(included_video_sessions, video_session_period)')
    .eq('id', subscriptionId)
    .single()

  if (!sub || sub.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  }

  const tier = Array.isArray(sub.subscription_tiers) ? sub.subscription_tiers[0] : sub.subscription_tiers
  const total: number  = (tier as { included_video_sessions: number } | null)?.included_video_sessions ?? 0
  const period: string = (tier as { video_session_period: string | null } | null)?.video_session_period ?? 'month'

  if (total === 0) return NextResponse.json({ remaining: 0, total: 0, used: 0 })

  // Calculate period start
  const now = new Date()
  let periodStart: Date
  if (period === 'week') {
    const dayOfWeek = now.getDay()
    const daysToMon = (dayOfWeek + 6) % 7
    periodStart = new Date(now)
    periodStart.setDate(now.getDate() - daysToMon)
    periodStart.setHours(0, 0, 0, 0)
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  }

  const { count } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('subscription_id', subscriptionId)
    .neq('status', 'cancelled')
    .gte('created_at', periodStart.toISOString())

  const used      = count ?? 0
  const remaining = Math.max(0, total - used)

  return NextResponse.json({ remaining, total, used, period })
}
