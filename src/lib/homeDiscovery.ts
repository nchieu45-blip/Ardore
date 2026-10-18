import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import type { ProductRating } from '@/lib/productRatings'

export interface HomeDiscoveryProduct {
  id: string
  type: string
  price: number
  createdAt: string
  categories: readonly string[]
  creator?: {
    categories?: readonly string[] | null
    category?: string | null
  }
}

export interface HomeProductRow<T extends HomeDiscoveryProduct> {
  id: string
  title: string
  description: string
  href: string
  products: T[]
}

const ROW_LIMIT = 12
const TOPIC_ROW_LIMIT = 2
const TOPIC_PRIORITY = ['yoga', 'ernaehrung', 'ernaehrungsberatung', 'mental', 'krafttraining']

function compareNewest<T extends HomeDiscoveryProduct>(a: T, b: T): number {
  const aDate = Date.parse(a.createdAt)
  const bDate = Date.parse(b.createdAt)
  const aTime = Number.isFinite(aDate) ? aDate : -Infinity
  const bTime = Number.isFinite(bDate) ? bDate : -Infinity

  return aTime === bTime ? a.id.localeCompare(b.id) : aTime > bTime ? -1 : 1
}

function hasValidRating(rating: ProductRating | undefined): rating is ProductRating {
  return !!rating
    && Number.isFinite(rating.avg)
    && rating.avg > 0
    && rating.avg <= 5
    && Number.isInteger(rating.count)
    && rating.count > 0
}

function hasCategory(product: HomeDiscoveryProduct, category: string): boolean {
  // Match the marketplace's published product and coach category filters.
  return product.categories.includes(category)
    || (product.creator?.categories ?? []).includes(category)
    || product.creator?.category === category
}

export function buildHomeProductRows<T extends HomeDiscoveryProduct>(
  products: readonly T[],
  ratings: Readonly<Record<string, ProductRating | undefined>>,
  // Discovery pages can use the same ranking as their complete results.
  compareRatings: (a: ProductRating, b: ProductRating) => number = (a, b) => b.avg - a.avg || b.count - a.count,
): HomeProductRow<T>[] {
  if (products.length === 0) return []

  const newest = [...products].sort(compareNewest)
  const bestRated = newest
    .filter((product) => hasValidRating(ratings[product.id]))
    .sort((a, b) => {
      const aRating = ratings[a.id]!
      const bRating = ratings[b.id]!
      return compareRatings(aRating, bRating)
        || compareNewest(a, b)
    })

  const rows: HomeProductRow<T>[] = [
    {
      id: 'newest',
      title: 'Neu im Marktplatz',
      description: 'Digitale Inhalte für deinen Alltag und dein Training.',
      href: '/marketplace?sort=newest',
      products: newest.slice(0, ROW_LIMIT),
    },
    {
      id: 'best-rated',
      title: 'Best bewertet',
      description: 'Produkte mit Bewertungen aus dem Marktplatz.',
      href: '/marketplace?sort=top_rated',
      // Keep the row empty when no real reviews exist, so the UI can explain it.
      products: bestRated.slice(0, ROW_LIMIT),
    },
  ]

  const courses = newest.filter((product) => product.type === 'course')
  if (courses.length > 0) {
    rows.push({
      id: 'courses',
      title: 'Online-Kurse',
      description: 'Entdecke die verfügbaren Online-Kurse.',
      href: '/marketplace?type=course',
      products: courses.slice(0, ROW_LIMIT),
    })
  }

  const free = newest.filter((product) => product.price === 0)
  if (free.length > 0) {
    rows.push({
      id: 'free',
      title: 'Kostenlos entdecken',
      description: 'Digitale Inhalte ohne Kaufpreis.',
      href: '/marketplace?max_price=0',
      products: free.slice(0, ROW_LIMIT),
    })
  }

  const topicKeys = [...new Set(newest.flatMap((product) => [
    ...product.categories,
    ...(product.creator?.categories ?? []),
    ...(product.creator?.category ? [product.creator.category] : []),
  ]))]
    .filter((key) => Object.hasOwn(CATEGORY_LABEL_MAP, key))
    .sort((a, b) => {
      const aPriority = TOPIC_PRIORITY.indexOf(a)
      const bPriority = TOPIC_PRIORITY.indexOf(b)
      return (aPriority === -1 ? Infinity : aPriority)
        - (bPriority === -1 ? Infinity : bPriority)
        || CATEGORY_LABEL_MAP[a].localeCompare(CATEGORY_LABEL_MAP[b], 'de')
    })

  let topicCount = 0
  for (const key of topicKeys) {
    const matching = newest.filter((product) => hasCategory(product, key))
    // A one-item topic is not a useful shelf; an all-inventory topic duplicates newest.
    if (matching.length < 2 || matching.length === newest.length) continue

    rows.push({
      id: `category-${key}`,
      title: CATEGORY_LABEL_MAP[key],
      description: `Digitale Angebote zum Thema ${CATEGORY_LABEL_MAP[key]}.`,
      href: `/marketplace?category=${encodeURIComponent(key)}`,
      products: matching.slice(0, ROW_LIMIT),
    })
    topicCount++
    if (topicCount === TOPIC_ROW_LIMIT) break
  }

  return rows
}
