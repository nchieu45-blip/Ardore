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
          Ardore in 14 Sekunden.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Coaches entdecken, Angebote kennenlernen, Coaching organisieren.
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
            poster="/media/ardore-brand-motion-concept-poster.png"
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
            Dein Browser unterstützt die Videowiedergabe nicht.{' '}
            <a href="/media/ardore-brand-motion-concept.mp4">Video separat öffnen</a>.
          </video>
        </div>
        <figcaption
          id="home-product-tour-caption"
          className="mt-3 text-sm leading-relaxed text-muted"
        >
          14 Sekunden, ohne Ton. Produktdemo mit fiktiven Beispieldaten;
          es wird keine Buchung oder Zahlung ausgeführt.
        </figcaption>
      </figure>

      <details className="group mt-3 max-w-3xl text-sm text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg font-medium text-brand">
          Videoinhalt als Text
          <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 pb-2 pt-2 leading-relaxed">
          <p>
            Die stille, animierte Produktdemo zeigt beispielhafte Elemente der
            Ardore-Oberfläche. Alle Personen, Produkte, Preise und Termine sind
            fiktive Demodaten.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <span className="font-medium text-foreground">Den passenden Coach entdecken:</span>{' '}
              Lena Hoffmanns Demo-Profil zeigt die Schwerpunkte Krafttraining und
              Beweglichkeit. Die Botschaft lautet: „Dein Ziel. Dein Coach.“
            </li>
            <li>
              <span className="font-medium text-foreground">Coaching und Wissen finden:</span>{' '}
              Eine persönliche Coaching-Session wird beispielhaft mit 69 Euro für
              60 Minuten vorgestellt. Daneben steht das digitale PDF-Produkt
              „Stark im Alltag“ für 29 Euro. Anschließend erscheinen freie Tage
              im Oktober 2026 und die Uhrzeit 11:00 für Montag, den 19. Oktober.
            </li>
            <li>
              <span className="font-medium text-foreground">Coaching professionell verwalten:</span>{' '}
              Die Darstellung geht in den Arbeitsbereich des Coaches über. Der
              Kalender zeigt einen bestehenden Demo-Termin mit Mia Berger von
              11:00 bis 12:00. Navigation zu Kalender, Produkten und 1:1 Coaching
              sowie Einstellungen für Session-Preis und Sitzungsdauer werden
              sichtbar. Dieser Demo-Termin bestätigt keine tatsächlich
              ausgeführte Buchung; es werden keine Einstellungen gespeichert.
            </li>
          </ol>
        </div>
      </details>
    </section>
  )
}
