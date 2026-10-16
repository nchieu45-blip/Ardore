import { CATEGORY_LABEL_MAP } from '@/lib/categories'

interface DiscoveryCoach {
  id: string
  createdAt: string
  categories: readonly string[]
  category: string | null
  hasVideoCoaching: boolean
  hasSubscription: boolean
}

interface CoachDiscoveryRow<T extends DiscoveryCoach> {
  id: string
  title: string
  description: string
  href: string
  coaches: T[]
}

const ROW_LIMIT = 12
const TOPIC_ROW_LIMIT = 2

export function compareNewestCoaches(a: DiscoveryCoach, b: DiscoveryCoach): number {
  const aDate = Date.parse(a.createdAt)
  const bDate = Date.parse(b.createdAt)
  const aTime = Number.isFinite(aDate) ? aDate : -Infinity
  const bTime = Number.isFinite(bDate) ? bDate : -Infinity
  return aTime === bTime ? a.id.localeCompare(b.id) : aTime > bTime ? -1 : 1
}

export function coachCategories(coach: Pick<DiscoveryCoach, 'categories' | 'category'>): readonly string[] {
  return coach.categories.length ? coach.categories : coach.category ? [coach.category] : []
}

export function buildCoachDiscoveryRows<T extends DiscoveryCoach>(
  coaches: readonly T[],
  availableCategories: readonly string[],
): CoachDiscoveryRow<T>[] {
  if (coaches.length === 0) return []
  const newest = [...coaches].sort(compareNewestCoaches)
  const rows: CoachDiscoveryRow<T>[] = [{
    id: 'newest',
    title: 'Neue Coach-Profile',
    description: 'Lerne die zuletzt hinzugekommenen Coaches kennen.',
    href: '/coaches?sort=newest',
    coaches: newest.slice(0, ROW_LIMIT),
  }]

  const coaching = newest.filter(coach => coach.hasVideoCoaching)
  if (coaching.length > 0) rows.push({
    id: 'coaching',
    title: 'Persönliches 1:1 Coaching',
    description: 'Coaches mit einem aktiven Angebot für persönliche Sessions.',
    href: '/coaches?videocoaching=true',
    coaches: coaching.slice(0, ROW_LIMIT),
  })

  const subscriptions = newest.filter(coach => coach.hasSubscription)
  if (subscriptions.length > 0) rows.push({
    id: 'subscriptions',
    title: 'Begleitung im Abonnement',
    description: 'Entdecke Coaches mit einem aktiven Abo-Angebot.',
    href: '/coaches?subscription=true',
    coaches: subscriptions.slice(0, ROW_LIMIT),
  })

  let topicCount = 0
  for (const key of availableCategories) {
    if (!Object.hasOwn(CATEGORY_LABEL_MAP, key)) continue
    const matching = newest.filter(coach => coachCategories(coach).includes(key))
    if (matching.length < 2 || matching.length === newest.length) continue
    rows.push({
      id: `category-${key}`,
      title: CATEGORY_LABEL_MAP[key],
      description: `Coaches mit dem Schwerpunkt ${CATEGORY_LABEL_MAP[key]}.`,
      href: `/coaches?category=${encodeURIComponent(key)}`,
      coaches: matching.slice(0, ROW_LIMIT),
    })
    topicCount++
    if (topicCount === TOPIC_ROW_LIMIT) break
  }
  return rows
}
