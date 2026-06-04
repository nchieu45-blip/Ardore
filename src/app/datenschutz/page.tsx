import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Datenschutzerklärung',
  description: 'Datenschutzerklärung von Ardore.',
}

export default function DatenschutzPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* Placeholder notice */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-10">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 leading-relaxed">
          <strong>Hinweis:</strong> Dieser Text ist ein Platzhalter und muss vor dem Launch durch rechtssichere Texte ersetzt werden.
        </p>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">Datenschutzerklärung</h1>
      <p className="text-sm text-gray-400 mb-10">Zuletzt aktualisiert: [Datum einfügen]</p>

      <div className="prose-ardore">

        <section>
          <h2>1. Verantwortlicher</h2>
          <p>
            Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br />
            [Name / Firmenname]<br />
            [Straße und Hausnummer]<br />
            [PLZ, Stadt]<br />
            E-Mail: [E-Mail-Adresse]
          </p>
        </section>

        <section>
          <h2>2. Arten der verarbeiteten Daten</h2>
          <p>Wir verarbeiten folgende Kategorien personenbezogener Daten:</p>
          <ul>
            <li>Bestandsdaten (z. B. Name, E-Mail-Adresse)</li>
            <li>Nutzungsdaten (z. B. besuchte Seiten, Zugriffszeiten)</li>
            <li>Zahlungsdaten (über unseren Zahlungsdienstleister Stripe)</li>
            <li>Kommunikationsdaten (z. B. Inhalte von Chat-Nachrichten)</li>
          </ul>
        </section>

        <section>
          <h2>3. Zwecke der Verarbeitung</h2>
          <p>Wir verarbeiten personenbezogene Daten zu folgenden Zwecken:</p>
          <ul>
            <li>Bereitstellung und Betrieb der Plattform</li>
            <li>Durchführung von Kauftransaktionen und Abonnements</li>
            <li>Kommunikation zwischen Käufern und Coaches</li>
            <li>Sicherheit und Betrugsprävention</li>
            <li>Verbesserung unserer Dienste</li>
          </ul>
        </section>

        <section>
          <h2>4. Rechtsgrundlagen der Verarbeitung</h2>
          <p>
            Die Verarbeitung personenbezogener Daten erfolgt auf Grundlage von Art. 6 DSGVO,
            insbesondere aufgrund von Vertragserfüllung (Art. 6 Abs. 1 lit. b), berechtigtem
            Interesse (Art. 6 Abs. 1 lit. f) sowie Einwilligung (Art. 6 Abs. 1 lit. a), soweit
            diese eingeholt wurde.
          </p>
        </section>

        <section>
          <h2>5. Weitergabe von Daten an Dritte</h2>
          <p>
            Wir geben Daten nur weiter, soweit dies zur Vertragserfüllung notwendig ist oder
            eine gesetzliche Verpflichtung besteht. Wir setzen folgende Dienstleister ein:
          </p>
          <ul>
            <li><strong>Supabase</strong> – Datenbankhosting und Authentifizierung</li>
            <li><strong>Stripe</strong> – Zahlungsabwicklung</li>
            <li><strong>Vercel</strong> – Hosting der Webanwendung</li>
          </ul>
          <p>Alle Dienstleister wurden auf Basis eines Auftragsverarbeitungsvertrags (AVV) beauftragt.</p>
        </section>

        <section>
          <h2>6. Cookies</h2>
          <p>
            Diese Website verwendet technisch notwendige Cookies für die Authentifizierung
            und Sitzungsverwaltung. Eine Einwilligung ist für technisch notwendige Cookies
            nicht erforderlich. [Ggf. Hinweis auf weitere Cookies ergänzen.]
          </p>
        </section>

        <section>
          <h2>7. Registrierung und Nutzerkonto</h2>
          <p>
            Zur Nutzung bestimmter Funktionen ist eine Registrierung erforderlich. Die dabei
            erhobenen Daten werden ausschließlich zum Betrieb des Nutzerkontos und zur
            Vertragserfüllung verwendet. Eine Löschung des Kontos ist jederzeit möglich.
          </p>
        </section>

        <section>
          <h2>8. Zahlungsabwicklung</h2>
          <p>
            Zahlungen werden über den Drittanbieter Stripe, Inc. abgewickelt. Ardore
            speichert keine vollständigen Zahlungsdaten. Es gelten die Datenschutzbestimmungen
            von Stripe (<a href="https://stripe.com/de/privacy" target="_blank" rel="noopener noreferrer">stripe.com/de/privacy</a>).
          </p>
        </section>

        <section>
          <h2>9. Speicherdauer</h2>
          <p>
            Personenbezogene Daten werden nur so lange gespeichert, wie es für den jeweiligen
            Verarbeitungszweck erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen
            (z. B. steuerrechtliche Aufbewahrungspflichten von 10 Jahren).
          </p>
        </section>

        <section>
          <h2>10. Rechte der betroffenen Personen</h2>
          <p>Sie haben nach der DSGVO folgende Rechte:</p>
          <ul>
            <li><strong>Auskunftsrecht</strong> (Art. 15 DSGVO)</li>
            <li><strong>Recht auf Berichtigung</strong> (Art. 16 DSGVO)</li>
            <li><strong>Recht auf Löschung</strong> (Art. 17 DSGVO)</li>
            <li><strong>Recht auf Einschränkung der Verarbeitung</strong> (Art. 18 DSGVO)</li>
            <li><strong>Recht auf Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
            <li><strong>Widerspruchsrecht</strong> (Art. 21 DSGVO)</li>
            <li><strong>Recht auf Widerruf einer Einwilligung</strong> (Art. 7 Abs. 3 DSGVO)</li>
          </ul>
          <p>
            Zur Ausübung Ihrer Rechte wenden Sie sich bitte an: [E-Mail-Adresse]
          </p>
        </section>

        <section>
          <h2>11. Beschwerderecht bei der Aufsichtsbehörde</h2>
          <p>
            Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde über die
            Verarbeitung Ihrer Daten zu beschweren. Die zuständige Behörde richtet sich nach
            Ihrem Wohnort.
          </p>
        </section>

        <section>
          <h2>12. Datensicherheit</h2>
          <p>
            Wir setzen technische und organisatorische Maßnahmen ein, um Ihre Daten gegen
            unbefugten Zugriff, Verlust oder Missbrauch zu schützen. Die Übertragung erfolgt
            verschlüsselt über HTTPS/TLS.
          </p>
        </section>

        <section>
          <h2>13. Änderungen dieser Datenschutzerklärung</h2>
          <p>
            Wir behalten uns vor, diese Datenschutzerklärung bei Bedarf anzupassen. Die
            jeweils aktuelle Version ist auf dieser Seite abrufbar. Bei wesentlichen
            Änderungen informieren wir registrierte Nutzer per E-Mail.
          </p>
        </section>

      </div>
    </div>
  )
}
