import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subscriptionPriceLabels } from '@/lib/subscription-price'
import { hasActiveSubscriptionEntitlement, type SubscriptionEntitlement } from '@/lib/subscription-entitlement'
import { SubscriptionCancellation } from '@/components/subscriptions/SubscriptionCancellation'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { StatePanel } from '@/components/ui/StatePanel'
import { formatDate } from '@/lib/utils'
import { MessageCircle, Video } from 'lucide-react'

interface BuyerSubscription extends SubscriptionEntitlement {
  id: string
  buyer_id: string
  tier_id: string | null
  creator: { id: string; display_name: string; slug: string; avatar_url: string | null; category: string | null } | null
  tier: {
    creator_id: string
    name: string
    price_monthly: number
    included_video_sessions?: number
    video_session_period?: string | null
    included_session_duration_minutes?: number | null
  } | null
}

export default async function SubscriptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: subscriptions, error } = await supabase
    .from('subscriptions')
    .select('*, creator:creator_profiles(id, display_name, slug, avatar_url, category), tier:subscription_tiers(creator_id, name, price_monthly, included_video_sessions, video_session_period, included_session_duration_minutes)')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="section-title text-gray-900 mb-8">Meine Abonnements</h1>
      <StatePanel kind="error" title="Abonnements konnten nicht geladen werden"
        description="Bitte lade die Seite erneut. Es wurden keine Abonnements geändert."
        action={<ButtonLink href="/buyer/subscriptions" variant="outline">Erneut laden</ButtonLink>} />
    </div>
  )

  const subList: BuyerSubscription[] = subscriptions ?? []
  const priceLabels = await subscriptionPriceLabels(await createServiceClient(), user.id, subList)

  // Compute remaining sessions for active subs that include video sessions
  const now = new Date()
  const sessionsMap: Record<string, { remaining: number; total: number; period: string; durationMinutes: number | null }> = {}

  await Promise.all(
    subList
      .filter((s) =>
        hasActiveSubscriptionEntitlement(s, now.getTime()) && (s.tier?.included_video_sessions ?? 0) > 0
      )
      .map(async (sub) => {
        const tier   = sub.tier!
        const total  = tier.included_video_sessions!
        const period = tier.video_session_period ?? 'month'

        let periodStart: Date
        if (period === 'week') {
          const daysToMon = (now.getDay() + 6) % 7
          periodStart = new Date(now)
          periodStart.setDate(now.getDate() - daysToMon)
          periodStart.setHours(0, 0, 0, 0)
        } else {
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        }

        const { count } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('subscription_id', sub.id)
          .neq('status', 'cancelled')
          .gte('created_at', periodStart.toISOString())

        const used = count ?? 0
        sessionsMap[sub.id] = {
          remaining: Math.max(0, total - used),
          total,
          period,
          durationMinutes: tier.included_session_duration_minutes ?? null,
        }
      })
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="section-title text-gray-900 mb-2">Meine Abonnements</h1>
      <p className="text-gray-500 mb-8">{subList.filter((s: { status: string }) => s.status === 'active').length} aktive Abonnements</p>

      {subList.length === 0 ? (
        <Card className="text-center py-16">
          <p className="text-gray-500 mb-4">Du hast noch keine Abonnements.</p>
          <ButtonLink href="/coaches">Coaches entdecken</ButtonLink>
        </Card>
      ) : (
        <div className="space-y-4">
          {subList.map((sub) => {
            const hasAccess = hasActiveSubscriptionEntitlement(sub, now.getTime())
            const isFree = sub.stripe_livemode === null && sub.stripe_subscription_id.startsWith('free_')
            const sessions = sessionsMap[sub.id] ?? null
            const periodLabel = sessions?.period === 'week' ? 'diese Woche' : 'diesen Monat'
            const durationLabel = sessions?.durationMinutes ? ` à ${sessions.durationMinutes} Min` : ''

            return (
              <Card key={sub.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <Avatar
                      src={sub.creator?.avatar_url}
                      name={sub.creator?.display_name ?? '?'}
                      size="md"
                    />
                    <div className="flex-1 min-w-0 basis-40">
                      {sub.creator?.slug ? (
                        <Link href={`/creators/${sub.creator.slug}`} className="font-semibold text-gray-900 hover:text-green-600 break-words">
                          {sub.creator.display_name}
                        </Link>
                      ) : <p className="font-semibold text-gray-900">Coach nicht verfügbar</p>}
                      <p className="text-sm text-gray-500">{sub.tier?.name}</p>
                      <p className="text-sm text-muted mt-0.5">
                        {isFree ? 'Kostenloses Abo' : `Aktueller Zeitraum bis ${formatDate(sub.current_period_end)}`}
                      </p>
                      {sessions && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            sessions.remaining > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <Video className="h-3 w-3" />
                            {sessions.remaining > 0
                              ? `Noch ${sessions.remaining} von ${sessions.total} Session${sessions.total !== 1 ? 's' : ''}${durationLabel} ${periodLabel}`
                              : `${sessions.total} Session${sessions.total !== 1 ? 's' : ''}${durationLabel} ${periodLabel} (verbraucht)`}
                          </span>
                          {sessions.remaining > 0 && sub.creator?.slug && (
                            <Link
                              href={`/creators/${sub.creator.slug}#booking`}
                              className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                            >
                              Jetzt buchen →
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="font-semibold text-gray-900">{priceLabels[sub.id]}</p>
                        <Badge variant={sub.status === 'active' ? 'success' : sub.status === 'past_due' ? 'warning' : 'default'}>
                          {sub.status === 'active' ? 'Aktiv' : sub.status === 'past_due' ? 'Zahlung ausstehend' : sub.status === 'trialing' ? 'Testzeitraum' : sub.status === 'canceled' ? 'Beendet' : 'Status unbekannt'}
                        </Badge>
                      </div>
                      {hasAccess && sub.creator?.id && (
                        <ButtonLink href={`/chat/${sub.creator.id}`} variant="outline" size="sm"
                          aria-label={`Chat mit ${sub.creator.display_name} öffnen`}>
                          <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        </ButtonLink>
                      )}
                    </div>
                  </div>
                  <SubscriptionCancellation subscriptionId={sub.id}
                    creatorName={sub.creator?.display_name ?? 'deinem Coach'} initiallyEnded={sub.status === 'canceled'} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
