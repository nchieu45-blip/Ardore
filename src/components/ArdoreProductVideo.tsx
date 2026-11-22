import { ChevronDown } from 'lucide-react'

// Native playback keeps the authoring/runtime dependencies outside the website.
// No autoplay or loop: reduced-motion and data-saving visitors get the poster
// until they explicitly choose to watch. Controls also work without JavaScript.
export default function ArdoreProductVideo() {
  return (
    <section
      className="section-space border-b border-border"
      aria-labelledby="home-product-tour-title"
    >
      <div className="mb-6 sm:mb-8">
        <h2 id="home-product-tour-title" className="section-title">
          Ein kurzer Blick auf Ardore
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          In 14 Sekunden siehst du, wie du Coaches, Angebote und Termine findest.
        </p>
      </div>

      <figure>
        <div className="overflow-hidden rounded-2xl bg-brand-dark">
          <video
            className="block aspect-video h-auto w-full"
            width={1920}
            height={1080}
            controls
            playsInline
            preload="none"
            poster="/media/ardore-brand-motion-concept-poster.webp"
            aria-label="Ardore-Produktvideo: Coaches, Angebote und Coach-Arbeitsbereich"
            aria-describedby="home-product-tour-caption"
          >
            <source src="/media/ardore-brand-motion-concept.mp4" type="video/mp4" />
            <track
              kind="captions"
              src="/media/ardore-brand-motion-concept.de.vtt"
              srcLang="de"
              label="Deutsch"
            />
            Das Video lässt sich hier gerade nicht abspielen.{' '}
            <a href="/media/ardore-brand-motion-concept.mp4" target="_blank" rel="noopener">
              Öffne das Video in einem eigenen Tab.
            </a>
          </video>
        </div>
        <figcaption
          id="home-product-tour-caption"
          className="mt-3 text-sm leading-relaxed text-muted"
        >
          <strong>Ohne Ton.</strong> Das Video zeigt eine Demo mit erfundenen Beispielen.
        </figcaption>
      </figure>

      <details className="group mt-3 max-w-3xl text-sm text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg font-medium text-brand">
          Video nachlesen
          <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pb-2 pt-2 leading-relaxed">
          <p>
            Das Video zeigt die Ardore-Oberfläche. Namen, Angebote, Preise und Termine sind erfundene Beispiele.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <span className="font-medium text-foreground">Ein Coach-Profil ansehen.</span>{' '}
              Im Beispiel siehst du Lena Hoffmanns Profil. Ihre Schwerpunkte sind Krafttraining und Beweglichkeit.
              Auf dem Bildschirm steht „Dein Ziel. Dein Coach.“
            </li>
            <li>
              <span className="font-medium text-foreground">Angebote vergleichen.</span>{' '}
              Die Demo zeigt ein Coaching für 69 Euro und 60 Minuten. Daneben liegt der Trainingsplan
              „Stark im Alltag“ für 29 Euro. Im Kalender ist Montag, der 19. Oktober 2026, um 11 Uhr ausgewählt.
            </li>
            <li>
              <span className="font-medium text-foreground">Die Coach-Ansicht kennenlernen.</span>{' '}
              Der Kalender zeigt einen Beispieltermin mit Mia Berger von 11 bis 12 Uhr. Danach siehst du,
              wo Coaches Produkte, Termine, Preise und Sitzungsdauer verwalten. Die Demo speichert und bucht nichts.
            </li>
          </ol>
        </div>
      </details>
    </section>
  )
}
