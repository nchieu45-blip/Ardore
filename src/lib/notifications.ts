import { createServiceClient } from '@/lib/supabase/server'

export type NotificationType =
  | 'new_booking'
  | 'booking_confirmed'
  | 'new_subscriber'
  | 'new_message'
  | 'session_reminder'
  | 'new_review'
  | 'session_review_prompt'
  | 'new_video_class_booking'

const TRACKED_PREF_KEYS = [
  'inapp_new_booking', 'email_new_booking',
  'inapp_session_reminder', 'email_session_reminder',
  'inapp_new_message', 'email_new_message',
  'inapp_new_video_class_booking', 'email_new_video_class_booking',
]

export async function checkNotificationPreference(
  userId: string,
  type: NotificationType,
  channel: 'inapp' | 'email',
): Promise<boolean> {
  const col = `${channel}_${type}`
  if (!TRACKED_PREF_KEYS.includes(col)) return true
  try {
    const service = await createServiceClient()
    const { data } = await service
      .from('notification_preferences')
      .select(col)
      .eq('user_id', userId)
      .maybeSingle()
    if (!data) return true
    return (data as unknown as Record<string, boolean>)[col] !== false
  } catch {
    return true
  }
}

export async function createNotification({
  userId,
  type,
  title,
  message,
  link,
}: {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
}) {
  try {
    const service = await createServiceClient()
    await service.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      link: link ?? null,
    })
  } catch (e) {
    console.error('[createNotification]', e)
  }
}
