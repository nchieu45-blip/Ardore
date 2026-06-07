import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'

export async function POST(req: NextRequest) {
  // Verify the caller is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  // Service-role client bypasses RLS — never expose to the browser
  const service = await createServiceClient()

  try {
    // ── 1. Collect data needed for notifications ────────────────────────────
    const [profileRes, creatorRes] = await Promise.all([
      service.from('profiles').select('full_name').eq('id', user.id).single(),
      service.from('creator_profiles').select('id, display_name').eq('user_id', user.id).maybeSingle(),
    ])

    const creator    = creatorRes.data
    const deletingAt = new Date().toISOString()

    if (creator) {
      // Upcoming bookings for creator → notify buyers
      const { data: upcomingBookings } = await service
        .from('bookings')
        .select('buyer_email, buyer_name, scheduled_at')
        .eq('creator_id', creator.id)
        .eq('status', 'confirmed')
        .gt('scheduled_at', deletingAt)

      // Active subscribers → cancel Stripe + notify
      const { data: activeSubs } = await service
        .from('subscriptions')
        .select('id, stripe_subscription_id, buyer_id')
        .eq('creator_id', creator.id)
        .eq('status', 'active')

      // Send notifications (best-effort, never block deletion)
      try {
        const { sendBookingCancelledNotice, sendSubscriptionCancelledNotice } = await import('@/lib/email/send')

        if (upcomingBookings?.length) {
          await Promise.allSettled(
            upcomingBookings.map(b =>
              sendBookingCancelledNotice(b.buyer_email, {
                recipientName: b.buyer_name,
                coachName:     creator.display_name,
                scheduledAt:   b.scheduled_at,
              })
            )
          )
        }

        if (activeSubs?.length) {
          // Fetch buyer emails for subscription notice
          const buyerIds = activeSubs.map(s => s.buyer_id).filter(Boolean)
          if (buyerIds.length) {
            const { data: buyerProfiles } = await service
              .from('profiles')
              .select('id, full_name')
              .in('id', buyerIds)

            const { data: buyerAuthUsers } = await service.auth.admin.listUsers()
            const emailMap = new Map(
              (buyerAuthUsers?.users ?? []).map(u => [u.id, u.email ?? ''])
            )
            const nameMap = new Map(
              (buyerProfiles ?? []).map(p => [p.id, p.full_name ?? 'Abonnent'])
            )

            await Promise.allSettled(
              activeSubs.map(s => {
                const email = emailMap.get(s.buyer_id)
                if (!email) return Promise.resolve()
                return sendSubscriptionCancelledNotice(email, {
                  recipientName: nameMap.get(s.buyer_id) ?? 'Abonnent',
                  coachName:     creator.display_name,
                })
              })
            )
          }
        }
      } catch { /* email errors never fail deletion */ }

      // Cancel Stripe subscriptions for creator's subscribers
      await Promise.allSettled(
        (activeSubs ?? []).map(async s => {
          if (s.stripe_subscription_id && !s.stripe_subscription_id.startsWith('free_')) {
            try { await stripe.subscriptions.cancel(s.stripe_subscription_id) } catch {}
          }
        })
      )
    }

    // Cancel buyer's own active Stripe subscriptions
    const { data: buyerSubs } = await service
      .from('subscriptions')
      .select('id, stripe_subscription_id')
      .eq('buyer_id', user.id)
      .eq('status', 'active')

    await Promise.allSettled(
      (buyerSubs ?? []).map(async s => {
        if (s.stripe_subscription_id && !s.stripe_subscription_id.startsWith('free_')) {
          try { await stripe.subscriptions.cancel(s.stripe_subscription_id) } catch {}
        }
      })
    )

    // ── 2. Delete database records in dependency order ──────────────────────
    // Messages
    if (creator) {
      await service.from('messages').delete().eq('creator_id', creator.id)
    }
    await service.from('messages').delete().eq('sender_id', user.id)

    // Bookings
    if (creator) {
      await service.from('bookings').delete().eq('creator_id', creator.id)
    }
    await service.from('bookings').delete().eq('buyer_id', user.id)

    // Coaching availability
    if (creator) {
      await service.from('date_overrides').delete().eq('creator_id', creator.id)
      await service.from('availability_slots').delete().eq('creator_id', creator.id)
      await service.from('coaching_offers').delete().eq('creator_id', creator.id)
    }

    // Reviews
    await service.from('reviews').delete().eq('buyer_id', user.id)
    if (creator) {
      await service.from('reviews').delete().eq('creator_id', creator.id)
    }

    // Purchases
    await service.from('purchases').delete().eq('buyer_id', user.id)

    // Subscriptions (update status first for audit trail, then delete)
    await service.from('subscriptions').delete().eq('buyer_id', user.id)
    if (creator) {
      await service.from('subscriptions').delete().eq('creator_id', creator.id)
      await service.from('subscription_tiers').delete().eq('creator_id', creator.id)
      await service.from('products').delete().eq('creator_id', creator.id)
      await service.from('creator_profiles').delete().eq('id', creator.id)
    }

    // User profile
    await service.from('profiles').delete().eq('id', user.id)

    // ── 3. Delete the auth user (must be last) ──────────────────────────────
    const { error: deleteError } = await service.auth.admin.deleteUser(user.id)
    if (deleteError) throw new Error(deleteError.message)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[account/delete]', e)
    return NextResponse.json(
      { error: 'Konto konnte nicht gelöscht werden. Bitte versuche es erneut oder kontaktiere den Support.' },
      { status: 500 }
    )
  }
}
