'use client'

import Link from 'next/link'
import { ProductThumbnail } from '@/components/ui/Media'
import { Badge } from '@/components/ui/Badge'
import { FileText, Play, GraduationCap, Image as ImageIcon } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { StarRating } from '@/components/ui/StarRating'
import { formatCurrency } from '@/lib/utils'
import HeartButton from '@/components/HeartButton'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'
import { showSalesCount } from '@/lib/salesCount'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf:    <FileText     className="h-8 w-8 text-muted" />,
  video:  <Play         className="h-8 w-8 text-muted" />,
  course: <GraduationCap className="h-8 w-8 text-muted" />,
  image:  <ImageIcon    className="h-8 w-8 text-muted" />,
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

export interface ProductCardData {
  id: string
  title: string
  type: ProductType
  price: number
  thumbnail_url: string | null
  categories?: string[]
  show_sales_count?: boolean
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
  /** true → compact row card (w-48 fixed), false → full-width grid card */
  compact?: boolean
  scrollSnap?: boolean
  /** Denser responsive treatment used by the marketplace catalog grid. */
  variant?: 'default' | 'marketplace'
}

export function ProductCard({
  product,
  salesCount = 0,
  rating,
  compact = false,
  scrollSnap = false,
  variant = 'default',
}: ProductCardProps) {
  const isMarketplace = variant === 'marketplace'

  return (
    <div className={['relative', compact ? 'flex-shrink-0 w-48' : 'w-full', scrollSnap ? '[scroll-snap-align:start]' : ''].filter(Boolean).join(' ')}>
      <Link href={`/products/${product.id}`} className="block h-full rounded-2xl">
      <div className="surface-card interactive-card group flex h-full flex-col overflow-hidden">
        <ProductThumbnail src={product.thumbnail_url} alt={product.title} fallback={TYPE_ICONS[product.type]}
          sizes={compact ? '192px' : '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw'}>
          <Badge className="absolute right-2 top-2 bg-white">{TYPE_LABELS[product.type]}</Badge>
        </ProductThumbnail>
        {/* ── Content ───────────────────────────────────── */}
        <div className={compact ? 'p-3 flex flex-col flex-1' : isMarketplace ? 'p-3 sm:p-4 flex flex-col flex-1' : 'p-4 flex flex-col flex-1'}>
          {compact ? (
            <p className="text-xs text-muted truncate mb-0.5">{product.creator.display_name}</p>
          ) : (
            <div className={isMarketplace ? 'flex items-center gap-1.5 mb-1.5 sm:gap-2 sm:mb-2' : 'flex items-center gap-2 mb-2'}>
              <Avatar
                src={product.creator.avatar_url}
                name={product.creator.display_name}
                size="sm"
                className={isMarketplace ? 'hidden sm:flex h-5 w-5 text-[10px] flex-shrink-0' : 'h-5 w-5 text-[10px] flex-shrink-0'}
              />
              <span className={isMarketplace ? 'text-xs text-muted truncate' : 'text-xs text-muted truncate'}>{product.creator.display_name}</span>
            </div>
          )}

          <p className={'card-title text-foreground line-clamp-2 flex-1 mb-2'}>
            {product.title}
          </p>

          {!compact && product.categories && product.categories.length > 0 && (
            <div className={isMarketplace ? 'hidden sm:flex flex-wrap gap-1 mb-2' : 'flex flex-wrap gap-1 mb-2'}>
              {product.categories.slice(0, 2).map(cat => (
                <span key={cat} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                  {CATEGORY_LABEL_MAP[cat] ?? cat}
                </span>
              ))}
              {product.categories.length > 2 && (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                  +{product.categories.length - 2} mehr
                </span>
              )}
            </div>
          )}

          {rating && (
            <div className="mb-1">
              <StarRating rating={rating.avg} count={rating.count} size="sm" />
            </div>
          )}

          {showSalesCount(product, salesCount) && salesCount >= 50 && (
            <p className="text-[10px] text-gray-400 mb-1">{salesCount}× gekauft</p>
          )}

          <p className="text-brand font-semibold text-base mt-auto">{formatCurrency(product.price)}</p>
        </div>
      </div>
      </Link>
      <HeartButton type="product" itemId={product.id} className="absolute left-2 top-2" />
    </div>
  )
}
