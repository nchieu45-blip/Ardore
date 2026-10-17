import Image from 'next/image'
import { ArrowDown, BookOpen, Check, Search, UserRound } from 'lucide-react'

// These abstract scenes explain the journey without imitating live inventory,
// availability, prices, or purchase confirmation. The real copy stays in the list.
function ProcessScene({ stage }: { stage: 'discover' | 'choose' | 'start' }) {
  return (
    <div className="coaching-process-scene" aria-hidden="true">
      {stage === 'discover' && (
        <div className="coaching-process-searchScene">
          <div className="coaching-process-searchBar">
            <Search size={16} />
            <span />
          </div>
          <div className="coaching-process-searchResult"><UserRound size={18} /><span /></div>
          <div className="coaching-process-searchResult"><BookOpen size={18} /><span /></div>
        </div>
      )}
      {stage === 'choose' && (
        <div className="coaching-process-profileScene">
          <UserRound className="coaching-process-profileIcon" size={30} />
          <div className="coaching-process-profileLines"><span /><span /></div>
          <span className="coaching-process-selection"><Check size={16} /></span>
        </div>
      )}
      {stage === 'start' && (
        <div className="coaching-process-calendarScene">
          <div className="coaching-process-calendarTop"><span /><span /></div>
          <div className="coaching-process-calendarDays">
            {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
          </div>
          <span className="coaching-process-library"><BookOpen size={22} /></span>
        </div>
      )}
    </div>
  )
}

const steps = [
  {
    stage: 'discover',
    title: 'Entdecken',
    text: 'Suche nach deinem Ziel und vergleiche Coaches oder Produkte.',
  },
  {
    stage: 'choose',
    title: 'Auswählen',
    text: 'Lies Profil und Angebot. Prüfe Preis, Format und Voraussetzungen.',
  },
  {
    stage: 'start',
    title: 'Loslegen',
    text: 'Buche deine Session oder kaufe einen Inhalt und finde alles in deinem Konto.',
  },
] as const

export default function CoachingProcess() {
  return (
    <section className="section-space" aria-labelledby="how-title">
      <h2 id="how-title" className="section-title mb-6 sm:mb-8">
        So funktioniert Ardore
      </h2>
      <div className="coaching-process-layout">
        <figure className="coaching-process-photo">
          <Image
            src="/media/coach-workspace.webp"
            alt="Grüne Yogamatte, Trainingsband und ein offenes Notizbuch im Tageslicht."
            fill
            sizes="(min-width: 1280px) 390px, (min-width: 1024px) 32vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
            className="coaching-process-photoImage"
          />
        </figure>
        <ol role="list" className="coaching-process-steps">
          {steps.map(({ stage, title, text }, i) => (
            <li key={stage} className="coaching-process-step">
              <div className="coaching-process-visual">
                <ProcessScene stage={stage} />
                {i < steps.length - 1 && (
                  <span className="coaching-process-connector" aria-hidden="true"><ArrowDown size={16} /></span>
                )}
              </div>
              <div className="coaching-process-copy">
                <h3 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h3>
                <p className="mt-2 max-w-lg text-base leading-relaxed text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
