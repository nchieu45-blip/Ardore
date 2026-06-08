'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, ChevronDown, ChevronUp, Users, Flame, ShieldCheck, Mail, HelpCircle } from 'lucide-react'

interface FAQItem {
  q: string
  a: string
}

interface FAQSection {
  title: string
  icon: React.ReactNode
  color: string
  items: FAQItem[]
}

const SECTIONS: FAQSection[] = [
  {
    title: 'Für Kunden',
    icon: <Users className="h-4 w-4" />,
    color: 'text-green-700 bg-green-50 border-green-200',
    items: [
      {
        q: 'Wie kaufe ich ein Produkt?',
        a: 'Stöbere im Marketplace oder auf dem Profil eines Coaches nach digitalen Produkten – z.B. Trainingspläne, Ernährungsguides oder Video-Kurse. Klicke auf „In den Warenkorb", und schließe den Kauf sicher über Stripe ab. Das Produkt erscheint anschließend sofort in deiner Bibliothek unter „Meine Käufe".',
      },
      {
        q: 'Wie funktioniert ein Abo?',
        a: 'Viele Coaches bieten monatliche Mitgliedschaften an. Mit einem Abo erhältst du Zugang zu exklusiven Inhalten des Coaches – und je nach Abo-Stufe sind sogar 1:1-Videocoaching-Sessions inklusive. Du kannst dein Abo jederzeit in deinen Einstellungen kündigen. Die Abrechnung erfolgt monatlich automatisch über Stripe.',
      },
      {
        q: 'Wie buche ich ein 1:1-Videocoaching?',
        a: 'Öffne das Profil des gewünschten Coaches und scrolle zum Bereich „1:1 Videocoaching". Wähle dort einen freien Tag und eine Uhrzeit aus dem Kalender. Fülle dann deine Angaben (Name, E-Mail, optionale Notizen) aus und bestätige die Buchung. Beide Seiten erhalten eine Bestätigungs-E-Mail mit dem Link zum Videoraum. Hast du ein Abo mit inkludierten Sessions, ist die Buchung für dich kostenlos.',
      },
      {
        q: 'Was passiert, wenn ein Coach eine Session absagt?',
        a: 'Du wirst sofort per E-Mail und In-App-Benachrichtigung informiert. War es eine Abo-Session, wird dein Sessionkontingent automatisch wiederhergestellt, sodass du direkt eine neue Zeit buchen kannst. Bei bezahlten Sessions kontaktiere bitte den Coach oder den Ardore-Support.',
      },
      {
        q: 'Wie funktioniert die Bezahlung?',
        a: 'Alle Zahlungen für Produkte und Abonnements werden sicher über Stripe abgewickelt – du kannst mit Kreditkarte, SEPA-Lastschrift oder anderen gängigen Zahlungsmethoden bezahlen. Ardore speichert keine Kartendaten; das übernimmt Stripe vollständig verschlüsselt. Nach jedem Kauf erhältst du eine Kaufbestätigung per E-Mail.',
      },
      {
        q: 'Kann ich eine Buchung verschieben oder stornieren?',
        a: 'Ja – in deinem Bereich „Meine Sessions" findest du bei jeder bevorstehenden Session die Schaltflächen „Verschieben" und „Stornieren". Wähle beim Verschieben einfach einen neuen Termin aus dem Kalender; beide Parteien erhalten automatisch eine Benachrichtigung. Beachte dabei die Stornierungsfrist des Coaches (üblicherweise 24 Stunden vor dem Termin). Innerhalb dieser Frist ist eine kostenlose Stornierung nicht mehr möglich.',
      },
    ],
  },
  {
    title: 'Für Coaches',
    icon: <Flame className="h-4 w-4" />,
    color: 'text-orange-700 bg-orange-50 border-orange-200',
    items: [
      {
        q: 'Wie werde ich Coach auf Ardore?',
        a: 'Registriere dich kostenlos unter „Für Coaches" und wähle beim Anlegen deines Kontos die Rolle „Coach". Im Anschluss führt dich das Onboarding durch die Einrichtung deines Profils: Profilbild, Beschreibung, Kategorien und Spezialisierungen. Sobald dein Profil vollständig ist, erscheinst du in der Coach-Übersicht und kannst Produkte sowie Videocoaching anbieten.',
      },
      {
        q: 'Wie lege ich Produkte an?',
        a: 'Gehe in deinem Dashboard auf „Produkte" → „Neues Produkt". Du kannst digitale Inhalte wie PDFs, Videos, Workouts oder Ernährungspläne hochladen, einen Preis festlegen und das Produkt mit einer Beschreibung versehen. Sobald du es veröffentlichst, ist es im Marketplace und auf deinem Profil sichtbar und direkt kaufbar.',
      },
      {
        q: 'Wie biete ich 1:1-Coaching an?',
        a: 'Aktiviere Videocoaching unter Einstellungen → Videocoaching. Dort legst du Preis, Sitzungsdauer (30–90 Min.), Pufferzeit, Buchungsvorlaufzeit und deine wöchentliche Verfügbarkeit fest. Du kannst auch einzelne Tage als Ausnahme blockieren oder freigeben. Die Sessions finden per verschlüsseltem Video über Daily.co statt – kein separates Tool nötig.',
      },
      {
        q: 'Wie funktionieren Auszahlungen?',
        a: 'Ardore nutzt Stripe Connect für Auszahlungen. Verbinde dein Bankkonto in den Einstellungen mit deinem Stripe-Konto. Einnahmen aus Produktverkäufen und Abonnements werden nach Abzug der Plattformprovision auf dein Konto überwiesen. Die Auszahlungsfrequenz richtet sich nach deinen Stripe-Einstellungen (typisch: wöchentlich oder monatlich).',
      },
      {
        q: 'Welche Gebühren fallen an?',
        a: 'Ardore erhebt eine Provision von 10 % auf jeden Produktverkauf und jede Abo-Zahlung. Hinzu kommen die Stripe-Transaktionsgebühren (ca. 1,4 % + 0,25 € für EU-Karten). Die Registrierung und das Bereitstellen von Inhalten sind kostenlos – du zahlst nur dann, wenn du auch verdienst.',
      },
    ],
  },
  {
    title: 'Konto & Sicherheit',
    icon: <ShieldCheck className="h-4 w-4" />,
    color: 'text-blue-700 bg-blue-50 border-blue-200',
    items: [
      {
        q: 'Wie ändere ich mein Passwort?',
        a: 'Gehe in deinen Einstellungen (oben rechts → dein Name → Einstellungen) auf den Bereich „Passwort ändern". Du kannst dort ein neues Passwort festlegen. Alternativ kannst du auf der Anmeldeseite „Passwort vergessen" klicken und erhältst einen sicheren Reset-Link per E-Mail.',
      },
      {
        q: 'Wie lösche ich mein Konto?',
        a: 'Dein Konto kannst du in den Einstellungen unter „Konto löschen" dauerhaft entfernen. Bitte beachte: Alle deine Daten, Produkte und Buchungen werden unwiderruflich gelöscht. Aktive Abonnements werden automatisch beendet und deine Kunden erhalten eine Benachrichtigung.',
      },
      {
        q: 'Wie werden meine Daten geschützt?',
        a: 'Ardore verarbeitet deine Daten gemäß der DSGVO. Alle Daten werden auf europäischen Servern gespeichert und verschlüsselt übertragen (HTTPS/TLS). Wir geben deine Daten nicht ohne deine ausdrückliche Einwilligung an Dritte weiter. Details findest du in unserer Datenschutzerklärung. Du kannst jederzeit Auskunft über deine gespeicherten Daten anfordern oder deren Löschung verlangen.',
      },
    ],
  },
]

