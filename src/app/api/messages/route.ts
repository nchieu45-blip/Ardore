import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendChatNotification } from '@/lib/email/send'
import { createNotification, checkNotificationPreference } from '@/lib/notifications'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health'
// Don't send another notification if sender already sent one in this window
const NOTIFY_COOLDOWN_MINUTES = 30

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { creatorId, content } = await req.json()
  if (!content?.trim() || !creatorId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify sender has access (buyer with active subscription OR the creator themselves)
  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id, user_id, display_name')
    .eq('id', creatorId)
    .single()

  if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })

  const isCreator = creator.user_id === user.id

  if (!isCreator) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('creator_id', creatorId)
      .eq('buyer_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!sub) return NextResponse.json({ error: 'No active subscription' }, { status: 403 })
  }

  // Insert the message
  const { data: message, error } = await supabase
    .from('messages')
    .insert({ sender_id: user.id, creator_id: creatorId, content: content.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Rate-limited notification ──────────────────────────────────────────────
  // Check how many messages this sender has sent in this conversation in the
  // last NOTIFY_COOLDOWN_MINUTES. If > 1 (counting the one just inserted),
  // they've already triggered a notification recently — skip.
  const cooldownStart = new Date(Date.now() - NOTIFY_COOLDOWN_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .eq('sender_id', user.id)
    .gte('created_at', cooldownStart)

  if ((count ?? 0) <= 1) {
    // First message in this window — send notification to recipient
    sendNotification({
      isCreator,
      senderId: user.id,
      creatorId,
      creatorUserId: creator.user_id,
      creatorName: creator.display_name,
      messageContent: content.trim(),
    }).catch(console.error)
  }

  return NextResponse.json({ message })
}

async function sendNotification({
  isCreator,
  senderId,
  creatorId,
  creatorUserId,
  creatorName,
  messageContent,
}: {
  isCreator: boolean
  senderId: string
  creatorId: string
  creatorUserId: string
  creatorName: string
  messageContent: string
}) {
  const admin = await createServiceClient()

  if (isCreator) {
    // Creator sent a message → find the most recent buyer in this conversation
    const { data: lastBuyerMsg } = await admin
      .from('messages')
      .select('sender_id')
      .eq('creator_id', creatorId)
      .neq('sender_id', creatorUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastBuyerMsg) return

    const buyerRes = await admin.auth.admin.getUserById(lastBuyerMsg.sender_id)
    const buyerEmail = buyerRes.data.user?.email
    const buyerName = buyerRes.data.user?.user_metadata?.full_name ?? 'Abonnent'
    if (!buyerEmail) return

    const [inapp, email] = await Promise.all([
      checkNotificationPreference(lastBuyerMsg.sender_id, 'new_message', 'inapp'),
      checkNotificationPreference(lastBuyerMsg.sender_id, 'new_message', 'email'),
    ])
    const notifJobs: Promise<unknown>[] = []
    if (inapp) {
      notifJobs.push(createNotification({
        userId: lastBuyerMsg.sender_id,
        type: 'new_message',
        title: `Neue Nachricht von ${creatorName}`,
        message: messageContent.slice(0, 120),
        link: `/chat/${creatorId}`,
      }))
    }
    if (email) {
      notifJobs.push(sendChatNotification(buyerEmail, {
        recipientName: buyerName,
        senderName: creatorName,
        messagePreview: messageContent,
        chatUrl: `${APP_URL}/chat/${creatorId}`,
      }))
    }
    await Promise.allSettled(notifJobs)
  } else {
    // Buyer sent a message → notify the creator
    const creatorEmailRes = await admin.auth.admin.getUserById(creatorUserId)
    const creatorEmail = creatorEmailRes.data.user?.email
    if (!creatorEmail) return

    const senderRes = await admin.auth.admin.getUserById(senderId)
    const senderName = senderRes.data.user?.user_metadata?.full_name ?? 'Abonnent'

    const [inapp, email] = await Promise.all([
      checkNotificationPreference(creatorUserId, 'new_message', 'inapp'),
      checkNotificationPreference(creatorUserId, 'new_message', 'email'),
    ])
    const notifJobs: Promise<unknown>[] = []
    if (inapp) {
      notifJobs.push(createNotification({
        userId: creatorUserId,
        type: 'new_message',
        title: `Neue Nachricht von ${senderName}`,
        message: messageContent.slice(0, 120),
        link: `/creator/chat/${senderId}`,
      }))
    }
    if (email) {
      notifJobs.push(sendChatNotification(creatorEmail, {
        recipientName: creatorName,
        senderName,
        messagePreview: messageContent,
        chatUrl: `${APP_URL}/creator/chat/${senderId}`,
      }))
    }
    await Promise.allSettled(notifJobs)
  }
}
