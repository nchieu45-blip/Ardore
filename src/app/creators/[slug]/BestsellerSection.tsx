import { FileText, Video, BookOpen, Image as ImageIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import BuyButton from './BuyButton'

type ProductType = 'pdf' | 'video' | 'course' | 'image'

interface BestsellerProduct {
  id: string
  title: string
  description: string | null
  type: ProductType
  price: number
  rank: number
}

interface Props {
  products: BestsellerProduct[]
  purchasedIds: string[]
  isLoggedIn: boolean
  creatorId: string
  creatorName: string
  creatorSlug: string
}

const TYPE_ICONS: Record<ProductType, React.ReactNode> = {
  pdf: <FileText className="h-5 w-5 text-green-600" />,
  video: <Video className="h-5 w-5 text-green-600" />,
  course: <BookOpen className="h-5 w-5 text-green-600" />,
  image: <ImageIcon className="h-5 w-5 text-green-600" />,
}

const TYPE_LABELS: Record<ProductType, string> = {
  pdf: 'PDF',
  video: 'Video',
  course: 'Kurs',
  image: 'Bild',
}

export default function BestsellerSection({ products, purchasedIds, isLoggedIn, creatorId, creatorName, creatorSlug }: Props) {
  const purchasedSet = new Set(purchasedIds)

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Bestseller</h2>
      <div className="space-y-3">
        {products.map(product => {
          const isTop = product.rank === 1
          const owned = purchasedSet.has(product.id)
          return (
            <Card
              key={product.id}
              className={isTop ? 'border-2 border-amber-400' : ''}
            >
              <CardContent className="flex items-start gap-4 p-5">
                {/* Rank number */}
                <div className="flex-shrink-0 w-7 text-center">
                  <span className={`text-base font-bold ${isTop ? 'text-amber-500' : 'text-gray-400'}`}>
                    #{product.rank}
                  </span>
                </div>

                {/* Type icon */}
                <div className="h-12 w-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  {TYPE_ICONS[product.type]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-medium text-gray-900">{product.title}</h3>
                    <Badge variant="outline">{TYPE_LABELS[product.type]}</Badge>
                    {isTop && (
                      <Badge variant="warning">Bestseller</Badge>
                    )}
                  </div>
                  {product.description && (
                    <p className="text-sm text-gray-500 line-clamp-2">{product.description}</p>
                  )}
                </div>

                {/* Price + action */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className="font-semibold text-gray-900">{formatCurrency(product.price)}</span>
                  {owned ? (
                    <Badge variant="success">Gekauft</Badge>
                  ) : isLoggedIn ? (
                    <BuyButton productId={product.id} price={product.price} title={product.title} type={product.type} creatorId={creatorId} creatorName={creatorName} creatorSlug={creatorSlug} />
                  ) : (
                    <Link href={`/login?redirect=${encodeURIComponent(`/products/${product.id}`)}`}>
                      <Button size="sm">Kaufen</Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
