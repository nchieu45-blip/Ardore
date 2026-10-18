'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays, Clock3, ShieldCheck, Users } from 'lucide-react'
import { CoachPortrait } from './Media'
import { Badge } from './Badge'
import { buttonStyles } from './Button'
import { formatServiceSchedule, hasValidServiceRating } from '@/lib/marketplaceServices'
import type { MarketplaceServiceOffer } from '@/lib/publicCoachingMarketplace'
import { formatCurrency } from '@/lib/utils'

export function CoachingOfferCard({ offer }: { offer: MarketplaceServiceOffer }) {
  const group = offer.kind === 'group'
  const href = `/creators/${offer.creator.slug}`
  const schedule = formatServiceSchedule(offer)
  const reviewed = hasValidServiceRating(offer)
  const duration = Number.isFinite(offer.durationMinutes) && offer.durationMinutes > 0
    ? `${offer.durationMinutes} Min.`
    : null
  const price = Number.isFinite(offer.priceCents) && offer.priceCents >= 0
    ? offer.priceCents === 0 ? 'Kostenlos' : formatCurrency(offer.priceCents / 100)
    : 'Preis im Profil'

  return (
    <article className="surface-card interactive-card flex h-full min-w-0 flex-col p-4">
      <div className="flex min-h-28 items-start gap-3">
        <Link href={href} aria-label={`Profil von ${offer.creator.display_name} ansehen`} className="w-16 shrink-0 overflow-hidden rounded-xl">
          <CoachPortrait src={offer.creator.avatar_url} alt={offer.creator.display_name} sizes="64px" />
        </Link>
        <div className="min-w-0 py-1">
          <p className="text-sm font-medium text-brand">{group ? 'Gruppencoaching' : '1:1 Coaching'}</p>
          <Link href={href} className="mt-1 line-clamp-2 break-words text-sm font-medium text-foreground hover:text-brand hover:underline underline-offset-4">
            {offer.creator.display_name}
          </Link>
          {offer.creator.is_verified && <Badge variant="success" icon={<ShieldCheck />} className="mt-2">Verifiziert</Badge>}
        </div>
      </div>

      <h3 className="mt-4 min-h-12 break-words text-lg font-semibold leading-snug tracking-tight">
        <Link href={href} className="line-clamp-2 hover:text-brand">{offer.title}</Link>
      </h3>
      {offer.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{offer.description}</p>}

      <div className="mt-4 space-y-2 text-sm text-muted">
        {(duration || (group && offer.maxParticipants !== null && offer.maxParticipants > 0)) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {duration && <p className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />{duration}</p>}
            {group && offer.maxParticipants !== null && offer.maxParticipants > 0 && <p className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 shrink-0" aria-hidden="true" />Max. {offer.maxParticipants} Personen</p>}
          </div>
        )}
        {schedule && <p className="flex items-start gap-1.5"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{schedule}</span></p>}
        {reviewed && offer.rating && <p>{offer.rating.avg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 5 · {offer.rating.count} {offer.rating.count === 1 ? 'Sessionbewertung' : 'Sessionbewertungen'}</p>}
      </div>

      <div className="mt-auto pt-4">
        <p className="text-lg font-semibold tracking-tight">{price}</p>
        <p className="mt-1 text-xs text-muted">{group ? 'Je Gruppentermin' : 'Je 1:1 Session'}</p>
        {offer.includedInSubscription && <p className="mt-2 text-xs leading-relaxed text-muted">Abo-Konditionen im Coach-Profil.</p>}
        {group && offer.priceCents > 0 && <p className="mt-3 text-xs leading-relaxed text-muted">Bezahlte Gruppenbuchung derzeit nicht verfügbar.</p>}
        <Link href={href} className={buttonStyles({ variant: 'secondary', className: 'mt-4 w-full' })} aria-label={`${offer.title} bei ${offer.creator.display_name} ansehen`}>
          Angebot ansehen<ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
