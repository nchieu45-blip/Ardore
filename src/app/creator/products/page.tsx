import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Plus, BookOpen } from 'lucide-react'
import ProductsPageClient from './ProductsPageClient'

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
    .select('id, title, type, price, is_published, description, created_at')
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
        <ProductsPageClient initialProducts={productList} />
      )}
    </div>
  )
}
