'use client'

import { useEffect, useState } from 'react'
import { ShoppingCart, Check } from 'lucide-react'
import { addToCart, isInCart, openCart, type CartItem } from '@/lib/cart'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface Props {
  item: CartItem
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function AddToCartButton({ item, size = 'md', className }: Props) {
  const [inCart, setInCart] = useState(false)

  useEffect(() => {
    setInCart(isInCart(item.id))
  }, [item.id])

  function handleClick() {
    if (inCart) {
      openCart()
      return
    }
    const added = addToCart(item)
    if (added) {
      setInCart(true)
      toast.success(`„${item.title}" zum Warenkorb hinzugefügt`)
      openCart()
    }
  }

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-3 text-sm gap-2 w-full justify-center',
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'inline-flex items-center rounded-xl font-semibold transition-all',
        sizeClasses[size],
        inCart
          ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
          : 'bg-green-600 text-white hover:bg-green-700 shadow-sm',
        className
      )}
    >
      {inCart ? (
        <>
          <Check className="h-3.5 w-3.5 flex-shrink-0" />
          Im Warenkorb
        </>
      ) : (
        <>
          <ShoppingCart className="h-3.5 w-3.5 flex-shrink-0" />
          In den Warenkorb
        </>
      )}
    </button>
  )
}
