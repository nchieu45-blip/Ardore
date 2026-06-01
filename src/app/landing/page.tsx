import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import {
  Globe, ArrowRight, Share2, Rocket, CheckCircle2,
  Target, RefreshCw, Zap, BadgePercent,
  TrendingUp, Shield, Users, MessageCircle,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="flex flex-col">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-green-800 py-24 px-4">
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-green-100 text-xs font-medium px-3.5 py-1.5 rounded-full border border-white/20 mb-6">
            <Globe className="h-3.5 w-3.5" />
            Für Health Coaches in Deutschland
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight tracking-tight">
            Dein zusätzlicher<br className="hidden md:block" /> Verkaufskanal —
            <span className="text-green-300"> ohne eigene Website</span>
          </h1>

          <p className="text-green-100/80 text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
            Egal ob du schon auf Instagram, TikTok oder Udemy verkaufst — Ardore ist dein zentraler Marktplatz für Health Coaches in Deutschland.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-5">
            <Link href="/register?role=creator">
              <Button size="lg" className="bg-white text-green-800 hover:bg-green-50 w-full sm:w-auto gap-2 font-semibold shadow-lg">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 w-full sm:w-auto">
                Marktplatz ansehen
              </Button>
            </Link>
          </div>

          <p className="text-green-200/50 text-sm">Kostenlos registrieren · In 10 Minuten live · Keine Kreditkarte</p>
        </div>
      </section>

      {/* ── Early adopter banner ──────────────────────────────────── */}
      <section className="border-b border-green-100 bg-green-50 py-8 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-green-800 font-semibold text-lg mb-1">Frisch gestartet — werde einer der ersten Coaches</p>
          <p className="text-green-700/70 text-sm leading-relaxed">
            Ardore ist im Aufbau. Frühe Coaches profitieren von maximaler Sichtbarkeit, direktem Feedback und einer Plattform, die mit dir wächst.
          </p>
        </div>
      </section>

      {/* ── Two segments ──────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Ardore passt zu dir — egal wo du stehst</h2>
            <p className="text-gray-500 max-w-xl mx-auto">Ob du eine bestehende Community mitbringst oder neu anfängst.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Existing community */}
            <div className="rounded-3xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 p-8">
              <div className="h-12 w-12 rounded-2xl bg-green-600 flex items-center justify-center mb-5 shadow-md">
                <Share2 className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Du hast schon eine Community?</h3>
              <p className="text-gray-600 leading-relaxed mb-6">
                Nutze Ardore als zweiten Vertriebskanal. Deine Instagram-Follower kaufen über einen professionellen Marktplatz mit Bewertungen und Vertrauen. Du behältst deine Community, gewinnst aber zusätzlich Sichtbarkeit auf Ardore.
              </p>
              <ul className="space-y-2.5">
                {[
                  'Kunden vertrauen verifizierten Marktplätzen mehr als DMs',
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
            <div className="rounded-3xl bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 p-8">
              <div className="h-12 w-12 rounded-2xl bg-gray-900 flex items-center justify-center mb-5 shadow-md">
                <Rocket className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Du startest gerade erst?</h3>
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
      <section className="py-20 px-4 bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Wie es funktioniert</h2>
            <p className="text-gray-500 max-w-lg mx-auto">In vier Schritten vom Profil zum ersten Verkauf.</p>
          </div>

          <div className="relative">
            {/* Connecting line (desktop) */}
            <div className="hidden md:block absolute top-8 left-[calc(12.5%+1rem)] right-[calc(12.5%+1rem)] h-0.5 bg-gradient-to-r from-green-200 via-green-400 to-green-200" />

            <div className="grid md:grid-cols-4 gap-8">
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
                <div key={s.step} className="flex flex-col items-center text-center">
                  <div className="relative mb-5">
                    <div className="h-16 w-16 rounded-2xl bg-white border-2 border-green-200 flex items-center justify-center shadow-sm">
                      {s.icon}
                    </div>
                    <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {s.step}
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1.5">{s.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-12">
            <Link href="/register?role=creator">
              <Button size="lg" className="gap-2">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Why coaches love Ardore ───────────────────────────────── */}
      <section className="py-20 px-4 bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Warum Coaches Ardore lieben</h2>
            <p className="text-gray-500 max-w-lg mx-auto">Die Plattform, die Coaches wirklich brauchen — nicht nur eine weitere Website.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {[
              {
                icon: <Target className="h-5 w-5 text-green-600" />,
                title: 'Zentrale Plattform',
                desc: 'Coaches und Kunden finden zueinander statt durch Zufall auf Instagram. Ein Profil, alle deine Angebote.',
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
              <div key={reason.title} className="bg-white rounded-2xl p-6 border border-gray-100 flex gap-4 hover:shadow-md transition-shadow duration-200">
                <div className="h-10 w-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  {reason.icon}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">{reason.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{reason.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you can offer ───────────────────────────────────── */}
      <section className="py-20 px-4 bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Alles, was du als Coach brauchst</h2>
            <p className="text-gray-500 max-w-lg mx-auto">Von der Produkterstellung bis zur Auszahlung — Ardore macht es einfach.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
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
              <div key={feature.title} className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <div className="h-11 w-11 bg-green-50 rounded-xl flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 px-4 bg-gradient-to-br from-green-950 via-green-900 to-green-800 text-white">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">Bereit, loszulegen?</h2>
          <p className="text-green-100/80 mb-10 text-lg max-w-xl mx-auto leading-relaxed">
            Erstelle dein Coach-Profil in 10 Minuten und starte deinen zweiten Verkaufskanal noch heute.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-5">
            <Link href="/register?role=creator">
              <Button size="lg" className="bg-white text-green-800 hover:bg-green-50 w-full sm:w-auto gap-2 font-semibold shadow-lg">
                Jetzt kostenlos starten <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" className="bg-green-700 text-white hover:bg-green-800 border border-green-600 w-full sm:w-auto">
                Marktplatz ansehen
              </Button>
            </Link>
          </div>
          <p className="text-green-200/50 text-sm">Kostenlos registrieren · In 10 Minuten live · Keine Kreditkarte</p>
        </div>
      </section>

    </div>
  )
}
