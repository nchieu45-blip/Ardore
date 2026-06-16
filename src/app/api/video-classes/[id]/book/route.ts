import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { createNotification, checkNotificationPreference } from '@/lib/notifications'

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: classId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  // Fetch class with creator info
  const { data: vcRaw } = await supabase
    .from('video_classes')
    .select('*, creator_profiles(id, display_name, slug, user_id, stripe_account_id, stripe_account_active)')
    .eq('id', classId)
    .single()

  if (!vcRaw || !vcRaw.active) return NextResponse.json({ error: 'Kurs nicht verfügbar' }, { status: 404 })

  const creator = Array.isArray(vcRaw.creator_profiles) ? vcRaw.creator_profiles[0] : vcRaw.creator_profiles

  // Duplicate check
  const { data: existingBooking } = await supabase
    .from('video_class_bookings')
    .select('id')
    .eq('video_class_id', classId)
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .maybeSingle()

  if (existingBooking) return NextResponse.json({ error: 'Du bist bereits angemeldet' }, { status: 409 })

  // Capacity check
  if (vcRaw.max_participants !== null) {
    const { count } = await supabase
      .from('video_class_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('video_class_id', classId)
      .eq('status', 'confirmed')
    if ((count ?? 0) >= vcRaw.max_participants) {
      return NextResponse.json({ error: 'Dieser Kurs ist ausgebucht' }, { status: 409 })
    }
  }

  // Determine price and subscription
  let priceCents = vcRaw.price_cents
  let subscriptionId: string | null = null

  if (vcRaw.included_in_subscription) {
    const { data: activeSub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('creator_id', vcRaw.creator_id)
      .eq('buyer_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (activeSub) {
      priceCents = 0
      subscriptionId = activeSub.id
    }
  }

  // Get or create shared Daily.co room for this class
  let dailyRoomUrl: string | null = null
  if (process.env.DAILY_API_KEY) {
    // Reuse room URL already stored on a prior booking for the same class
    const { data: priorBooking } = await supabase
      .from('video_class_bookings')
      .select('daily_room_url')
      .eq('video_class_id', classId)
      .not('daily_room_url', 'is', null)
      .limit(1)
      .maybeSingle()

    if (priorBooking?.daily_room_url) {
      dailyRoomUrl = priorBooking.daily_room_url
    } else {
      try {
        const roomName = `video-class-${classId}`
        const props: Record<string, unknown> = {
          max_participants: vcRaw.max_participants ?? 200,
          enable_chat: true,
          enable_screenshare: true,
        }
        // One-time classes expire 30 min after end; recurring rooms persist
        if (vcRaw.schedule_type === 'once' && vcRaw.starts_at) {
          props.exp = Math.floor(new Date(vcRaw.starts_at).getTime() / 1000) + (vcRaw.duration_minutes + 30) * 60
        }
        const createRes = await fetch('https://api.daily.co/v1/rooms', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName, privacy: 'public', properties: props }),
        })
        if (createRes.ok) {
          const room = await createRes.json() as { url: string }
          dailyRoomUrl = room.url
        } else if (createRes.status === 409) {
          // Room already exists with this name; fetch it
          const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
            headers: { 'Authorization': `Bearer ${process.env.DAILY_API_KEY}` },
          })
          if (getRes.ok) {
            const room = await getRes.json() as { url: string }
            dailyRoomUrl = room.url
          }
        }
      } catch { /* non-fatal: room creation failure doesn't block booking */ }
    }
  }

  // Paid booking → Stripe Checkout
  // TODO: Stripe Connect required for live payments to coaches
  if (priceCents > 0) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      locale: 'de',
      customer_email: user.email,
      line_items: [{
        price_data: { currency: 'eur', product_data: { name: vcRaw.title }, unit_amount: priceCents },
        quantity: 1,
      }],
      metadata: {
        video_class_id: classId,
        user_id: user.id,
        daily_room_url: dailyRoomUrl ?? '',
        // Webhook handler should create the video_class_booking row on checkout.session.completed
      },
      success_url: `${appUrl}/buyer/video-classes?success=1`,
      cancel_url: `${appUrl}/creators/${creator?.slug ?? ''}`,
    })
    return NextResponse.json({ checkoutUrl: session.url })
  }

  // Free booking → create directly
  const { data: booking, error } = await supabase
    .from('video_class_bookings')
    .insert({
      video_class_id:    classId,
      user_id:           user.id,
      subscription_id:   subscriptionId,
      price_paid_cents:  0,
      status:            'confirmed',
      daily_room_url:    dailyRoomUrl,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build schedule label (reused for both buyer + coach emails)
  const scheduleLabel = vcRaw.schedule_type === 'once' && vcRaw.starts_at
    ? new Date(vcRaw.starts_at).toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr'
    : vcRaw.recurring_weekday !== null
      ? `Jeden ${WEEKDAYS[vcRaw.recurring_weekday]}, ${vcRaw.recurring_time ?? ''} Uhr`
      : 'Termin folgt'
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health').replace(/\/$/, '')

  // Buyer confirmation email
  try {
    if (user.email && creator) {
      const { sendVideoClassConfirmation } = await import('@/lib/email/send')
      await sendVideoClassConfirmation(user.email, {
        classTitle:      vcRaw.title,
        coachName:       creator.display_name,
        scheduleLabel,
        durationMinutes: vcRaw.duration_minutes,
        roomUrl:         dailyRoomUrl,
        bookingsUrl:     `${appUrl}/buyer/video-classes`,
      })
    }
  } catch { /* non-fatal */ }

  // Coach notification (in-app + email), preference-gated
  if (creator?.user_id) {
    try {
      const buyerName = user.user_metadata?.full_name ?? user.email ?? 'Ein Teilnehmer'
      const [sendInapp, sendEmail] = await Promise.all([
        checkNotificationPreference(creator.user_id, 'new_video_class_booking', 'inapp'),
        checkNotificationPreference(creator.user_id, 'new_video_class_booking', 'email'),
      ])
      const notifJobs: Promise<unknown>[] = []
      if (sendInapp) {
        notifJobs.push(createNotification({
          userId:  creator.user_id,
          type:    'new_video_class_booking',
          title:   `Neue Anmeldung: ${vcRaw.title}`,
          message: `${buyerName} hat sich für deinen Kurs angemeldet.`,
          link:    `/creator/settings/video-classes`,
        }))
      }
      if (sendEmail) {
        const service = await createServiceClient()
        const coachEmailRes = await service.auth.admin.getUserById(creator.user_id)
        const coachEmail = coachEmailRes.data.user?.email
        if (coachEmail) {
          const { sendVideoClassNewParticipant } = await import('@/lib/email/send')
          notifJobs.push(sendVideoClassNewParticipant(coachEmail, {
            coachName:       creator.display_name,
            participantName: buyerName,
            classTitle:      vcRaw.title,
            scheduleLabel,
            dashboardUrl:    `${appUrl}/creator/settings/video-classes`,
          }))
        }
      }
      await Promise.allSettled(notifJobs)
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ bookingId: booking.id, roomUrl: dailyRoomUrl })
}
