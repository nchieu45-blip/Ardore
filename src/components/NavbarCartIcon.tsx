'use client'

import { useEffect, useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { subscribeCart, openCart, type CartItem } from '@/lib/cart'

export default function NavbarCartIcon() {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    return subscribeCart(setItems)
  }, [])

  const count = items.length

  return (
    <button
      onClick={openCart}
      className="relative p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all focus:outline-none"
      aria-label="Warenkorb"
    >
      <ShoppingCart className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-green-600 text-white text-[9px] font-bold flex items-center justify-center leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
