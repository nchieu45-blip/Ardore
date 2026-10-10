import type { Metadata } from 'next'
import Image from 'next/image'
import { ButtonLink } from '@/components/ui/Button'
import {
  Globe, ArrowRight, Share2, Rocket, CheckCircle2,
  Target, RefreshCw, Zap, BadgePercent,
  TrendingUp, Shield, Users, MessageCircle, Video, Euro, CalendarCheck,
} from 'lucide-react'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'

export const metadata: Metadata = {
  title: 'Für Coaches – Werde Creator',
  description: 'Verkaufe Trainingspläne, Kurse und Ernährungspläne auf Ardore. Starte kostenlos und baue deine Fitness-Community auf.',
  openGraph: {
    title: 'Für Coaches – Ardore',
    description: 'Monetarisiere dein Wissen. Starte kostenlos.',
  },
}


// The existing booking example stays illustrative and has no checkout action.
function BookingExample() {
  return (
    <div className="surface-card w-full max-w-md p-4 sm:p-6">
      <p className="mb-4 text-sm font-medium text-muted">Beispiel einer Buchung</p>
      <div className="border-b border-border pb-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Video className="h-4 w-4 text-foreground" />
          <span className="text-foreground font-bold text-sm">1:1 Videocoaching</span>
        </div>
        <p className="text-foreground text-3xl font-semibold tabular-nums">80,00 €</p>
        <p className="text-muted text-sm">60 Minuten · Erstes Beratungsgespräch</p>
      </div>
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-500 mb-2">Datum wählen</p>
        <div className="grid grid-cols-7 gap-1">
          {['Mo','Di','Mi','Do','Fr','Sa','So'].map((d, i) => (
            <div key={d} className={`text-center text-sm font-medium py-1 rounded-lg ${i === 2 ? 'bg-brand-soft text-brand-dark' : 'text-muted'}`}>{d}</div>
          ))}
          {[' ',' ','9','10','11','12','13'].map((d, i) => (
            <div key={i} className={`text-center text-sm py-2 rounded-lg font-medium ${d === '11' ? 'bg-brand-soft text-brand-dark' : d === ' ' ? '' : 'text-muted'}`}>{d}</div>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-500 mb-2">Uhrzeit</p>
        <div className="grid grid-cols-3 gap-2">
          {['09:00','10:00','11:00','14:00','15:00','16:00'].map((t, i) => (
            <div key={t} className={`text-center text-sm min-h-11 py-2 rounded-xl border font-medium ${i === 2 ? 'bg-brand-soft text-brand-dark border-green-200' : 'border-gray-200 text-gray-600'}`}>{t}</div>
          ))}
        </div>
      </div>
      <div className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-soft text-brand-dark">
        <Video className="h-4 w-4 text-brand" />
        <span className="text-brand-dark text-sm font-semibold">Session für 80,00 € buchen</span>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-w-0">

      <section className="border-b border-border bg-brand-soft">
        <div className="ardore-container grid grid-cols-1 items-center gap-8 py-10 sm:py-16 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <div className="min-w-0">
            <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl xl:text-5xl">
              Bau dein Coaching-Business auf — <span className="text-brand">ohne eigene Website</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Shop, Buchungssystem, Bezahlung und Kundenverwaltung — Ardore übernimmt die Technik, du konzentrierst dich aufs Coaching.
            </p>
            <p className="mt-4 flex items-center gap-2 text-sm text-brand">
              <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
              Für Health Coaches in Deutschland
            </p>
            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/register?role=creator" size="lg">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/" size="lg" variant="secondary">Marktplatz ansehen</ButtonLink>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">Kostenlos registrieren · In 10 Minuten live · Keine Kreditkarte</p>
          </div>
          <figure className="relative aspect-[4/3] w-full min-w-0 overflow-hidden rounded-2xl lg:aspect-[4/5]">
            <Image src="/media/coach-workspace.webp" alt="Illustration mit Notizbuch und Trainingsmaterial auf einem hellen Arbeitsplatz" fill loading="eager" fetchPriority="high" sizes="(min-width: 1280px) 460px, (min-width: 1024px) 38vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)" className="object-cover object-center" />
          </figure>
        </div>
      </section>

      {/* ── Early adopter banner ──────────────────────────────────── */}
      <section className="border-b border-border py-6 sm:py-8">
        <div className="ardore-container">
          <p className="text-green-800 font-semibold text-lg mb-1">Frisch gestartet — werde einer der ersten Coaches</p>
          <p className="text-muted text-sm leading-relaxed">
            Ardore ist im Aufbau. Frühe Coaches profitieren von maximaler Sichtbarkeit, direktem Feedback und einer Plattform, die mit dir wächst.
          </p>
        </div>
      </section>

      {/* ── Two segments ──────────────────────────────────────────── */}
      <section className="section-space bg-surface">
        <div className="ardore-container">
          <div className="mb-8 sm:mb-12">
            <h2 className="section-title mb-3">Ardore passt zu dir — egal wo du stehst</h2>
            <p className="text-muted max-w-xl leading-relaxed">Ob du eine bestehende Community mitbringst oder neu anfängst.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Existing community */}
            <div className="surface-panel p-5 sm:p-8">
              <div className="h-12 w-12 rounded-xl bg-brand flex items-center justify-center mb-5 shadow-md">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground mb-3">Du hast schon eine Community?</h3>
              <p className="text-gray-600 leading-relaxed mb-6">
                Nutze Ardore als zweiten Vertriebskanal. Deine bestehende Community kauft über einen professionellen Marktplatz mit Bewertungen und Vertrauen. Du behältst dein Publikum, gewinnst aber zusätzlich Sichtbarkeit auf Ardore.
              </p>
              <ul className="space-y-2.5">
                {[
                  'Kunden vertrauen einem strukturierten Marktplatz mehr als privaten Nachrichten',
                  'Echte Bewertungen stärken deine Glaubwürdigkeit',
                  'Neue Kunden finden dich über Suche & KI-Finder',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Just starting */}
            <div className="border-t border-border p-5 sm:p-8 md:border-t-0 md:border-l">
              <div className="h-12 w-12 rounded-xl bg-brand flex items-center justify-center mb-5 shadow-md">
                <Rocket className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground mb-3">Du startest gerade erst?</h3>
              <p className="text-gray-600 leading-relaxed mb-6">
                Spar dir tausende Euro für eine eigene Website, Stripe-Integration und Marketing. Auf Ardore bist du in 10 Minuten live und Kunden finden dich automatisch über Suche, Kategorien und unseren KI-Coach-Finder.
              </p>
              <ul className="space-y-2.5">
                {[
                  'Kein technisches Setup nötig',
                  'Stripe-Zahlungen bereits vollständig integriert',
                  'Automatische Sichtbarkeit im Marktplatz',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <CheckCircle2 className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Wie es funktioniert ───────────────────────────────────── */}
      <section className="section-space border-t border-border">
        <div className="ardore-container">
          <div className="mb-8 sm:mb-12">
            <h2 className="section-title mb-3">Wie es funktioniert</h2>
            <p className="text-muted max-w-2xl leading-relaxed">In vier Schritten vom Profil zum ersten Verkauf.</p>
          </div>

          <div className="relative">

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {[
                {
                  step: 1,
                  icon: <Users className="h-5 w-5 text-green-600" />,
                  title: 'Registrieren',
                  desc: 'Kostenlos anmelden — keine Kreditkarte, kein Abo.',
                },
                {
                  step: 2,
                  icon: <Target className="h-5 w-5 text-green-600" />,
                  title: 'Profil einrichten',
                  desc: 'Kategorien, Bio, Foto und Dienstleistungen in 10 Minuten.',
                },
                {
                  step: 3,
                  icon: <Zap className="h-5 w-5 text-green-600" />,
                  title: 'Produkte erstellen',
                  desc: 'PDFs, Videos, Kurse oder Monats-Abos — du entscheidest.',
                },
                {
                  step: 4,
                  icon: <TrendingUp className="h-5 w-5 text-green-600" />,
                  title: 'Verkaufen & wachsen',
                  desc: 'Kunden finden dich über Suche, Filter und KI-Coach-Finder.',
                },
              ].map(s => (
                <div key={s.step} className="border-t border-border pt-6">
                  <div className="relative mb-4 w-fit">
                    <div className="h-12 w-12 rounded-xl bg-brand-soft flex items-center justify-center">
                      {s.icon}
                    </div>
                    <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-green-600 text-white text-xs font-semibold flex items-center justify-center">
                      {s.step}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-1.5">{s.title}</h3>
                  <p className="text-sm text-muted leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-12">
            <ButtonLink href="/register?role=creator" size="lg" className="gap-2">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" />
              </ButtonLink>
          </div>
        </div>
      </section>

      {/* ── Why coaches love Ardore ───────────────────────────────── */}
      <section className="section-space border-t border-border">
        <div className="ardore-container">
          <div className="mb-8 sm:mb-12">
            <h2 className="section-title mb-3">Warum Coaches Ardore lieben</h2>
            <p className="text-muted max-w-2xl leading-relaxed">Die Plattform, die Coaches wirklich brauchen — nicht nur eine weitere Website.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              {
                icon: <Target className="h-5 w-5 text-green-600" />,
                title: 'Zentrale Plattform',
                desc: 'Coaches und Kunden finden zueinander — strukturiert statt durch Zufall. Ein Profil, alle deine Angebote.',
              },
              {
                icon: <RefreshCw className="h-5 w-5 text-green-600" />,
                title: 'Wiederkehrende Einnahmen',
                desc: 'Monats-Abos für direkten Chat-Zugang statt nur Einmal-Verkäufe. Stabil, planbar, skalierbar.',
              },
              {
                icon: <Zap className="h-5 w-5 text-green-600" />,
                title: 'Kein Setup-Aufwand',
                desc: 'Profil in 10 Minuten, sofort verkaufsbereit. Keine Website, kein Stripe-Setup, kein technischer Aufwand.',
              },
              {
                icon: <BadgePercent className="h-5 w-5 text-green-600" />,
                title: 'Faire Gebühren',
                desc: 'Nur 10% pro Verkauf, keine monatlichen Kosten. Du zahlst nur, wenn du verdienst.',
              },
            ].map(reason => (
              <div key={reason.title} className="flex gap-4 border-t border-border pt-6">
                <div className="h-10 w-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  {reason.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{reason.title}</h3>
                  <p className="text-sm text-muted leading-relaxed">{reason.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you can offer ───────────────────────────────────── */}
      <section className="section-space bg-surface border-t border-gray-100">
        <div className="ardore-container">
          <div className="mb-8 sm:mb-12">
            <h2 className="section-title mb-3">Alles, was du als Coach brauchst</h2>
            <p className="text-muted max-w-2xl leading-relaxed">Von der Produkterstellung bis zur Auszahlung — Ardore macht es einfach.</p>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {[
              {
                icon: <Users className="h-6 w-6 text-green-600" />,
                title: 'Abonnements',
                desc: 'Biete Monatsabos an und baue ein stabiles, wiederkehrendes Einkommen auf.',
              },
              {
                icon: <MessageCircle className="h-6 w-6 text-green-600" />,
                title: 'Direkter Chat',
                desc: 'Abonnenten schreiben dir direkt — persönliche Betreuung ohne extra Tools.',
              },
              {
                icon: <TrendingUp className="h-6 w-6 text-green-600" />,
                title: 'Umsatz-Dashboard',
                desc: 'Behalte deinen Umsatz, Abonnenten und Verkäufe jederzeit im Blick.',
              },
              {
                icon: <Shield className="h-6 w-6 text-green-600" />,
                title: 'Sichere Auszahlungen',
                desc: 'Erhalte deine Einnahmen direkt per Stripe Connect auf dein Bankkonto.',
              },
              {
                icon: <RefreshCw className="h-6 w-6 text-green-600" />,
                title: 'Automatische Abrechnung',
                desc: 'Stripe übernimmt alle Zahlungen, Rechnungen und Abo-Verlängerungen.',
              },
              {
                icon: <Target className="h-6 w-6 text-green-600" />,
                title: 'Sichtbarkeit im Marktplatz',
                desc: 'Kunden finden dich über Suche, Kategoriefilter und den KI-Coach-Finder.',
              },
            ].map(feature => (
              <div key={feature.title} className="flex flex-col border-t border-border pt-6">
                <div className="h-11 w-11 bg-brand-soft rounded-xl flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Video coaching upsell ─────────────────────────────────── */}
      <section className="section-space border-t border-border bg-brand-soft">
        <div className="ardore-container">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12">
            <div>
              <h2 className="section-title mb-4 text-balance">
                Biete 1:1 Video-Sessions direkt über dein Profil an
              </h2>
              <p className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand">
                <Video className="h-4 w-4" aria-hidden="true" />
                Neu: 1:1 Videocoaching
              </p>
              <p className="text-gray-600 leading-relaxed mb-6">
                {VIDEO_CALLS_ENABLED
                  ? 'Kunden buchen eine Session, du nimmst sie an — der Videoraum wird automatisch erstellt. Kein externes Tool, keine komplizierte Einrichtung.'
                  : 'Kunden buchen deine Sessions auf Ardore. Du hinterlegst für jeden bestätigten Termin einen privaten Meeting-Link, zum Beispiel für Google Meet, Zoom oder Microsoft Teams.'}
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  { icon: <CalendarCheck className="h-4 w-4 text-brand" />, text: 'Wöchentliche Verfügbarkeit selbst festlegen' },
                  { icon: <Euro className="h-4 w-4 text-brand" />, text: 'Preis und Dauer (30–90 Min.) frei wählbar' },
                  { icon: <Video className="h-4 w-4 text-brand" />, text: VIDEO_CALLS_ENABLED ? 'Videoraum wird automatisch erstellt und per Mail versendet' : 'Privaten Meeting-Link direkt bei der Buchung verwalten' },
                ].map(item => (
                  <li key={item.text} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="h-7 w-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </span>
                    {item.text}
                  </li>
                ))}
              </ul>
              <ButtonLink href="/register?role=creator" className="gap-2">
                  <Video className="h-4 w-4" />
                  Kostenlos starten
                </ButtonLink>
            </div>
            <aside aria-label="Beispiel einer Buchung" className="min-w-0 lg:justify-self-end"><BookingExample /></aside>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section className="section-space border-t border-border bg-surface">



        <div className="relative ardore-container">
          <h2 className="section-title mb-4">Bereit, loszulegen?</h2>
          <p className="text-muted mb-6 text-base max-w-xl leading-relaxed sm:text-lg">
            Erstelle dein Coach-Profil in 10 Minuten und starte dein Coaching-Business noch heute.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <ButtonLink href="/register?role=creator" size="lg" className="w-full sm:w-auto gap-2">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" />
              </ButtonLink>
            <ButtonLink href="/" size="lg" variant="secondary" className="w-full sm:w-auto">
                Marktplatz ansehen
              </ButtonLink>
          </div>
          <p className="text-muted text-sm leading-relaxed">Kostenlos registrieren · In 10 Minuten live · Keine Kreditkarte</p>
        </div>
      </section>

    </div>
  )
}
