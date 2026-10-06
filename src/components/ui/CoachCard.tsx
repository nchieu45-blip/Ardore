'use client'

import Link from 'next/link'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import { CoachPortrait } from './Media'
import { Badge } from './Badge'
import { buttonStyles } from './Button'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import { formatCurrency } from '@/lib/utils'
import HeartButton from '@/components/HeartButton'
import type { CoachData } from '@/lib/publicCoaches'

export function CoachCard({ coach }: { coach: CoachData }) {
  const specialties = [
    ...new Set(
      coach.categories.length
        ? coach.categories
        : coach.category
          ? [coach.category]
          : []
    ),
  ].slice(0, 3)
  return (
    <article className="surface-card interactive-card relative flex h-full min-w-0 flex-col overflow-hidden" data-ardore-pilot="coach-card">
      <Link
        href={`/creators/${coach.slug}`}
        aria-label={`Profil von ${coach.display_name} ansehen`}
      >
        <CoachPortrait
          src={coach.avatar_url}
          alt={coach.display_name}
          sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw"
        />
      </Link>
      <HeartButton
        type="coach"
        itemId={coach.id}
        className="absolute right-3 top-3 z-10"
      />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-2 break-words text-lg font-semibold leading-snug tracking-tight">{coach.display_name}</h3>
        {coach.is_verified && (
          <div className="mb-3">
            <Badge variant="success" icon={<ShieldCheck />}>
              Verifiziert
            </Badge>
          </div>
        )}
        {coach.bio && (
          <p className="mb-3 line-clamp-2 text-sm text-muted">{coach.bio}</p>
        )}
        {specialties.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
            {specialties.map((key) => (
              <span key={key} className="text-sm text-brand">{CATEGORY_LABEL_MAP[key] ?? key}</span>
            ))}
          </div>
        )}
        <p className="mb-4 text-sm leading-relaxed text-muted">
          {[
            coach.hasVideoCoaching && '1:1 Coaching',
            coach.productCount > 0 && 'Digitale Produkte',
            coach.hasSubscription && 'Abonnements',
          ]
            .filter(Boolean)
            .join(' · ') || 'Coach-Profil'}
        </p>
        {/* Product reviews are not session reviews. Name their actual source explicitly. */}
        {coach.rating && coach.rating.count > 0 && (
          <p className="mb-3 text-sm text-muted">
            {coach.rating.avg.toFixed(1)} / 5 · {coach.rating.count}{' '}
            {coach.rating.count === 1
              ? 'Produktbewertung'
              : 'Produktbewertungen'}
          </p>
        )}
        <div className="mt-auto">
          {coach.coachingPrice && (
            <div className="mb-4 border-t border-border pt-3">
              <p className="text-lg font-semibold tracking-tight">
                {coach.coachingPrice.price_cents === 0
                  ? 'Kostenloses 1:1 Coaching'
                  : `1:1 Coaching ab ${formatCurrency(coach.coachingPrice.price_cents / 100)}`}
              </p>
              <p className="mt-1 text-sm text-muted">
                {coach.coachingPrice.duration_minutes} Min. je Session
              </p>
            </div>
          )}
          <Link
            href={`/creators/${coach.slug}`}
            className={buttonStyles({
              variant: 'secondary',
              className: 'w-full',
            })}
            aria-label={`Profil von ${coach.display_name} ansehen`}
          >
            Profil ansehen
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}
