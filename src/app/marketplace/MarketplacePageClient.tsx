'use client'

import { useSearchParams } from 'next/navigation'
import type { MarketplaceProduct } from '@/app/MarketplaceClient'
import type { MarketplaceServiceOffer } from '@/lib/publicCoachingMarketplace'
import { marketplaceArea } from '@/lib/marketplaceAreas'
import ProductMarketplaceClient from './ProductMarketplaceClient'
import ServiceMarketplaceClient from './ServiceMarketplaceClient'

interface Props {
  products?: MarketplaceProduct[]
  salesCounts?: Record<string, number>
  ratings?: Record<string, { avg: number; count: number }>
  serviceOffers?: MarketplaceServiceOffer[]
  serviceError?: boolean
  ratingsUnavailable?: boolean
}

export default function MarketplacePageClient({ products = [], salesCounts = {}, ratings = {}, serviceOffers = [], serviceError = false, ratingsUnavailable = false }: Props) {
  const params = useSearchParams()
  const area = marketplaceArea(params.get('area'))
  return area === 'products'
    ? <ProductMarketplaceClient products={products} salesCounts={salesCounts} ratings={ratings} />
    : <ServiceMarketplaceClient key={area} area={area} offers={serviceOffers} error={serviceError} ratingsUnavailable={ratingsUnavailable} />
}
