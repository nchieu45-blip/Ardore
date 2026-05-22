import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, FileText, Video, BookOpen, Edit } from 'lucide-react'

const TYPE_ICONS = {
  pdf: <FileText className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  course: <BookOpen className="h-4 w-4" />,
}

const TYPE_LABELS = {
  pdf: 'PDF',
  video: 'Video',
  course: 'Kurs',
}

export default async function CreatorProductsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!creator) redirect('/creator/onboarding')

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('creator_id', creator.id)
    .order('created_at', { ascending: false })

  const productList = products ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meine Produkte</h1>
          <p className="text-gray-500">{productList.length} Produkte gesamt</p>
        </div>
        <Link href="/creator/products/new">
          <Button>
            <Plus className="h-4 w-4" />
            Neues Produkt
          </Button>
        </Link>
      </div>

      {productList.length === 0 ? (
        <Card className="text-center py-16">
          <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Noch keine Produkte</h3>
          <p className="text-gray-500 mb-6">Erstelle dein erstes Produkt und starte mit dem Verkauf.</p>
          <Link href="/creator/products/new">
            <Button>
              <Plus className="h-4 w-4" />
              Erstes Produkt erstellen
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {productList.map((product: {
            id: string
            title: string
            type: 'pdf' | 'video' | 'course'
            price: number
            is_published: boolean
            description: string | null
            created_at: string
          }) => (
            <Card key={product.id}>
              <div className="flex items-center justify-between p-5">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 text-green-600">
                    {TYPE_ICONS[product.type]}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-gray-900">{product.title}</h3>
                      <Badge variant="outline">{TYPE_LABELS[product.type]}</Badge>
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
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-lg font-semibold text-gray-900">{formatCurrency(product.price)}</span>
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
      )}
    </div>
  )
}
