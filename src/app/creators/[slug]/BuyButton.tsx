'use client'

import AddToCartButton from '@/components/AddToCartButton'
import type { CartItem } from '@/lib/cart'

interface BuyButtonProps {
  productId: string
  price: number
  title: string
  type: CartItem['type']
  thumbnailUrl?: string | null
  creatorId: string
  creatorName: string
  creatorSlug: string
  isDemo?: boolean
}

export default function BuyButton({
  productId, price, title, type, thumbnailUrl, creatorId, creatorName, creatorSlug, isDemo = false,
}: BuyButtonProps) {
  return (
    <AddToCartButton
      size="sm"
      item={{ id: productId, price, title, type, thumbnail_url: thumbnailUrl ?? null, creatorId, creatorName, creatorSlug }}
      isDemo={isDemo}
    />
  )
}
