import type { MarketplaceFormat } from './marketplaceFilters'

export type MarketplaceArea = 'products' | 'coaching' | 'groups'

export function marketplaceArea(value: string | null | undefined): MarketplaceArea {
  return value === 'coaching' || value === 'groups' ? value : 'products'
}

export function marketplaceAreaHref(area: MarketplaceArea, search = '', category = 'all', format?: MarketplaceFormat, categoryParam: 'kategorie' | 'category' = 'category'): string {
  const params = new URLSearchParams()
  if (area !== 'products') params.set('area', area)
  const query = search.trim().replace(/\s+/g, ' ')
  if (query) params.set('q', query)
  if (category !== 'all') params.set(categoryParam, category)
  if (format) params.set('format', format)
  return `/marketplace${params.size ? `?${params}` : ''}`
}
