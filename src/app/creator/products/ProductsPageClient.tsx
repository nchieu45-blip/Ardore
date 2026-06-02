'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FileText, Video, BookOpen, Image as ImageIcon, Edit, Globe, EyeOff } from 'lucide-react'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  pdf:    <FileText className="h-4 w-4" />,
  video:  <Video    className="h-4 w-4" />,
  course: <BookOpen className="h-4 w-4" />,
  image:  <ImageIcon className="h-4 w-4" />,
}

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

interface Product {
  id: string
  title: string
  type: string
  price: number
  is_published: boolean
  description: string | null
  created_at: string
}

export default function ProductsPageClient({ initialProducts }: { initialProducts: Product[] }) {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [toggling, setToggling] = useState<string | null>(null)

  async function togglePublish(product: Product) {
    const newValue = !product.is_published
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_published: newValue } : p))
    setToggling(product.id)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: newValue }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_published: product.is_published } : p))
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="grid gap-4">
      {products.map(product => (
        <Card key={product.id}>
          <div className="flex items-center justify-between p-5 gap-4 flex-wrap sm:flex-nowrap">
            <div className="flex items-start gap-4 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 text-green-600">
                {TYPE_ICONS[product.type] ?? <FileText className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-gray-900">{product.title}</h3>
                  <Badge variant="outline">{TYPE_LABELS[product.type] ?? product.type}</Badge>
                  <Badge variant={product.is_published ? 'success' : 'default'}>
                    {product.is_published ? 'Veröffentlicht' : 'Entwurf'}
                  </Badge>
                </div>
                {product.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-1">{product.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">{formatDate(product.created_at)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 ml-auto flex-wrap justify-end">
              <span className="text-base font-semibold text-gray-900 mr-1">{formatCurrency(product.price)}</span>

              <button
                onClick={() => togglePublish(product)}
                disabled={toggling === product.id}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                  product.is_published
                    ? 'border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                    : 'border-green-200 text-green-700 bg-green-50 hover:bg-green-100'
                }`}
              >
                {product.is_published
                  ? <><EyeOff className="h-3.5 w-3.5" /> Zurückziehen</>
                  : <><Globe className="h-3.5 w-3.5" /> Veröffentlichen</>
                }
              </button>

              <Link href={`/creator/products/${product.id}/edit`}>
                <Button variant="outline" size="sm">
                  <Edit className="h-4 w-4" />
                  Bearbeiten
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
