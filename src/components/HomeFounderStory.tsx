import Image from 'next/image'

export default function HomeFounderStory() {
  return (
    <section aria-labelledby="home-founder-title" className="ardore-container home-band-space grid items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <div>
        <h2 id="home-founder-title" className="section-title">Warum Ardore?</h2>
        <p className="mt-5 max-w-prose text-lg leading-relaxed text-foreground">
          Ich wollte es leichter machen, jemanden zu finden, der dich bei deinem Ziel begleitet. Denn der erste Schritt ist oft schon schwer genug, wenn der Alltag voll ist. Mit Ardore möchte ich dir zeigen, wie unterschiedlich dieser Schritt aussehen kann. Du entscheidest, welche Bewegung und welche Begleitung zu deinem Leben passen.
        </p>
        <p className="mt-4 text-sm text-muted">Platzhalter für die Gründer-Story</p>
      </div>
      <figure>
        <div className="relative aspect-(--story-process-photo-ratio) overflow-hidden rounded-2xl bg-surface-muted">
          <Image
            src="/media/ardore-gruenderstory-platzhalter.webp"
            alt="Hände mit einem Bleistift über einem offenen Notizbuch im Sonnenlicht."
            fill
            sizes="(min-width: 1280px) 630px, (min-width: 768px) 52vw, calc(100vw - 32px)"
            fetchPriority="low"
            className="object-cover"
          />
        </div>
        <figcaption className="mt-2 text-sm text-muted">Platzhalterfoto</figcaption>
      </figure>
    </section>
  )
}
