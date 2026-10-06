'use client'

import Link from 'next/link'
import { ProductThumbnail } from '@/components/ui/Media'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import HeartButton from '@/components/HeartButton'
import { showSalesCount } from '@/lib/salesCount'
import { DURATION_OPTIONS, LEVEL_OPTIONS } from '@/lib/productOptions'

// The schema stores file/format types, not a promise about the content's subject.
export const PRODUCT_OFFER_LABELS = {
  pdf: 'Digitales Produkt',
  video: 'Video',
  course: 'Online-Kurs',
  image: 'Bildmaterial',
}
const FILE_LABELS = {
  pdf: 'PDF',
  video: 'Videoformat',
  course: 'Kurs',
  image: 'Bildformat',
}
export interface ProductCardData {
  id: string
  title: string
  type: 'pdf' | 'video' | 'course' | 'image'
  price: number
  thumbnail_url: string | null
  categories?: string[]
  show_sales_count?: boolean
  level?: string | null
  duration?: string | null
  creator: {
    id: string
    display_name: string
    avatar_url: string | null
    slug: string
    category: string | null
    categories: string[]
  }
}
interface ProductCardProps {
  product: ProductCardData
  salesCount?: number
  rating?: { avg: number; count: number }
  compact?: boolean
  scrollSnap?: boolean
  variant?: 'default' | 'marketplace'
}
export function ProductCard({
  product,
  salesCount = 0,
  rating,
  compact = false,
  scrollSnap = false,
}: ProductCardProps) {
  const metadata = [
    FILE_LABELS[product.type],
    LEVEL_OPTIONS.find((o) => o.value === product.level)?.label,
    DURATION_OPTIONS.find((o) => o.value === product.duration)?.label,
  ].filter(Boolean)
  return (
    <article
      data-ardore-pilot="product-card"
      className={`surface-card interactive-card group relative flex h-full min-w-0 flex-col overflow-hidden ${compact ? 'w-72 shrink-0' : 'w-full'} ${scrollSnap ? '[scroll-snap-align:start]' : ''}`}
    >
      <ProductThumbnail
        src={product.thumbnail_url}
        alt={product.title}
        sizes={
          compact
            ? '288px'
            : '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw'
        }
      />
      <div className="flex flex-1 flex-col p-5">
        <p className="mb-2 text-sm font-medium text-brand">
          {PRODUCT_OFFER_LABELS[product.type]}
        </p>
        <h3 className="card-title mb-3 min-h-11 line-clamp-2 text-foreground text-lg leading-snug tracking-tight">
          <Link
            href={`/products/${product.id}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-brand focus-visible:after:-outline-offset-4"
          >
            {product.title}
          </Link>
        </h3>
        <Link
          href={`/creators/${product.creator.slug}`}
          className="relative z-10 mb-3 flex min-h-11 min-w-0 items-center gap-2 text-sm text-muted hover:text-brand"
        >
          <span aria-hidden="true">
            <Avatar
              src={product.creator.avatar_url}
              name={product.creator.display_name}
              size="sm"
              className="h-8 w-8 shrink-0 text-xs"
            />
          </span>
          <span className="min-w-0"><span className="block text-xs text-muted">Von</span><span className="block truncate font-medium text-foreground">{product.creator.display_name}</span></span>
        </Link>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          {metadata.join(' · ')}
        </p>
        {showSalesCount(product, salesCount) && salesCount >= 50 && (
          <p className="mb-2 text-xs text-muted">{salesCount}× gekauft</p>
        )}
        <div className="mt-auto border-t border-border pt-3">
          <p className="text-xl font-semibold text-foreground">
            {product.price === 0 ? 'Kostenlos' : formatCurrency(product.price)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {product.price === 0 ? 'Digitaler Inhalt' : 'Einmaliger Kauf'}
          </p>
        </div>
        {rating && rating.count > 0 && (
          <div className="mt-3">
            <StarRating rating={rating.avg} count={rating.count} size="sm" />
          </div>
        )}
      </div>
      <HeartButton
        type="product"
        itemId={product.id}
        className="absolute right-3 top-3 z-20"
      />
    </article>
  )
}
