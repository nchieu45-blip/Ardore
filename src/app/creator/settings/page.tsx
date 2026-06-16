import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CreditCard, Tag, User, ExternalLink, Video, Percent, Users } from 'lucide-react'
import DeleteAccountSection from './DeleteAccountSection'
import NotificationPreferencesSection, { type NotifPrefs } from '@/components/NotificationPreferencesSection'

export default async function CreatorSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  const { data: tiers } = await supabase
    .from('subscription_tiers')
    .select('*')
    .eq('creator_id', creator.id)
    .order('price_monthly', { ascending: true })

  const tierList = tiers ?? []

  const [coachingOfferRes, activeSubsRes, upcomingBookingsRes, notifPrefsRes] = await Promise.all([
    supabase
      .from('coaching_offers')
      .select('is_enabled, price_cents, duration_minutes')
      .eq('creator_id', creator.id)
      .single(),
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
  ])

  const coachingOffer          = coachingOfferRes.data
  const activeSubscribersCount = activeSubsRes.count ?? 0
  const upcomingBookingsCount  = upcomingBookingsRes.count ?? 0
  const defaultPrefs: NotifPrefs = {
    email_new_booking: true, email_session_reminder: true, email_new_message: true, email_new_video_class_booking: true,
    inapp_new_booking: true, inapp_session_reminder: true, inapp_new_message: true, inapp_new_video_class_booking: true,
  }
  const notifPrefs: NotifPrefs = (notifPrefsRes.data as NotifPrefs | null) ?? defaultPrefs

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Einstellungen</h1>

      <div className="space-y-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Coach-Profil</h2>
              </div>
              <Link href="/creator/settings/profile">
                <Button variant="outline" size="sm">Bearbeiten</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">Name</dt>
                <dd className="font-medium text-gray-900">{creator.display_name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Kategorien</dt>
                <dd className="font-medium text-gray-900">
                  {((creator.categories as string[] | null)?.length
                    ? (creator.categories as string[])
                    : creator.category ? [creator.category] : []
                  ).join(', ') || '–'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500">Profil-URL</dt>
                <dd className="font-medium text-gray-900 flex items-center gap-1">
                  /creators/{creator.slug}
                  <Link href={`/creators/${creator.slug}`} target="_blank">
                    <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                  </Link>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Subscription Tiers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Abo-Preisstufen</h2>
              </div>
              <Link href="/creator/settings/tiers">
                <Button size="sm">Verwalten</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {tierList.length === 0 ? (
              <p className="text-sm text-gray-500">
                Noch keine Abo-Preisstufen eingerichtet.{' '}
                <Link href="/creator/settings/tiers" className="text-green-600 hover:underline">
                  Jetzt erstellen
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {tierList.map((tier: { id: string; name: string; price_monthly: number; is_active: boolean }) => (
                  <div key={tier.id} className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-900">{tier.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">{tier.price_monthly.toFixed(2)} €/Monat</span>
                      <Badge variant={tier.is_active ? 'success' : 'default'}>
                        {tier.is_active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Video coaching */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Videocoaching</h2>
              </div>
              <Link href="/creator/settings/videocoaching">
                <Button variant="outline" size="sm">Einrichten</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${coachingOffer?.is_enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-sm text-gray-700">
                {coachingOffer?.is_enabled
                  ? `Aktiv · ${coachingOffer.duration_minutes} Min · ${((coachingOffer.price_cents ?? 0) / 100).toFixed(2)} €`
                  : 'Nicht aktiviert – richte 1:1 Sessions für Kunden ein'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Discounts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Percent className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Rabatte & Gutscheine</h2>
              </div>
              <Link href="/creator/settings/discounts">
                <Button variant="outline" size="sm">Verwalten</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Erstelle Gutscheincodes und automatische Rabatte für Produkte, Abos und Sessions.
            </p>
          </CardContent>
        </Card>

        {/* Video Classes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Gruppen-Videokurse</h2>
              </div>
              <Link href="/creator/settings/video-classes">
                <Button variant="outline" size="sm">Verwalten</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Erstelle einmalige oder wiederkehrende Gruppen-Videosessions für mehrere Teilnehmer gleichzeitig.
            </p>
          </CardContent>
        </Card>

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
