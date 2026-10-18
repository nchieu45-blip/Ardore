import { compareProductRatings } from '@/lib/productRatings'
import type { MarketplaceServiceOffer } from '@/lib/publicCoachingMarketplace'

export type MarketplaceServiceSort = 'newest' | 'price_asc' | 'price_desc' | 'top_rated' | 'upcoming'

export interface MarketplaceServiceRow {
  id: string
  title: string
  description: string
  href: string
  offers: MarketplaceServiceOffer[]
}

const PREVIEW_LIMIT = 12
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function validTimestamp(value: string | null): number | null {
  const timestamp = value ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

function compareNewest(a: MarketplaceServiceOffer, b: MarketplaceServiceOffer): number {
  const aTime = validTimestamp(a.createdAt) ?? -Infinity
  const bTime = validTimestamp(b.createdAt) ?? -Infinity
  return aTime === bTime ? a.id.localeCompare(b.id) : aTime > bTime ? -1 : 1
}

export function hasValidServiceRating(offer: MarketplaceServiceOffer): boolean {
  // Product ratings and group reviews must never become a 1:1 recommendation.
  const rating = offer.kind === 'coaching' ? offer.rating : null
  return !!rating
    && Number.isFinite(rating.avg)
    && rating.avg > 0
    && rating.avg <= 5
    && Number.isInteger(rating.count)
    && rating.count > 0
}

function upcomingTimestamp(offer: MarketplaceServiceOffer, now: number): number | null {
  if (offer.kind !== 'group' || offer.scheduleType !== 'once') return null
  const timestamp = validTimestamp(offer.startsAt)
  return timestamp !== null && timestamp >= now ? timestamp : null
}

/** Keep every matching offer; only discovery previews have a twelve-card limit. */
export function sortMarketplaceServices(
  offers: readonly MarketplaceServiceOffer[],
  sort: MarketplaceServiceSort | string = 'newest',
  now = Date.now(),
): MarketplaceServiceOffer[] {
  return [...offers].sort((a, b) => {
    if (sort === 'price_asc' || sort === 'price_desc') {
      const direction = sort === 'price_asc' ? 1 : -1
      const aPrice = Number.isFinite(a.priceCents) && a.priceCents >= 0 ? a.priceCents : null
      const bPrice = Number.isFinite(b.priceCents) && b.priceCents >= 0 ? b.priceCents : null
      if (aPrice === null || bPrice === null) {
        if (aPrice !== bPrice) return aPrice === null ? 1 : -1
      } else if (aPrice !== bPrice) return direction * (aPrice - bPrice)
    } else if (sort === 'top_rated') {
      const aValid = hasValidServiceRating(a)
      const bValid = hasValidServiceRating(b)
      if (aValid !== bValid) return aValid ? -1 : 1
      if (aValid && bValid) {
        const result = compareProductRatings(a.rating!, b.rating!)
        if (result !== 0) return result
      }
    } else if (sort === 'upcoming') {
      const aTime = upcomingTimestamp(a, now)
      const bTime = upcomingTimestamp(b, now)
      if (aTime !== bTime) {
        if (aTime === null) return 1
        if (bTime === null) return -1
        return aTime - bTime
      }
    }
    return compareNewest(a, b)
  })
}

export function buildServiceRows(
  offers: readonly MarketplaceServiceOffer[],
  kind: MarketplaceServiceOffer['kind'],
  now = Date.now(),
): MarketplaceServiceRow[] {
  const matching = offers.filter((offer) => offer.kind === kind)
  if (matching.length === 0) return []

  const area = kind === 'coaching' ? 'coaching' : 'groups'
  const newest = sortMarketplaceServices(matching, 'newest', now).slice(0, PREVIEW_LIMIT)
  const rows: MarketplaceServiceRow[] = [{
    id: 'newest',
    title: kind === 'coaching' ? 'Neue 1:1 Coachings' : 'Neue Gruppenangebote',
    description: kind === 'coaching'
      ? 'Persönliche Begleitung für dein Ziel. Vergleiche Angebot, Dauer und Preis.'
      : 'Gemeinsam an deinem Ziel arbeiten. Termine und Details findest du im Angebot.',
    href: `/marketplace?area=${area}&sort=newest`,
    offers: newest,
  }]

  const secondary = kind === 'coaching'
    ? sortMarketplaceServices(matching.filter(hasValidServiceRating), 'top_rated', now)
    : sortMarketplaceServices(matching.filter((offer) => upcomingTimestamp(offer, now) !== null), 'upcoming', now)
  const preview = secondary.slice(0, PREVIEW_LIMIT)
  const duplicatesNewest = preview.length === newest.length
    && preview.every((offer, index) => offer.id === newest[index].id)

  if (preview.length > 0 && !duplicatesNewest) {
    rows.push({
      id: kind === 'coaching' ? 'best-rated' : 'upcoming',
      title: kind === 'coaching' ? 'Best bewertet' : 'Demnächst gemeinsam',
      description: kind === 'coaching'
        ? '1:1 Coachings mit Bewertungen aus abgeschlossenen Sessions.'
        : 'Einmalige Gruppentermine, nach Startzeit sortiert.',
      href: `/marketplace?area=${area}&sort=${kind === 'coaching' ? 'top_rated' : 'upcoming'}`,
      offers: preview,
    })
  }

  return rows
}

/** A recurring schedule is a pattern, never a fabricated next occurrence. */
export function formatServiceSchedule(offer: MarketplaceServiceOffer): string | null {
  if (offer.kind !== 'group') return null
  if (offer.scheduleType === 'recurring') {
    const weekday = offer.recurringWeekday
    const time = offer.recurringTime?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/)
    if (weekday === null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !time) return null
    return `Jeden ${WEEKDAYS[weekday]}, ${time[1]}:${time[2]} Uhr (Berlin)`
  }
  if (offer.scheduleType !== 'once') return null
  const timestamp = validTimestamp(offer.startsAt)
  if (timestamp === null) return null
  const date = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
  return `${date} Uhr (Berlin)`
}
