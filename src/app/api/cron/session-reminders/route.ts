import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

// Runs once daily at 08:00 UTC (Vercel Hobby plan limit).
// Finds sessions starting in the next 23–25 h and sends a one-time reminder
// notification to both the coach and the buyer.
// TODO: tighten to */15 * * * * on Vercel Pro for near-real-time reminders.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = await createServiceClient()

  const now          = new Date()
  const windowStart  = new Date(now.getTime() + 23 * 60 * 60_000).toISOString()
  const windowEnd    = new Date(now.getTime() + 25 * 60 * 60_000).toISOString()

  const { data: bookings } = await service
    .from('bookings')
    .select('id, buyer_id, buyer_name, scheduled_at, creator_profiles!inner(user_id, display_name)')
    .eq('status', 'confirmed')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)

  if (!bookings?.length) return NextResponse.json({ sent: 0 })

  let sent = 0

  for (const b of bookings) {
    // De-duplicate: skip if we already sent a reminder for this session
    const { count } = await service
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'session_reminder')
      .eq('link', `/session/${b.id}`)

    if ((count ?? 0) > 0) continue

    const cp = Array.isArray(b.creator_profiles) ? b.creator_profiles[0] : b.creator_profiles
    const sessionTime = new Date(b.scheduled_at).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    })

    const jobs: Promise<void>[] = []

    if (cp?.user_id) {
      jobs.push(createNotification({
        userId: cp.user_id,
        type: 'session_reminder',
        title: 'Session beginnt morgen',
        message: `Deine Session mit ${b.buyer_name} findet morgen um ${sessionTime} Uhr statt.`,
        link: `/session/${b.id}`,
      }))
    }

    if (b.buyer_id) {
      jobs.push(createNotification({
        userId: b.buyer_id,
        type: 'session_reminder',
        title: 'Session beginnt morgen',
        message: `Deine Session mit ${cp?.display_name ?? 'deinem Coach'} findet morgen um ${sessionTime} Uhr statt.`,
        link: `/session/${b.id}`,
      }))
    }

    await Promise.allSettled(jobs)
    sent++
  }

  return NextResponse.json({ sent })
}
