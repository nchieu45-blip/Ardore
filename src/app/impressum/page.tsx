import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Impressum von Ardore gemäß § 5 TMG.',
}

export default function ImpressumPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* Placeholder notice */}
      <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-10">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 leading-relaxed">
          <strong>Hinweis:</strong> Dieser Text ist ein Platzhalter und muss vor dem Launch durch rechtssichere Texte ersetzt werden.
        </p>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">Impressum</h1>
      <p className="text-sm text-gray-400 mb-10">Angaben gemäß § 5 TMG</p>

      <div className="prose-ardore">

        <section>
          <h2>Anbieter</h2>
          <p>
            [Vor- und Nachname oder Firmenname]<br />
            [Straße und Hausnummer]<br />
            [PLZ] [Stadt]<br />
            Deutschland
          </p>
        </section>

        <section>
          <h2>Kontakt</h2>
          <p>
            Telefon: [Telefonnummer]<br />
            E-Mail: [E-Mail-Adresse]
          </p>
        </section>

        <section>
          <h2>Umsatzsteuer-Identifikationsnummer</h2>
          <p>
            Gemäß § 27a Umsatzsteuergesetz:<br />
            USt-IdNr.: [USt-IdNr. einfügen]
          </p>
          <p><em>Falls keine USt-IdNr. vorhanden: Steuernummer [Steuernummer] beim Finanzamt [Finanzamt].</em></p>
        </section>

        <section>
          <h2>Handelsregistereintrag</h2>
          <p>
            [Falls zutreffend:]<br />
            Registergericht: Amtsgericht [Stadt]<br />
            Registernummer: HRB [Nummer]
          </p>
          <p><em>Falls Einzelunternehmen oder Freiberufler: diesen Abschnitt entfernen.</em></p>
        </section>

        <section>
          <h2>Vertretungsberechtigte Person</h2>
          <p>
            Geschäftsführer: [Name]
          </p>
        </section>

        <section>
          <h2>Redaktionell verantwortlich</h2>
          <p>
            [Vor- und Nachname]<br />
            [Anschrift wie oben]
          </p>
        </section>

        <section>
          <h2>EU-Streitschlichtung</h2>
          <p>
            Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
            (OS) bereit:{' '}
            <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
              https://ec.europa.eu/consumers/odr/
            </a>
            .<br />
            Unsere E-Mail-Adresse finden Sie oben im Impressum.
          </p>
        </section>

        <section>
          <h2>Verbraucherstreitbeilegung / Universalschlichtungsstelle</h2>
          <p>
            Wir sind nicht verpflichtet und nicht bereit, an einem
            Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            teilzunehmen.
          </p>
        </section>

        <section>
          <h2>Haftung für Inhalte</h2>
          <p>
            Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf
            diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10
            TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder
            gespeicherte fremde Informationen zu überwachen.
          </p>
        </section>

        <section>
          <h2>Haftung für Links</h2>
          <p>
            Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte
            wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch
            keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der
            jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
          </p>
        </section>

        <section>
          <h2>Urheberrecht</h2>
          <p>
            Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten
            unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung,
            Verbreitung und jede Art der Verwertung außerhalb der Grenzen des
            Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors
            bzw. Erstellers.
          </p>
        </section>

      </div>
    </div>
  )
}
