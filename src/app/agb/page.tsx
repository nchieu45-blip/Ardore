import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'AGB',
  description: 'Allgemeine Geschäftsbedingungen von Ardore.',
}

export default function AgbPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* Placeholder notice */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-10">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 leading-relaxed">
          <strong>Hinweis:</strong> Dieser Text ist ein Platzhalter und muss vor dem Launch durch rechtssichere Texte ersetzt werden.
        </p>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">Allgemeine Geschäftsbedingungen (AGB)</h1>
      <p className="text-sm text-gray-400 mb-10">Stand: [Datum einfügen]</p>

      <div className="prose-ardore">

        <section>
          <h2>§ 1 Geltungsbereich</h2>
          <p>
            Diese Allgemeinen Geschäftsbedingungen gelten für alle Verträge, die zwischen
            [Firmenname] (nachfolgend „Ardore") und den Nutzern (Käufer und Creator) über
            die Plattform ardore-health.com geschlossen werden. Abweichende Bedingungen des Nutzers
            werden nicht anerkannt.
          </p>
        </section>

        <section>
          <h2>§ 2 Vertragspartner und Plattformmodell</h2>
          <p>
            Ardore betreibt eine Plattform, über die Creators (Coaches) digitale Produkte
            und Abonnements an Käufer anbieten können. Ardore tritt dabei als technischer
            Dienstleister auf. Kaufverträge kommen zwischen dem jeweiligen Creator und dem
            Käufer zustande; Ardore ist nicht Vertragspartei dieser Käufe.
          </p>
          <p>[Ggf. Merchant-of-Record-Modell oder abweichendes Modell beschreiben.]</p>
        </section>

        <section>
          <h2>§ 3 Registrierung und Nutzerkonto</h2>
          <p>
            Die Nutzung bestimmter Funktionen setzt eine Registrierung voraus. Die Angabe
            wahrheitsgemäßer und vollständiger Daten ist Pflicht. Nutzer sind verpflichtet,
            ihre Zugangsdaten sicher zu verwahren. Ein Anspruch auf Registrierung besteht
            nicht.
          </p>
        </section>

        <section>
          <h2>§ 4 Leistungen für Creators</h2>
          <p>Creators können auf der Plattform:</p>
          <ul>
            <li>Digitale Produkte (PDF, Video, Kurs, Bild) zum Verkauf anbieten</li>
            <li>Abonnement-Stufen mit monatlichem Preis erstellen</li>
            <li>Mit Käufern über die Chat-Funktion kommunizieren</li>
          </ul>
          <p>
            Ardore behält sich vor, Inhalte zu entfernen, die gegen diese AGB oder geltendes
            Recht verstoßen.
          </p>
        </section>

        <section>
          <h2>§ 5 Leistungen für Käufer</h2>
          <p>Käufer können über die Plattform:</p>
          <ul>
            <li>Digitale Produkte von Creators erwerben</li>
            <li>Abonnements bei Creators abschließen</li>
            <li>Erworbene Inhalte in ihrer Bibliothek abrufen</li>
          </ul>
        </section>

        <section>
          <h2>§ 6 Vertragsschluss und Bestellung</h2>
          <p>
            Mit dem Klick auf „Jetzt kaufen" bzw. „Abonnieren" gibt der Käufer ein
            verbindliches Kaufangebot ab. Der Vertrag kommt mit der Kaufbestätigung per
            E-Mail oder der Freischaltung des Inhalts zustande.
          </p>
        </section>

        <section>
          <h2>§ 7 Preise und Zahlungsbedingungen</h2>
          <p>
            Alle angegebenen Preise sind Endpreise in Euro (€) und verstehen sich
            einschließlich der gesetzlichen Mehrwertsteuer, sofern nicht anders angegeben.
            Die Zahlung erfolgt über den Zahlungsdienstleister Stripe. Akzeptierte
            Zahlungsmittel: [Kreditkarte, SEPA-Lastschrift etc. einfügen].
          </p>
        </section>

        <section>
          <h2>§ 8 Widerrufsrecht</h2>
          <p>
            Verbrauchern steht grundsätzlich ein 14-tägiges Widerrufsrecht zu. Bei digitalen
            Inhalten, die sofort nach dem Kauf bereitgestellt werden, erlischt das
            Widerrufsrecht mit Beginn der Ausführung, sofern der Verbraucher ausdrücklich
            zugestimmt hat und zur Kenntnis genommen hat, dass er sein Widerrufsrecht
            verliert (§ 356 Abs. 5 BGB).
          </p>
          <p>[Vollständige Widerrufsbelehrung und Widerrufsformular hier einfügen.]</p>
        </section>

        <section>
          <h2>§ 9 Bereitstellung digitaler Inhalte</h2>
          <p>
            Nach erfolgreichem Zahlungseingang werden digitale Inhalte unmittelbar in der
            Bibliothek des Käufers bereitgestellt. Ein Anspruch auf physische Lieferung
            besteht nicht.
          </p>
        </section>

        <section>
          <h2>§ 10 Nutzungsrechte an digitalen Inhalten</h2>
          <p>
            Der Käufer erhält ein einfaches, nicht übertragbares Nutzungsrecht für den
            erworbenen Inhalt ausschließlich zur privaten Nutzung. Eine Weitergabe,
            Vervielfältigung oder Veröffentlichung ist untersagt.
          </p>
        </section>

        <section>
          <h2>§ 11 Pflichten der Creator</h2>
          <p>Creators versichern, dass ihre angebotenen Inhalte:</p>
          <ul>
            <li>keine Rechte Dritter verletzen</li>
            <li>keine rechtswidrigen, diskriminierenden oder irreführenden Inhalte enthalten</li>
            <li>den beschriebenen Leistungen entsprechen</li>
          </ul>
          <p>
            Ardore behält sich eine Provision von [X] % auf jeden Verkauf vor.
            [Genaue Provision einfügen.]
          </p>
        </section>

        <section>
          <h2>§ 12 Haftungsbeschränkung</h2>
          <p>
            Ardore haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für
            Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit. Im
            Übrigen ist die Haftung auf vorhersehbare, vertragstypische Schäden begrenzt.
            Für Inhalte der Creators übernimmt Ardore keine Haftung.
          </p>
        </section>

        <section>
          <h2>§ 13 Sperrung und Kündigung</h2>
          <p>
            Ardore ist berechtigt, Nutzerkonten bei Verstößen gegen diese AGB oder bei
            berechtigtem Verdacht auf Rechtsverletzungen vorübergehend zu sperren oder
            dauerhaft zu löschen. Nutzer können ihr Konto jederzeit in den Einstellungen
            löschen.
          </p>
        </section>

        <section>
          <h2>§ 14 Änderungen der AGB</h2>
          <p>
            Ardore behält sich vor, diese AGB mit angemessener Ankündigungsfrist zu ändern.
            Registrierte Nutzer werden per E-Mail informiert. Widerspricht ein Nutzer nicht
            innerhalb von 4 Wochen, gelten die neuen AGB als akzeptiert.
          </p>
        </section>

        <section>
          <h2>§ 15 Streitbeilegung</h2>
          <p>
            Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
            bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.
            Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren
            vor einer Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </section>

        <section>
          <h2>§ 16 Anwendbares Recht und Gerichtsstand</h2>
          <p>
            Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.
            Gerichtsstand für Kaufleute und juristische Personen ist [Ort des Firmensitzes].
          </p>
        </section>

      </div>
    </div>
  )
}
