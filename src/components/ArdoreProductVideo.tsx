import { ChevronDown } from 'lucide-react'
import ArdoreDemoPlayer from './ArdoreDemoPlayer'

export default function ArdoreProductVideo() {
  return (
    <section
      className="home-dark-band bg-inverse"
      aria-labelledby="home-product-tour-title"
    >
      <div className="ardore-container home-band-space">
        <div className="mb-6 sm:mb-8">
          <h2 id="home-product-tour-title" className="section-title">
            So einfach geht’s
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-inverse sm:text-base">
            In 14 Sekunden siehst du, wie du Coaches, Angebote und Termine findest.
          </p>
        </div>

        <ArdoreDemoPlayer />

        <details className="group mt-3 max-w-3xl text-sm text-muted-inverse">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg font-medium text-ember-on-dark">
            Video nachlesen
            <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-3 pb-2 pt-2 leading-relaxed">
            <p>
              Das Video zeigt die Ardore-Oberfläche. Namen, Angebote, Preise und Termine sind erfundene Beispiele.
            </p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                <span className="font-medium text-on-inverse">Ein Coach-Profil ansehen.</span>{' '}
                Im Beispiel siehst du Lena Hoffmanns Profil. Ihre Schwerpunkte sind Krafttraining und Beweglichkeit.
                Auf dem Bildschirm steht „Dein Ziel. Dein Coach.“
              </li>
              <li>
                <span className="font-medium text-on-inverse">Angebote vergleichen.</span>{' '}
                Die Demo zeigt ein Coaching für 69 Euro und 60 Minuten. Daneben liegt der Trainingsplan
                „Stark im Alltag“ für 29 Euro. Im Kalender ist Montag, der 19. Oktober 2026, um 11 Uhr ausgewählt.
              </li>
              <li>
                <span className="font-medium text-on-inverse">Die Coach-Ansicht kennenlernen.</span>{' '}
                Der Kalender zeigt einen Beispieltermin mit Mia Berger von 11 bis 12 Uhr. Danach siehst du,
                wo Coaches Produkte, Termine, Preise und Sitzungsdauer verwalten. Die Demo speichert und bucht nichts.
              </li>
            </ol>
          </div>
        </details>
      </div>
    </section>
  )
}
