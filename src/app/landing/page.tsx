import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Flame, BookOpen, Video, FileText, Star, Users, TrendingUp, Shield } from 'lucide-react'
import CoachFinderWidget from '@/components/CoachFinderWidget'

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="bg-gradient-to-br from-green-50 to-white py-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Flame className="h-4 w-4" />
            Die Nr. 1 Plattform für Health Coaches in Deutschland
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
            Dein Wissen.
            <span className="text-green-600"> Deine Community.</span>
            <br />Dein Erfolg.
          </h1>
          <p className="text-lg md:text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            Ardore verbindet Fitness-, Ernährungs- und Gesundheitscoaches mit ihren Kunden.
            Verkaufe Kurse, PDFs und Videos – oder abonniere deine Lieblingscoaches.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register?role=creator">
              <Button size="lg" className="w-full sm:w-auto">
                Als Coach starten
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Marketplace entdecken
              </Button>
            </Link>
          </div>
          <div className="mt-4 flex justify-center">
            <CoachFinderWidget />
          </div>
          <p className="text-sm text-gray-500 mt-3">Kostenlos registrieren • Keine Kreditkarte erforderlich</p>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-gray-200 bg-white py-10 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '500+', label: 'Aktive Coaches' },
            { value: '10.000+', label: 'Zufriedene Kunden' },
            { value: '50.000€+', label: 'Ausgezahlt' },
            { value: '98%', label: 'Kundenzufriedenheit' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-green-600">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For Creators */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Alles, was du als Coach brauchst</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Von der Produkterstellung bis zur Auszahlung – Ardore macht es einfach.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: <FileText className="h-6 w-6 text-green-600" />,
                title: 'PDFs & Guides',
                desc: 'Lade Ernährungspläne, Trainingsprogramme und Guides hoch und verkaufe sie direkt.',
              },
              {
                icon: <Video className="h-6 w-6 text-green-600" />,
                title: 'Video-Kurse',
                desc: 'Erstelle komplette Videokurse mit mehreren Lektionen für deine Community.',
              },
              {
                icon: <Users className="h-6 w-6 text-green-600" />,
                title: 'Abonnements',
                desc: 'Biete Monatsabos an und baue ein stabiles, wiederkehrendes Einkommen auf.',
              },
              {
                icon: <TrendingUp className="h-6 w-6 text-green-600" />,
                title: 'Umsatz-Dashboard',
                desc: 'Behalte deinen Umsatz, Abonnenten und Verkäufe immer im Blick.',
              },
              {
                icon: <Shield className="h-6 w-6 text-green-600" />,
                title: 'Sichere Auszahlungen',
                desc: 'Erhalte deine Einnahmen direkt per Stripe Connect auf dein Bankkonto.',
              },
              {
                icon: <Star className="h-6 w-6 text-green-600" />,
                title: 'Chat mit Abonnenten',
                desc: 'Kommuniziere direkt mit deinen Abonnenten und baue echte Beziehungen auf.',
              },
            ].map((feature) => (
              <Card key={feature.title} className="p-6">
                <div className="h-12 w-12 bg-green-50 rounded-xl flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.desc}</p>
              </Card>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/register?role=creator">
              <Button size="lg">Jetzt als Coach registrieren</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* For Customers */}
      <section className="py-20 px-4 bg-green-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">
                Für Kunden, die das Beste wollen
              </h2>
              <ul className="space-y-4">
                {[
                  'Entdecke die besten Fitness- und Gesundheitscoaches',
                  'Kaufe Premium-Inhalte einmalig oder im Abo',
                  'Chatte direkt mit deinen Coaches',
                  'Alle deine Käufe übersichtlich in einem Dashboard',
                  'Sichere Zahlung mit Stripe',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <div className="h-5 w-5 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M3.707 5.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 00-1.414-1.414L5 6.586 3.707 5.293z" />
                      </svg>
                    </div>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/register">
                  <Button size="lg" variant="outline">Kostenlos registrieren</Button>
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: <BookOpen className="h-8 w-8 text-green-600" />, label: 'Online-Kurse' },
                { icon: <FileText className="h-8 w-8 text-green-600" />, label: 'PDF-Guides' },
                { icon: <Video className="h-8 w-8 text-green-600" />, label: 'Video-Inhalte' },
                { icon: <Users className="h-8 w-8 text-green-600" />, label: 'Community' },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-xl p-6 text-center shadow-sm border border-green-100">
                  <div className="flex justify-center mb-3">{item.icon}</div>
                  <p className="font-medium text-gray-800">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 bg-green-600 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Bereit loszulegen?</h2>
          <p className="text-green-100 mb-8 text-lg">
            Registriere dich jetzt kostenlos und starte deine Journey – als Coach oder als Kunde.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register?role=creator">
              <Button size="lg" className="bg-white text-green-700 hover:bg-green-50 w-full sm:w-auto">
                Coach werden
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" className="bg-green-700 text-white hover:bg-green-800 border border-green-500 w-full sm:w-auto">
                Als Kunde registrieren
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
