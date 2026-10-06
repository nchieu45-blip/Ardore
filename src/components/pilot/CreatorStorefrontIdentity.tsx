import Link from 'next/link'
import { CoachPortrait } from '@/components/ui/Media'
import { VerificationBadge } from '@/components/ui/StatusBadge'
import type { ReactNode } from 'react'

// Presentation-only identity for the single explicitly scoped public pilot.
export function CreatorStorefrontIdentity({ name, portrait, bio, specialties, languages, products, subscriptions, coaching, actions, socialLinks }: {
  name: string; portrait: string | null; bio: string | null; specialties: string[]; languages: string[];
  products: number; subscriptions: number; coaching: boolean; actions: ReactNode; socialLinks: ReactNode;
}) {
  return <header className="grid gap-6 border-b border-border pb-8 md:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)]">
    <CoachPortrait src={portrait} alt={name} className="w-36 rounded-xl md:w-full" sizes="(max-width: 767px) 144px, 220px" />
    <div className="min-w-0">
      <p className="mb-2 text-sm font-medium text-brand">Dein direkter Weg zu {name}</p>
      <h1 className="mb-3 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{name}</h1>
      {bio && <p className="mb-4 max-w-2xl line-clamp-3 text-base leading-relaxed text-muted">{bio}</p>}
      <ul aria-label="Schwerpunkte" className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-brand">{specialties.slice(0,3).map(s => <li key={s}>{s}</li>)}</ul>
      {languages.length > 0 && <p className="mb-4 text-sm text-muted">Sprachen: {languages.join(', ')}</p>}
      <nav aria-label="Angebote dieses Coaches" className="mb-4 flex flex-wrap gap-2">
        {coaching && <Link className="button-base button-primary" href="#booking">1:1 Coaching & Termine</Link>}
        {products > 0 && <Link className="button-base button-secondary" href="#pilot-products">Digitale Produkte · {products}</Link>}
        {subscriptions > 0 && <Link className="button-base button-secondary" href="#pilot-subscriptions">Abonnements · {subscriptions}</Link>}
      </nav>
      <div className="flex flex-wrap items-center gap-3">{actions}{socialLinks}</div>
    </div>
  </header>
}
export function StorefrontVerification({ verified }: { verified: boolean }) {
  return verified ? <VerificationBadge /> : null
}
