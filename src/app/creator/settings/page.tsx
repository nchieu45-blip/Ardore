import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CreditCard, ShieldCheck } from 'lucide-react'
import DeleteAccountSection from './DeleteAccountSection'
import NotificationPreferencesSection, { type NotifPrefs } from '@/components/NotificationPreferencesSection'
import VerificationSection from './VerificationSection'

export default async function CreatorSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id, stripe_account_active, is_verified, verified_at')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  const [activeSubsRes, upcomingBookingsRes, notifPrefsRes, vreqRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creator.id)
      .eq('status', 'active'),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creator.id)
      .eq('status', 'confirmed')
      .gt('scheduled_at', new Date().toISOString()),
    supabase
      .from('notification_preferences')
      .select('email_new_booking,email_session_reminder,email_new_message,email_new_video_class_booking,inapp_new_booking,inapp_session_reminder,inapp_new_message,inapp_new_video_class_booking')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('verification_requests')
      .select('id, status, rejection_reason, created_at')
      .eq('creator_id', creator.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const activeSubscribersCount = activeSubsRes.count ?? 0
  const upcomingBookingsCount  = upcomingBookingsRes.count ?? 0
  const latestVreq = vreqRes.data as { id: string; status: 'pending' | 'approved' | 'rejected'; rejection_reason: string | null; created_at: string } | null
  const defaultPrefs: NotifPrefs = {
    email_new_booking: true, email_session_reminder: true, email_new_message: true, email_new_video_class_booking: true,
    inapp_new_booking: true, inapp_session_reminder: true, inapp_new_message: true, inapp_new_video_class_booking: true,
  }
  const notifPrefs: NotifPrefs = (notifPrefsRes.data as NotifPrefs | null) ?? defaultPrefs

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Einstellungen</h1>

      <div className="space-y-6">
        {/* Payout / Stripe Connect */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Auszahlungen (Stripe Connect)</h2>
              </div>
              <Link href="/creator/settings/payout">
                <Button variant={creator.stripe_account_active ? 'outline' : 'primary'} size="sm">
                  {creator.stripe_account_active ? 'Verwalten' : 'Einrichten'}
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${creator.stripe_account_active ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-sm text-gray-700">
                {creator.stripe_account_active
                  ? 'Stripe Connect aktiv – Auszahlungen werden automatisch verarbeitet'
                  : 'Stripe Connect noch nicht eingerichtet'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Verifizierung */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-gray-500" />
              <h2 className="font-semibold text-gray-900">Verifizierung</h2>
            </div>
          </CardHeader>
          <CardContent>
            <VerificationSection
              isVerified={creator.is_verified ?? false}
              verifiedAt={(creator as { verified_at?: string | null }).verified_at ?? null}
              latestRequest={latestVreq}
            />
          </CardContent>
        </Card>

        {/* Notifications */}
        <NotificationPreferencesSection initialPrefs={notifPrefs} isCreator={true} />

        {/* Danger zone */}
        <div className="pt-4 border-t border-gray-100">
          <DeleteAccountSection
            isCreator={true}
            activeSubscribersCount={activeSubscribersCount}
            upcomingBookingsCount={upcomingBookingsCount}
            activeSubscriptionsCount={0}
          />
        </div>
      </div>
    </div>
  )
}
