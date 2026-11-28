import { CATEGORY_LABEL_MAP } from './categories'
import { DISCOVERY_CATEGORIES } from './discoveryCategories'

export const FORMAT_OPTIONS = [
  { key: 'vor-ort', label: 'Vor Ort' },
  { key: 'online', label: 'Online' },
  { key: 'beides', label: 'Beides' },
] as const
export type MarketplaceFormat = typeof FORMAT_OPTIONS[number]['key']
export type CoachFormat = 'online' | 'beides'

export function readMarketplaceFormat(value: string | null): MarketplaceFormat | undefined {
  return FORMAT_OPTIONS.find(option => option.key === value)?.key
}

/** Digital products and video sessions are online. Only opted-in 1:1 coaches offer an in-person option. */
export function matchesMarketplaceFormat(filter: MarketplaceFormat | undefined, coachFormat?: CoachFormat): boolean {
  return filter !== 'vor-ort' || coachFormat === 'beides'
}

export function matchesMarketplaceCategory(category: string, keys: readonly string[]): boolean {
  if (category === 'all') return true
  const collection: readonly string[] | undefined = DISCOVERY_CATEGORIES.find(item => item.key === category)?.categories
  return keys.some(key => key === category || collection?.includes(key))
}

export function marketplaceCategoryLabel(category: string): string {
  return DISCOVERY_CATEGORIES.find(item => item.key === category)?.title
    ?? (Object.hasOwn(CATEGORY_LABEL_MAP, category) ? CATEGORY_LABEL_MAP[category] : category)
}

export function marketplaceCategoryParam(params: Pick<URLSearchParams, 'get'>): 'kategorie' | 'category' {
  return params.get('kategorie') ? 'kategorie' : 'category'
}
