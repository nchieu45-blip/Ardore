import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { VALID_PURCHASE_STATUS } from '@/lib/purchases'

const PRODUCT_OBJECT_MARKERS = [
  '/storage/v1/object/public/products/',
  '/storage/v1/object/sign/products/',
  '/storage/v1/object/authenticated/products/',
]

function getProductObjectPath(fileUrl: string, creatorId: string): string | null {
  const url = new URL(fileUrl)
  const marker = PRODUCT_OBJECT_MARKERS.find((candidate) => url.pathname.startsWith(candidate))
  if (!marker) return null
  const encodedPath = url.pathname.slice(marker.length)
  if (!encodedPath) return null

  const objectPath = decodeURIComponent(encodedPath)
  const segments = objectPath.split('/')
  // A product reference is coach-editable content, not authority to access a
  // different coach's private files. Bind the signed object to this product's
  // creator, and reject path syntax that the storage HTTP client can normalize.
  if (segments.length < 2 || segments[0] !== creatorId) return null
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  if (/[\\?#\u0000-\u001F\u007F]/.test(objectPath) || /%[\da-f]{2}/i.test(objectPath)) return null
  return objectPath
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: purchase } = await supabase
    .from('purchases')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('product_id', productId)
    .eq('payment_status', VALID_PURCHASE_STATUS)
    .eq('stripe_livemode', true)
    .maybeSingle()

  if (!purchase) {
    return NextResponse.json({ error: 'Datei nicht verfügbar' }, { status: 404 })
  }

  const service = await createServiceClient()
  const { data: product } = await service
    .from('products')
    .select('file_url, creator_id')
    .eq('id', productId)
    .maybeSingle()
  if (!product?.file_url) {
    return NextResponse.json({ error: 'Datei nicht verfügbar' }, { status: 404 })
  }

  let objectPath: string | null = null
  try {
    objectPath = getProductObjectPath(product.file_url, product.creator_id)
  } catch {
    objectPath = null
  }
  if (!objectPath) {
    return NextResponse.json({ error: 'Ungültiger Dateipfad' }, { status: 500 })
  }

  const { data, error } = await service.storage.from('products').createSignedUrl(objectPath, 60)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Download konnte nicht erstellt werden' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
