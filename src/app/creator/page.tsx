import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadCoachEarnings } from '@/lib/coach-earnings-server'
import EarningsSummary from '@/components/creator/EarningsSummary'
import { CoachDayOverview, type WorkspaceBooking } from '@/components/pilot/CoachDayOverview'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Users, ShoppingBag, Plus, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react'
import { RevenueChart } from '@/components/creator/RevenueChart'

export const metadata: Metadata = {
  title: 'Creator Dashboard',
  description: 'Verwalte deine Produkte, Abonnements und Einnahmen auf Ardore.',
}

export default async function CreatorDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (!creator) redirect('/creator/onboarding')

  // Request-time server read, matching the existing sessions overview.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const [productsRes, subscriptionsRes, earnings, bookingsRes, ongoingRes] = await Promise.all([
    supabase.from('products').select('*').eq('creator_id', creator.id).order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('*, tier:subscription_tiers(price_monthly)').eq('creator_id', creator.id).eq('status', 'active'),
    loadCoachEarnings(supabase, user.id).catch(() => null),
    // Same session-bound client/RLS as sessions; read only, scoped to the authenticated coach.
    supabase.from('bookings')
      .select('id, buyer_name, scheduled_at, duration_minutes, status, payment_status, price_cents, is_subscription_session')
      .eq('creator_id', creator.id).in('status', ['confirmed', 'pending_payment'])
      .gte('scheduled_at', new Date(now).toISOString())
      .order('scheduled_at', { ascending: true }).limit(5),
    supabase.from('bookings')
      .select('id, buyer_name, scheduled_at, duration_minutes, status, payment_status, price_cents, is_subscription_session')
      .eq('creator_id', creator.id).in('status', ['confirmed', 'pending_payment'])
      .gte('scheduled_at', new Date(now - 24 * 60 * 60_000).toISOString()).lt('scheduled_at', new Date(now).toISOString())
      .order('scheduled_at', { ascending: false }).limit(10),
  ])
  if (productsRes.error || subscriptionsRes.error) throw new Error('Dein Coach-Bereich konnte nicht geladen werden')

  // Past appointments cannot exhaust the future query's limit. Merge overlapping reads defensively.
  const bookings = [...new Map<string, WorkspaceBooking>(
    [...(bookingsRes.data ?? []), ...(ongoingRes.data ?? [])].map((b: WorkspaceBooking) => [b.id, b])
  ).values()].sort((a,b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  const bookingsError = Boolean(bookingsRes.error || ongoingRes.error)
  const confirmedIds = bookings.filter(b => b.status === 'confirmed').map(b => b.id)
  // Only presence is needed on the home screen; private meeting URLs never enter this markup.
  const meetingRes = confirmedIds.length ? await supabase.from('booking_meeting_links')
    .select('booking_id').in('booking_id', confirmedIds) : { data: [], error: null }
  const meetingReadyIds = new Set<string>((meetingRes.data ?? []).map((row: { booking_id: string }) => row.booking_id))
  const products = productsRes.data ?? []
  const subscriptions = subscriptionsRes.data ?? []
  const dateLabel = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' })
  const recentProducts = products.slice(0, 5)

  return (
    <div className="bg-background min-h-full" data-ardore-pilot="workspace">
      <div className="ardore-workspace py-6 space-y-6">

        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={creator.avatar_url} name={creator.display_name} size="md" />
            <div className="min-w-0"><p className="mb-1 text-sm text-muted">{dateLabel} · Europe/Berlin</p><h1 className="break-words text-2xl font-semibold tracking-tight">Dein Arbeitsbereich</h1><p className="mt-1 text-sm text-muted">{creator.display_name}</p></div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <ButtonLink href="/creator/calendar" size="sm">Kalender öffnen</ButtonLink>
            {creator.is_published && <ButtonLink href={`/creators/${creator.slug}`} target="_blank" rel="noopener noreferrer" size="sm" variant="secondary"><ExternalLink className="h-4 w-4" aria-hidden="true" />Mein öffentliches Profil</ButtonLink>}
          </div>
        </header>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <CoachDayOverview bookings={bookings} error={bookingsError} meetingReadyIds={meetingReadyIds} meetingError={!!meetingRes.error} now={now} />
          <section aria-labelledby="workspace-actions-title" className="surface-card min-w-0 p-5">
            <p className="mb-1 text-sm text-brand">Nächster Schritt</p><h2 id="workspace-actions-title" className="mb-4 text-xl font-semibold tracking-tight">Im Blick behalten</h2>
            {!creator.is_published && <div className="mb-4 border-b border-border pb-4"><Badge variant="outline">Profil im Entwurf</Badge><p className="mt-2 text-sm text-muted">Dein Profil ist noch nicht öffentlich sichtbar.</p><Link href="/creator/onboarding" className="inline-flex min-h-11 items-center text-sm font-medium text-brand">Profil-Setup fortsetzen →</Link></div>}
            {bookingsError || meetingRes.error ? <p role="status" className="mb-3 text-sm text-muted">Session-Aufgaben konnten nicht vollständig geprüft werden.</p>
              : bookings.some(b => b.status === 'confirmed' && new Date(b.scheduled_at).getTime() + b.duration_minutes * 60_000 > now && !meetingReadyIds.has(b.id)) && <p className="mb-3 text-sm text-amber-800">Bei einem bevorstehenden Termin fehlt der Meeting-Link. Öffne die Sessiondetails im Terminbereich.</p>}
            {earnings && (earnings.all.refundPending > 0 || earnings.all.reversalPending > 0) && <Link href="/creator/earnings" className="mb-3 inline-flex min-h-11 items-center text-sm text-amber-800">Erstattung oder Rückübertragung noch offen – Abrechnung prüfen →</Link>}
            <nav aria-label="Coach-Schnellzugriff" className="divide-y divide-border">
              {[['/creator/sessions','Buchungen & Sessiondetails'],['/creator/products','Produkte verwalten'],['/creator/settings/videocoaching','Coaching & Verfügbarkeit'],['/creator/settings/tiers','Abonnements verwalten']].map(([href,label]) => <Link key={href} href={href} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm font-medium text-foreground hover:text-brand">{label}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>)}
            </nav>
            <ButtonLink href="/creator/products/new" size="sm" variant="secondary" className="mt-4 w-full"><Plus className="h-4 w-4" aria-hidden="true" />Produkt hinzufügen</ButtonLink>
          </section>
        </div>

        {/* Stripe Connect banner — slim, low-weight */}
        {!creator.stripe_account_active && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-400 rounded-lg">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-800 flex-1">
              Stripe-Auszahlungen derzeit nicht freigegeben. Prüfe den Status deines Connect-Kontos.
            </p>
            <ButtonLink href="/creator/settings/payout" className="flex-shrink-0" size="sm" variant="secondary">Status prüfen</ButtonLink>
          </div>
        )}

        {earnings ? <section aria-labelledby="workspace-finances-title" className="surface-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="workspace-finances-title" className="text-lg font-semibold">Finanzen im Überblick</h2><Link className="inline-flex min-h-11 items-center text-sm text-brand" href="/creator/earnings">Einnahmen ansehen →</Link></div>
          {earnings.testMode && <p className="mb-4 text-sm text-amber-800">Stripe-Testmodus · keine echten Einnahmen</p>}
          <dl className="grid gap-4 sm:grid-cols-3">{[
            ['Coach-Nettoerlös', earnings.all.net], ['Auf Stripe-Guthaben übertragen', earnings.all.transferred], ['Übertragung ausstehend', earnings.all.pending],
          ].map(([label,value]) => <div key={label} className="min-w-0"><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 break-words text-2xl font-semibold tracking-tight">{formatCurrency(Number(value) / 100)}</dd></div>)}</dl>
          <p className="mt-3 text-sm text-muted">Alle Zeit · Settlement-Ledger, nach bestätigten Erstattungen. Übertragungen sind keine Bankauszahlungen.</p>
          <details className="mt-4 border-t border-border pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-brand">Abrechnung, Erstattungen & Hinweise</summary><div className="mt-4"><EarningsSummary report={earnings} compact /></div></details>
        </section> : <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Einnahmen konnten nicht vollständig geladen werden. Bitte lade die Seite erneut; es werden keine unvollständigen Summen angezeigt.</p>}
        <div className="grid grid-cols-2 gap-4">
          {[
            { Icon: Users, label: 'Abonnenten', value: subscriptions.length.toString(), sub: 'Aktiv – keine Umsatzprognose' },
            { Icon: ShoppingBag, label: 'Produkte', value: products.length.toString(), sub: `${products.filter((p: { is_published: boolean }) => p.is_published).length} veröffentlicht` },
          ].map(({ Icon, label, value, sub }) => <div key={label} className="surface-card p-5">
            <Icon className="mb-2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <p className="text-sm text-gray-600">{label}</p><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-gray-500">{sub}</p>
          </div>)}
        </div>
        {/* Products + Subscribers */}
        <div className="grid lg:grid-cols-2 gap-6">

          {/* Products */}
          <div className="surface-card min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Meine Produkte</h2>
              <Link href="/creator/products" className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 transition-colors">
                Alle anzeigen <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recentProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-10 px-6">
                <ShoppingBag className="h-8 w-8 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Noch keine Produkte</p>
                <ButtonLink href="/creator/products/new" className="mt-3" size="sm">Erstes Produkt erstellen</ButtonLink>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-gray-50">
                {recentProducts.map((product: { id: string; title: string; price: number; is_published: boolean; created_at: string }) => (
                  <li key={product.id} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between px-6 py-3.5">
                    <div className="min-w-0 w-full sm:w-auto">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(product.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 sm:ml-4">
                      <span className="text-sm font-medium text-gray-900">{formatCurrency(product.price)}</span>
                      <Badge variant={product.is_published ? 'success' : 'outline'}>
                        {product.is_published ? 'Live' : 'Entwurf'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Subscribers */}
          <div className="surface-card min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Aktive Abonnenten</h2>
              <Link href="/creator/settings/tiers" className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 transition-colors">
                Alle anzeigen <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {subscriptions.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-10 px-6">
                <Users className="h-8 w-8 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Noch keine Abonnenten</p>
                <ButtonLink href="/creator/settings/tiers" className="mt-3" size="sm" variant="secondary">Abo-Preise einrichten</ButtonLink>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-gray-50">
                {subscriptions.slice(0, 5).map((sub: { id: string; tier: { price_monthly: number } | null; current_period_end: string }) => (
                  <li key={sub.id} className="flex items-center justify-between px-6 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Abonnent</p>
                      <p className="text-xs text-gray-400 mt-0.5">bis {formatDate(sub.current_period_end)}</p>
                    </div>
                    <span className="text-sm font-semibold text-green-600">
                      Tarifpreis: {formatCurrency(sub.tier?.price_monthly ?? 0)}/Mo.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
        <details className="surface-card p-5"><summary className="min-h-11 cursor-pointer text-sm font-medium text-brand">Umsatzverlauf · letzte 7 Tage</summary>
        <div className="pt-4">
          <h2 className="mb-4 text-sm font-semibold">Bruttoumsatz nach Erstattungen – letzte 7 Tage</h2>
          {earnings && <RevenueChart data={earnings.days} />}
          <p className="mt-3 text-xs text-gray-500">Alle Zahlungsquellen im Ledger; Zuordnung nach Erfassungsdatum in Europe/Berlin.</p>
        </div>

        </details>
      </div>
    </div>
  )
}
