import { createServiceClient } from '@/lib/supabase/server'

export type NotificationType =
  | 'new_booking'
  | 'booking_confirmed'
  | 'new_subscriber'
  | 'new_message'
  | 'session_reminder'
  | 'new_review'

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
