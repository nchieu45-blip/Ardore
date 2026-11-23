import Image from 'next/image'
import Reveal from '@/components/motion/Reveal'
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
    title: 'Stöbere nach deinem Ziel',
    text: 'Entdecke Coaches, Kurse und Trainingspläne zu dem, was dich gerade interessiert.',
  },
  {
    stage: 'choose',
    title: 'Such dir aus, was passt',
    text: 'Schau dir Profil und Angebot an. Passt es zu deinem Alltag und Budget?',
  },
  {
    stage: 'start',
    title: 'Mach den ersten Schritt',
    text: 'Vereinbare einen Termin mit deinem Coach oder starte mit einem digitalen Inhalt.',
  },
] as const

export default function CoachingProcess() {
  return (
    <section className="home-band-space" aria-labelledby="how-title">
      <h2 id="how-title" className="section-title mb-6 sm:mb-8">
        So legst du mit Ardore los
      </h2>
      <div className="coaching-process-layout">
        <Reveal>
          <figure className="coaching-process-photo">
            <Image
              src="/media/coach-workspace.webp"
              alt="Grüne Yogamatte, Trainingsband und ein offenes Notizbuch im Tageslicht."
              fill
              fetchPriority="low"
              sizes="(min-width: 1280px) 540px, (min-width: 1024px) 43vw, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
              className="coaching-process-photoImage"
            />
          </figure>
        </Reveal>
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
