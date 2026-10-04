import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PurchaseConfirmation from './PurchaseConfirmation'
import { VALID_PURCHASE_STATUS } from '@/lib/purchases'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { FileText, Video, BookOpen, Download, Image as ImageIcon } from 'lucide-react'

const TYPE_ICONS = {
  pdf: <FileText className="h-5 w-5 text-green-600" />,
  video: <Video className="h-5 w-5 text-green-600" />,
  course: <BookOpen className="h-5 w-5 text-green-600" />,
  image: <ImageIcon className="h-5 w-5 text-green-600" />,
}

const TYPE_LABELS = { pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild' }

export default async function BuyerLibraryPage({ searchParams }: { searchParams: Promise<{ session_id?: string; checkout?: string; success?: string }> }) {
  const query = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=' + encodeURIComponent('/buyer/library' + (query.session_id ? `?session_id=${encodeURIComponent(query.session_id)}` : '')))

  const testMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true

  const { data: purchases, error } = await supabase
    .from('purchases')
    .select('*, product:products(id, title, type, description, file_url, creator:creator_profiles(display_name, slug))')
    .eq('buyer_id', user.id)
    .eq('payment_status', VALID_PURCHASE_STATUS)
    .in('stripe_livemode', testMode ? [true, false] : [true])
    .order('created_at', { ascending: false })

  const purchaseList = purchases ?? []

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Meine Bibliothek</h1>
      <p className="text-gray-500 mb-8">{purchaseList.length} gekaufte Produkte</p>

      <PurchaseConfirmation key={query.session_id ?? query.checkout ?? query.success ?? 'library'} sessionId={query.session_id} returned={query.checkout ?? query.success} />
      {error && <p role="alert" className="mb-6 text-sm text-red-700">Deine Bibliothek konnte nicht geladen werden. Bitte lade die Seite erneut; deine Käufe bleiben erhalten.</p>}

      {process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && (
        <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Ardore läuft derzeit im Testbetrieb. Testkäufe erscheinen zur Prüfung in deiner Bibliothek, erlauben aber keine Downloads.
        </p>
      )}

      {!error && purchaseList.length === 0 ? (
        <Card className="text-center py-16">
          <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Noch nichts gekauft</h3>
          <p className="text-gray-500 mb-6">Entdecke Coaches und kaufe deine ersten Inhalte.</p>
          <Link href="/coaches">
            <Button>Coaches entdecken</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {purchaseList.map((purchase: {
            id: string
            created_at: string
            amount_paid: number
            stripe_livemode: boolean | null
            product: {
              id: string
              title: string
              type: 'pdf' | 'video' | 'course' | 'image'
              description: string | null
              file_url: string | null
              creator: { display_name: string; slug: string } | null
            } | null
          }) => {
            const product = purchase.product
            if (!product) return <Card key={purchase.id}><CardContent className="p-5"><p>Produkt momentan nicht verfügbar. Dein Kauf bleibt gespeichert.</p></CardContent></Card>

            return (
              <Card key={purchase.id}>
                <CardContent className="flex flex-wrap sm:flex-nowrap items-start gap-4 p-5">
                  <div className="h-12 w-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                    {TYPE_ICONS[product.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-900">{product.title}</h3>
                      <Badge variant="outline">{TYPE_LABELS[product.type]}</Badge>
                      {purchase.stripe_livemode === false && <Badge variant="warning">Testkauf</Badge>}
                    </div>
                    <p className="text-xs text-gray-400">
                      von{' '}
                      <Link href={`/creators/${product.creator?.slug}`} className="text-green-600 hover:underline">
                        {product.creator?.display_name}
                      </Link>
                      {' '}· Gekauft am {formatDate(purchase.created_at)}
                    </p>
                    {product.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{product.description}</p>
                    )}
                  </div>
                  {product.file_url && purchase.stripe_livemode === true && (
                    <a href={`/api/products/${product.id}/download`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4" />
                        Herunterladen
                      </Button>
                    </a>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
