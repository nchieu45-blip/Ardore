import { createClient } from '@/lib/supabase/server'
import { MAX_GROUP_PARTICIPANTS } from '@/lib/group-schedule'

export interface MarketplaceServiceOffer {
  id: string
  kind: 'coaching' | 'group'
  title: string
  description: string | null
  priceCents: number
  durationMinutes: number
  createdAt: string
  creator: {
    id: string
    slug: string
    display_name: string
    avatar_url: string | null
    categories: string[]
    category: string | null
    is_verified: boolean
  }
  rating: { avg: number; count: number } | null
  scheduleType: 'once' | 'recurring' | null
  startsAt: string | null
  recurringWeekday: number | null
  recurringTime: string | null
  maxParticipants: number | null
  includedInSubscription: boolean
}

interface MarketplaceServiceInventory {
  offers: MarketplaceServiceOffer[]
  error: boolean
  ratingsUnavailable: boolean
}

type PublicRow = Record<string, unknown>

const CREATOR_FIELDS = 'id, slug, display_name, avatar_url, category, categories, is_verified, is_published'
const OFFER_FIELDS = 'id, creator_id, description, price_cents, duration_minutes, created_at'

function record(value: unknown): PublicRow | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as PublicRow
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function date(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function publicOffer(value: unknown, kind: MarketplaceServiceOffer['kind'], now: number): MarketplaceServiceOffer | null {
  const row = record(value)
  if (!row || (kind === 'coaching' ? row.is_enabled !== true : row.active !== true)) return null

  const profile = record(Array.isArray(row.creator_profiles) ? row.creator_profiles[0] : row.creator_profiles)
  const id = text(row.id)
  const creatorId = text(row.creator_id)
  const name = text(profile?.display_name)
  const slug = text(profile?.slug)
  const createdAt = date(row.created_at)
  if (
    !id || !creatorId || !profile || profile.id !== creatorId || profile.is_published !== true ||
    !name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !createdAt ||
    !integer(row.price_cents, 0) || !integer(row.duration_minutes, 1)
  ) return null

  let scheduleType: MarketplaceServiceOffer['scheduleType'] = null
  let startsAt: string | null = null
  let recurringWeekday: number | null = null
  let recurringTime: string | null = null
  let maxParticipants: number | null = null
  let title = `1:1 Coaching mit ${name}`

  if (kind === 'group') {
    const groupTitle = text(row.title)
    if (!groupTitle || (row.max_participants !== null && !integer(row.max_participants, 1))) return null
    title = groupTitle
    maxParticipants = Math.min((row.max_participants as number | null) ?? MAX_GROUP_PARTICIPANTS, MAX_GROUP_PARTICIPANTS)

    if (row.schedule_type === 'once') {
      startsAt = date(row.starts_at)
      if (!startsAt) return null
      const endsAt = Date.parse(startsAt) + row.duration_minutes * 60_000
      if (!Number.isSafeInteger(endsAt) || endsAt <= now) return null
      scheduleType = 'once'
    } else if (row.schedule_type === 'recurring') {
      if (
        !integer(row.recurring_weekday, 0) || row.recurring_weekday > 6 ||
        typeof row.recurring_time !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(row.recurring_time)
      ) return null
      scheduleType = 'recurring'
      recurringWeekday = row.recurring_weekday
      recurringTime = row.recurring_time
    } else return null
  }

  return {
    id,
    kind,
    title,
    description: text(row.description),
    priceCents: row.price_cents,
    durationMinutes: row.duration_minutes,
    createdAt,
    creator: {
      id: creatorId,
      slug,
      display_name: name,
      avatar_url: text(profile.avatar_url),
      categories: Array.isArray(profile.categories)
        ? profile.categories.filter((category): category is string => typeof category === 'string' && category.trim().length > 0)
        : [],
      category: text(profile.category),
      is_verified: profile.is_verified === true,
    },
    rating: null,
    scheduleType,
    startsAt,
    recurringWeekday,
    recurringTime,
    maxParticipants,
    includedInSubscription: kind === 'group' && row.included_in_subscription === true,
  }
}

/** Public presentation only: the existing booking routes remain the authority for availability and checkout. */
export async function loadPublicCoachingMarketplace(kind: MarketplaceServiceOffer['kind']): Promise<MarketplaceServiceInventory> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  let offers: MarketplaceServiceOffer[]
  try {
    supabase = await createClient()
    const isCoaching = kind === 'coaching'
    const fields = isCoaching
      ? `${OFFER_FIELDS}, is_enabled`
      : `${OFFER_FIELDS}, title, active, schedule_type, starts_at, recurring_weekday, recurring_time, max_participants, included_in_subscription, group_occurrence_schedules(occurrence_start,scheduled_at,revision)`
    const { data, error } = await supabase
      .from(isCoaching ? 'coaching_offers' : 'video_classes')
      .select(`${fields}, creator_profiles!inner(${CREATOR_FIELDS})`)
      .eq(isCoaching ? 'is_enabled' : 'active', true)
      .eq('creator_profiles.is_published', true)
      .order('created_at', { ascending: false })

    if (error || !Array.isArray(data)) return { offers: [], error: true, ratingsUnavailable: false }
    const now = Date.now()
    const seen = new Set<string>()
    offers = data.flatMap((row: unknown) => {
      const entry = row as PublicRow
      const moves = Array.isArray(entry?.group_occurrence_schedules) ? entry.group_occurrence_schedules as { occurrence_start: string; scheduled_at: string }[] : []
      const moved = kind === 'group' && entry?.schedule_type === 'once' ? moves.find(move => Date.parse(move.occurrence_start) === Date.parse(String(entry.starts_at))) : null
      const offer = publicOffer(moved ? { ...entry, starts_at: moved.scheduled_at } : row, kind, now)
      if (!offer || seen.has(offer.id)) return []
      seen.add(offer.id)
      return [offer]
    })
  } catch {
    return { offers: [], error: true, ratingsUnavailable: false }
  }

  // Session reviews describe 1:1 bookings. They must never become group-class or product ratings.
  if (kind === 'group' || offers.length === 0) return { offers, error: false, ratingsUnavailable: false }

  try {
    const creatorIds = [...new Set(offers.map((offer) => offer.creator.id))]
    const { data, error } = await supabase
      .from('public_session_reviews')
      .select('id, creator_id, rating')
      .in('creator_id', creatorIds)
    if (error || !Array.isArray(data)) return { offers, error: false, ratingsUnavailable: true }

    const publicCreators = new Set(creatorIds)
    const seenReviews = new Set<string>()
    const totals = new Map<string, { sum: number; count: number }>()
    for (const value of data) {
      const review = record(value)
      const reviewId = text(review?.id)
      const creatorId = text(review?.creator_id)
      if (
        !review || !reviewId || !creatorId || !publicCreators.has(creatorId) || seenReviews.has(reviewId) ||
        !integer(review.rating, 1) || review.rating > 5
      ) continue
      seenReviews.add(reviewId)
      const current = totals.get(creatorId) ?? { sum: 0, count: 0 }
      current.sum += review.rating
      current.count++
      totals.set(creatorId, current)
    }
    offers = offers.map((offer) => {
      const total = totals.get(offer.creator.id)
      return { ...offer, rating: total ? { avg: total.sum / total.count, count: total.count } : null }
    })
    return { offers, error: false, ratingsUnavailable: false }
  } catch {
    return { offers, error: false, ratingsUnavailable: true }
  }
}
