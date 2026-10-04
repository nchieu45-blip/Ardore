import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadCoachEarnings } from '@/lib/coach-earnings-server'
import EarningsSummary from '@/components/creator/EarningsSummary'
export const metadata: Metadata = { title: 'Einnahmen' }
const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
export default async function EarningsPage() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/login')
  const { data: coach } = await client.from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!coach) redirect('/creator/onboarding')
  let report
  try { report = await loadCoachEarnings(client, user.id) } catch { /* Fail closed: no incomplete/zero financial totals. */ }
  return <div className="mx-auto max-w-5xl px-4 py-8">
    <h1 className="mb-2 text-2xl font-bold">Einnahmen</h1>
    <p className="mb-6 text-sm text-gray-600">Bezahlte Produkte, Coaching-Buchungen und Abo-Zyklen – ohne Vermischung mit aktuellen Tarifpreisen.</p>
    {!report ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Deine Einnahmen konnten nicht vollständig geladen werden. Es werden keine unvollständigen Summen angezeigt. <a href="/creator/earnings" className="underline">Erneut laden</a></div> : <>
      <EarningsSummary report={report} />
      <section className="mt-8"><h2 className="mb-3 font-semibold">Alle Zeit nach Quelle · Settlement-Ledger</h2>
        <dl className="space-y-3">{([['products', 'Produktkäufe'], ['booking', 'Bezahlte Coaching-Buchungen'], ['subscription', 'Bezahlte Abo-Zyklen']] as const).map(([kind, label]) => <div key={kind} className="rounded-xl border border-gray-200 p-4">
          <dt className="font-medium">{label} · {report.sources[kind].payments} {report.sources[kind].payments === 1 ? 'Zahlung' : 'Zahlungen'}</dt>
          <dd className="mt-2 text-sm text-gray-600">Bruttoumsatz nach Erstattungen: {money(report.sources[kind].retained)} · Ardore-Gebühr: {money(report.sources[kind].fee)} · Coach-Nettoerlös: {money(report.sources[kind].net)}</dd>
        </div>)}</dl>
      </section>
      {!report.all.payments && <p className="mt-6 text-sm text-gray-600">Noch keine bezahlten Transaktionen im Settlement-Ledger.</p>}
    </>}
  </div>
}
