export type MarketplaceArea = 'products' | 'coaching' | 'groups'

export function marketplaceArea(value: string | null | undefined): MarketplaceArea {
  return value === 'coaching' || value === 'groups' ? value : 'products'
}

export function marketplaceAreaHref(area: MarketplaceArea, search = '', category = 'all'): string {
  const params = new URLSearchParams()
  if (area !== 'products') params.set('area', area)
  const query = search.trim().replace(/\s+/g, ' ')
  if (query) params.set('q', query)
  if (category !== 'all') params.set('category', category)
  return `/marketplace${params.size ? `?${params}` : ''}`
}
