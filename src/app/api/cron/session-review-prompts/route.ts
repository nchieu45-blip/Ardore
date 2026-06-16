import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification, checkNotificationPreference } from '@/lib/notifications'
import { sendSessionReviewPrompt } from '@/lib/email/send'

// Runs once daily at 08:00 UTC (Vercel Hobby plan limit).
// Finds sessions that ended in the past 24 h and sends a one-time review prompt
// (in-app notification + email) if the buyer hasn't reviewed yet.
// TODO: tighten to */15 * * * * on Vercel Pro for near-real-time prompts.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date()

  // Window: sessions whose end time falls in [now-24h, now].
  // Because end = scheduled_at + duration_minutes, we over-fetch with a 120-min
  // buffer on the lower bound and filter precisely in JS.
  const fetchFrom = new Date(now.getTime() - (24 * 60 + 120) * 60_000).toISOString()
  const fetchTo   = now.toISOString()

  const windowStart = new Date(now.getTime() - 24 * 60 * 60_000)
  const windowEnd   = now

  const { data: bookings } = await service
    .from('bookings')
    .select('id, buyer_id, buyer_name, scheduled_at, duration_minutes, creator_profiles!inner(user_id, display_name)')
    .neq('status', 'cancelled')
    .gte('scheduled_at', fetchFrom)
    .lte('scheduled_at', fetchTo)

  if (!bookings?.length) return NextResponse.json({ sent: 0 })

  let sent = 0

  for (const b of bookings) {
    const scheduledAt = new Date(b.scheduled_at)
    const endAt = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)

    if (endAt < windowStart || endAt > windowEnd) continue

    const dedupeLink = `/buyer/sessions?review=${b.id}`

    // De-dupe: skip if we already sent this prompt
    const { count: notifCount } = await service
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'session_review_prompt')
      .eq('user_id', b.buyer_id)
      .eq('link', dedupeLink)

    if ((notifCount ?? 0) > 0) continue

    // Skip if already reviewed
    const { count: reviewCount } = await service
      .from('session_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', b.id)

    if ((reviewCount ?? 0) > 0) continue

    const cp = Array.isArray(b.creator_profiles) ? b.creator_profiles[0] : b.creator_profiles
    const coachName = cp?.display_name ?? 'deinem Coach'

    ;(async () => {
      try {
        const { data: { user } } = await service.auth.admin.getUserById(b.buyer_id)
        const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL}${dedupeLink}`
        const buyerNameDisplay = b.buyer_name ?? user?.user_metadata?.full_name ?? 'dort'

        const [sendInapp, sendEmail] = await Promise.all([
          checkNotificationPreference(b.buyer_id, 'session_review_prompt', 'inapp'),
          checkNotificationPreference(b.buyer_id, 'session_review_prompt', 'email'),
        ])

        const notifJobs: Promise<unknown>[] = []
        if (sendInapp) {
          notifJobs.push(createNotification({
            userId: b.buyer_id,
            type: 'session_review_prompt',
            title: 'Wie war deine Session?',
            message: `Bewerte jetzt deine Session mit ${coachName}.`,
            link: dedupeLink,
          }))
        }
        if (sendEmail && user?.email) {
          notifJobs.push(sendSessionReviewPrompt(user.email, {
            buyerName: buyerNameDisplay,
            coachName,
            reviewUrl,
          }))
        }
        await Promise.allSettled(notifJobs)
      } catch (e) {
        console.error('[session-review-prompt]', e)
      }
    })()

    sent++
  }

  return NextResponse.json({ sent })
}
