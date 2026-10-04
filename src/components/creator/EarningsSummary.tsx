import Link from 'next/link'
import type { EarningsReport } from '@/lib/coach-earnings-server'
import type { EarningsTotals } from '@/lib/coach-earnings'
const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
function Metrics({ totals }: { totals: EarningsTotals }) {
  const metrics = [
    ['Bruttoumsatz nach Erstattungen', totals.retained, 'Tatsächliche Kundenzahlungen abzüglich bestätigter Erstattungen.'],
    ['Ardore-Gebühr nach Erstattungen', totals.fee, 'Verbleibender Plattformanteil laut vereinbarter 10-%-Gebühr und bestehender Erstattungslogik.'],
    ['Coach-Nettoerlös', totals.net, 'Rechnerischer Coach-Anteil nach Erstattungen; noch keine Bankauszahlung.'],
    ['Auf Stripe-Guthaben übertragen', totals.transferred, 'Bestätigte Transfers abzüglich bestätigter Rückübertragungen.'],
    ['Übertragung ausstehend', totals.pending, 'Noch nicht übertragen; kann bei fehlender Auszahlungsbereitschaft oder offener Klärung zurückgestellt sein.'],
    ['An Kunden erstattet', totals.refunded, 'Nur bestätigte Kunden-Erstattungen. Bereits im Bruttoumsatz und Nettoerlös berücksichtigt.'],
  ] as const
  return <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{metrics.map(([label, value, explanation]) => <div key={label} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
    <dt className="text-sm font-medium text-gray-600">{label}</dt><dd className="mt-2 text-2xl font-bold break-words">{money(value)}</dd><p className="mt-2 text-xs text-gray-500">{explanation}</p>
  </div>)}</dl>
}
export default function EarningsSummary({ report, compact = false }: { report: EarningsReport; compact?: boolean }) {
  const { all, month, legacy } = report
  return <div className="space-y-6">
    {report.testMode && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Stripe-Testmodus: Die angezeigten Beträge sind Testzahlungen, keine echten Einnahmen.</p>}
    {(legacy.products + legacy.bookings + legacy.subscriptions) > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Historische Abrechnung nicht vollständig im Ledger</p>
      <p className="mt-1">{legacy.products} Produktpositionen, {legacy.bookings} Buchungen und {legacy.subscriptions} Abos haben keine vollständige Ledger-Zuordnung. Die Ledger-Summen unten umfassen ausschließlich erfasste Ledger-Zahlungen. Historische Gebühren, Transfers oder Abo-Zyklen werden nicht geschätzt.</p>
      <p className="mt-2">Separat belegter historischer Bruttoumsatz nach Erstattungen: Produkte {money(legacy.knownProductGross)} · Buchungen {money(legacy.knownBookingGross)}. Diese Beträge sind nicht noch einmal in den Ledger-Summen enthalten.</p>
      <p className="mt-3 font-semibold">Belegter Bruttoumsatz – Alle Zeit, nach Erstattungen: {money(all.retained + legacy.knownProductGross + legacy.knownBookingGross)} (Ledger plus belegte historische Beträge).</p>
      {legacy.unclear > 0 && <p className="mt-2">{legacy.unclear} historische Zahlungen mit unklarem oder strittigem Status werden nicht als Umsatz ausgewiesen.</p>}
    </div>}
    <section data-testid="earnings-all"><h2 className="mb-3 font-semibold">Alle Zeit · Settlement-Ledger</h2><Metrics totals={all} />
      <p className="mt-3 text-sm text-gray-600">Erfasste Kundenzahlungen vor Erstattungen: {money(all.gross)} · {all.payments} bezahlte Transaktionen/Zyklen. Bruttoumsatz = Ardore-Gebühr + Coach-Nettoerlös.</p>
      <p className="mt-2 text-xs text-gray-500">Eine Übertragung auf Stripe-Guthaben bestätigt keine Bankauszahlung. Stripe-Zahlungsgebühren und Steuerberechnung sind hier nicht enthalten.</p>
      {all.reversalPending > 0 && <p role="status" className="mt-3 text-sm text-amber-900">Rückübertragung noch offen: {money(all.reversalPending)}. Coach-Nettoerlös = übertragen + ausstehend − offene Rückübertragung.</p>}
      {all.refundPending > 0 && <p role="status" className="mt-3 text-sm text-amber-900">Erstattung in Bearbeitung: {money(all.refundPending)}. Noch nicht als erstattet abgezogen.</p>}
      {all.reversed > 0 && <p className="mt-3 text-sm text-gray-600">Bestätigte Rückübertragungen: {money(all.reversed)}; bereits in „Auf Stripe-Guthaben übertragen“ abgezogen.</p>}
    </section>
    <section data-testid="earnings-month"><h2 className="mb-3 font-semibold">Dieser Monat · erfasste Zahlungen (Europe/Berlin)</h2>
      {compact ? <p className="text-sm">Bruttoumsatz nach Erstattungen: <strong>{money(month.retained)}</strong> · Coach-Nettoerlös: <strong>{money(month.net)}</strong></p> : <Metrics totals={month} />}
      <p className="mt-2 text-xs text-gray-500">Zuordnung nach Erfassungsdatum der erfolgreichen Zahlung im Ledger; Erstattungen korrigieren die ursprüngliche Transaktion. Keine künftig fälligen Abo-Beträge und kein MRR.</p>
    </section>
    <Link href={compact ? '/creator/earnings' : '/creator/settings/payout'} className="inline-block text-sm text-green-700 underline focus-visible:ring-2">{compact ? 'Einnahmen nach Quelle ansehen' : 'Abrechnungsstatus und Stripe Connect verwalten'} →</Link>
  </div>
}