export default function FaqContent() {
  const [query,    setQuery]   = useState('')
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(
        item => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
      ),
    })).filter(section => section.items.length > 0)
  }, [query])

  const totalVisible = filtered.reduce((sum, s) => sum + s.items.length, 0)

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-green-600 shadow-sm mb-4">
          <HelpCircle className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Hilfe & FAQ</h1>
        <p className="text-gray-500 text-sm">Antworten auf die häufigsten Fragen rund um Ardore.</p>
      </div>

      {/* Search */}
      <div className="relative mb-8">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Frage suchen…"
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 transition-shadow shadow-sm"
        />
      </div>

      {/* No results */}
      {query && totalVisible === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Keine Ergebnisse für „{query}". Versuche einen anderen Suchbegriff.
        </div>
      )}

      {/* Sections */}
      <div className="space-y-6">
        {filtered.map(section => (
          <div key={section.title}>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border mb-3 ${section.color}`}>
              {section.icon}
              {section.title}
            </div>
            <div className="space-y-2">
              {section.items.map(item => {
                const key = `${section.title}::${item.q}`
                const isOpen = openKeys.has(key)
                return (
                  <div key={item.q} className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
                    <button
                      onClick={() => toggle(key)}
                      className="w-full flex items-start justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-sm font-semibold text-gray-900 leading-snug">{item.q}</span>
                      {isOpen
                        ? <ChevronUp   className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                        : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />}
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Contact section */}
      <div className="mt-12 rounded-2xl border border-gray-100 bg-white shadow-sm p-6 text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 mb-3">
          <Mail className="h-5 w-5 text-green-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Noch Fragen?</h2>
        <p className="text-sm text-gray-500 mb-3">
          Wir helfen dir gerne weiter – schreib uns einfach eine E-Mail.
        </p>
        <a
          href="mailto:ardore.health@gmail.com"
          className="inline-flex items-center gap-2 text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
        >
          ardore.health@gmail.com →
        </a>
        <p className="text-xs text-gray-400 mt-3">
          Oder besuche unsere{' '}
          <Link href="/datenschutz" className="text-green-600 hover:text-green-700 underline underline-offset-2">
            Datenschutzerklärung
          </Link>{' '}
          und{' '}
          <Link href="/agb" className="text-green-600 hover:text-green-700 underline underline-offset-2">
            AGB
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
