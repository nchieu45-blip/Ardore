import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import DeleteAccountSection from '@/app/creator/settings/DeleteAccountSection'
import NotificationPreferencesSection, { type NotifPrefs } from '@/components/NotificationPreferencesSection'

export const metadata: Metadata = { title: 'Kontoeinstellungen' }

export default async function BuyerSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, activeSubsRes, upcomingBookingsRes, notifPrefsRes] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', user.id)
      .eq('status', 'active'),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', user.id)
      .eq('status', 'confirmed')
      .gt('scheduled_at', new Date().toISOString()),
    supabase
      .from('notification_preferences')
      .select('email_new_booking,email_session_reminder,email_new_message,email_new_video_class_booking,inapp_new_booking,inapp_session_reminder,inapp_new_message,inapp_new_video_class_booking')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const activeSubscriptionsCount = activeSubsRes.count ?? 0
  const upcomingBookingsCount    = upcomingBookingsRes.count ?? 0
  const defaultPrefs: NotifPrefs = {
    email_new_booking: true, email_session_reminder: true, email_new_message: true, email_new_video_class_booking: true,
    inapp_new_booking: true, inapp_session_reminder: true, inapp_new_message: true, inapp_new_video_class_booking: true,
  }
  const notifPrefs: NotifPrefs = (notifPrefsRes.data as NotifPrefs | null) ?? defaultPrefs

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Kontoeinstellungen</h1>
      <p className="text-gray-500 mb-8">{profileRes.data?.full_name ?? user.email}</p>

      <div className="space-y-6">
        {/* Account info */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Konto-Informationen</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-gray-500 w-24 flex-shrink-0">E-Mail</dt>
              <dd className="font-medium text-gray-900">{user.email}</dd>
            </div>
            {profileRes.data?.full_name && (
              <div className="flex items-center gap-2">
                <dt className="text-gray-500 w-24 flex-shrink-0">Name</dt>
                <dd className="font-medium text-gray-900">{profileRes.data.full_name}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Notifications */}
        <NotificationPreferencesSection initialPrefs={notifPrefs} isCreator={false} />

        {/* Danger zone */}
        <div className="pt-2 border-t border-gray-100">
          <DeleteAccountSection
            isCreator={false}
            activeSubscribersCount={0}
            upcomingBookingsCount={upcomingBookingsCount}
            activeSubscriptionsCount={activeSubscriptionsCount}
          />
        </div>
      </div>
    </div>
  )
}
