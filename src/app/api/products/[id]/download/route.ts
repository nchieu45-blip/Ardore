import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const PRODUCT_OBJECT_MARKERS = [
  '/storage/v1/object/public/products/',
  '/storage/v1/object/sign/products/',
  '/storage/v1/object/authenticated/products/',
]

function getProductObjectPath(fileUrl: string): string | null {
  const url = new URL(fileUrl)
  const marker = PRODUCT_OBJECT_MARKERS.find((candidate) => url.pathname.includes(candidate))
  if (!marker) return null
  const encodedPath = url.pathname.split(marker)[1]
  return encodedPath ? decodeURIComponent(encodedPath) : null
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
    .maybeSingle()

  if (!purchase) {
    return NextResponse.json({ error: 'Datei nicht verfügbar' }, { status: 404 })
  }

  const service = await createServiceClient()
  const { data: product } = await service
    .from('products')
    .select('file_url')
    .eq('id', productId)
    .maybeSingle()
  if (!product?.file_url) {
    return NextResponse.json({ error: 'Datei nicht verfügbar' }, { status: 404 })
  }

  let objectPath: string | null = null
  try {
    objectPath = getProductObjectPath(product.file_url)
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
