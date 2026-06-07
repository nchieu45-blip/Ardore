'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Trash2, ShoppingCart, ArrowRight, Package } from 'lucide-react'
import {
  subscribeCart, subscribeCartOpen, removeFromCart, clearCart, type CartItem,
} from '@/lib/cart'
import { formatCurrency } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

export default function CartDrawer() {
  const [open,    setOpen]    = useState(false)
  const [items,   setItems]   = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const unsubCart = subscribeCart(setItems)
    const unsubOpen = subscribeCartOpen(() => setOpen(true))
    return () => { unsubCart(); unsubOpen() }
  }, [])

  const total = items.reduce((sum, i) => sum + i.price, 0)

  async function handleCheckout() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(i => ({ productId: i.id })) }),
      })
      const data = await res.json()
      if (res.status === 401) {
        setOpen(false)
        router.push('/login')
        return
      }
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-[59] backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-[60] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <ShoppingCart className="h-5 w-5 text-gray-700" />
            <span className="font-semibold text-gray-900">Warenkorb</span>
            {items.length > 0 && (
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                {items.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
              <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
                <Package className="h-7 w-7 text-gray-300" />
              </div>
              <p className="text-gray-700 font-semibold mb-1">Dein Warenkorb ist leer</p>
              <p className="text-sm text-gray-400 mb-6">Füge Produkte aus dem Marketplace hinzu.</p>
              <button
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
              >
                Weiter einkaufen →
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 px-5 py-2">
              {items.map(item => (
                <li key={item.id} className="py-4 flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 shadow-sm">
                    {item.thumbnail_url ? (
                      <img
                        src={item.thumbnail_url}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                        <Package className="h-6 w-6 text-white/70" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-0.5">
                      {item.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.creatorName} · {TYPE_LABELS[item.type] ?? item.type}
                    </p>
                    <p className="text-sm font-bold text-green-700 mt-1">{formatCurrency(item.price)}</p>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    aria-label="Entfernen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Gesamt</span>
              <span className="text-xl font-bold text-gray-900">{formatCurrency(total)}</span>
            </div>
            <p className="text-[11px] text-gray-400">inkl. MwSt. · Einmalzahlung</p>

            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors shadow-sm"
            >
              {loading ? (
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Zur Kasse
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            <button
              onClick={clearCart}
              className="w-full text-center text-xs text-gray-400 hover:text-red-500 transition-colors py-1"
            >
              Warenkorb leeren
            </button>
          </div>
        )}
      </div>
    </>
  )
}
