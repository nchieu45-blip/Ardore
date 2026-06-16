'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Trash2, ShoppingCart, ArrowRight, Package, Tag, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react'
import {
  subscribeCart, subscribeCartOpen, removeFromCart, clearCart, type CartItem,
} from '@/lib/cart'
import { formatCurrency } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF', video: 'Video', course: 'Kurs', image: 'Bild',
}

interface DiscountResult {
  id: string
  code: string | null
  type: 'percent' | 'fixed'
  value: number
  applies_to: string
  savingsCents: number
}

export default function CartDrawer() {
  const [open,          setOpen]          = useState(false)
  const [items,         setItems]         = useState<CartItem[]>([])
  const [loading,       setLoading]       = useState(false)
  const [voucher,       setVoucher]       = useState('')
  const [codeDiscount,  setCodeDiscount]  = useState<DiscountResult | null>(null)
  const [autoDiscount,  setAutoDiscount]  = useState<DiscountResult | null>(null)
  const [discountError, setDiscountError] = useState('')
  const [voucherLoading,setVoucherLoading]= useState(false)
  const router = useRouter()

  useEffect(() => {
    const unsubCart = subscribeCart(setItems)
    const unsubOpen = subscribeCartOpen(() => setOpen(true))
    return () => { unsubCart(); unsubOpen() }
  }, [])

  // Check for automatic discounts whenever cart items change
  const checkAutoDiscount = useCallback(async (cartItems: CartItem[]) => {
    if (cartItems.length === 0) { setAutoDiscount(null); return }
    const creatorIds = [...new Set(cartItems.map(i => i.creatorId))]
    if (creatorIds.length !== 1) { setAutoDiscount(null); return }
    const totalCents = cartItems.reduce((sum, i) => sum + Math.round(i.price * 100), 0)
    try {
      const res = await fetch(`/api/discounts/validate?creatorId=${creatorIds[0]}&type=products&amount=${totalCents}`)
      const d = await res.json() as { valid: boolean; discount?: DiscountResult['id'] extends string ? { id: string; code: string | null; type: 'percent' | 'fixed'; value: number; applies_to: string } : never; savingsCents?: number }
      if (d.valid && d.discount && d.discount.code === null) {
        setAutoDiscount({ ...d.discount, savingsCents: d.savingsCents ?? 0 })
      } else {
        setAutoDiscount(null)
      }
    } catch {
      setAutoDiscount(null)
    }
  }, [])

  useEffect(() => {
    checkAutoDiscount(items)
    // reset code discount when cart changes
    setCodeDiscount(null)
    setVoucher('')
    setDiscountError('')
  }, [items, checkAutoDiscount])

  async function applyVoucher() {
    const trimmed = voucher.trim().toUpperCase()
    if (!trimmed) return
    const creatorIds = [...new Set(items.map(i => i.creatorId))]
    if (creatorIds.length !== 1) {
      setDiscountError('Gutscheincode gilt nur für Käufe bei einem einzigen Coach.')
      return
    }
    const totalCents = items.reduce((sum, i) => sum + Math.round(i.price * 100), 0)
    setVoucherLoading(true)
    setDiscountError('')
    try {
      const res = await fetch(`/api/discounts/validate?creatorId=${creatorIds[0]}&type=products&code=${encodeURIComponent(trimmed)}&amount=${totalCents}`)
      const d = await res.json() as { valid: boolean; discount?: { id: string; code: string | null; type: 'percent' | 'fixed'; value: number; applies_to: string }; savingsCents?: number; error?: string }
      if (d.valid && d.discount) {
        setCodeDiscount({ ...d.discount, savingsCents: d.savingsCents ?? 0 })
        setDiscountError('')
      } else {
        setDiscountError(d.error ?? 'Ungültiger Code')
        setCodeDiscount(null)
      }
    } catch {
      setDiscountError('Netzwerkfehler beim Prüfen')
    } finally {
      setVoucherLoading(false)
    }
  }

  const effectiveDiscount = codeDiscount ?? (codeDiscount === null ? autoDiscount : null)
  const subtotalCents     = items.reduce((sum, i) => sum + Math.round(i.price * 100), 0)
  const savingsCents      = effectiveDiscount?.savingsCents ?? 0
  const totalCents        = Math.max(0, subtotalCents - savingsCents)
  const singleCreator     = [...new Set(items.map(i => i.creatorId))].length === 1

  async function handleCheckout() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items:      items.map(i => ({ productId: i.id })),
          discountId: effectiveDiscount?.id ?? null,
        }),
      })
      const data = await res.json()
      if (res.status === 401) { setOpen(false); router.push('/login'); return }
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-[59] backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      <div className={`fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-[60] flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
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
              <button onClick={() => setOpen(false)} className="text-sm font-medium text-green-600 hover:text-green-700 transition-colors">
                Weiter einkaufen →
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 px-5 py-2">
              {items.map(item => (
                <li key={item.id} className="py-4 flex items-start gap-3">
                  <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 shadow-sm">
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                        <Package className="h-6 w-6 text-white/70" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-0.5">{item.title}</p>
                    <p className="text-xs text-gray-400">{item.creatorName} · {TYPE_LABELS[item.type] ?? item.type}</p>
                    <p className="text-sm font-bold text-green-700 mt-1">{formatCurrency(item.price)}</p>
                  </div>
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
            {/* Auto-discount banner */}
            {autoDiscount && !codeDiscount && (
              <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-100 px-3 py-2 rounded-xl">
                <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Automatischer Rabatt angewendet:&nbsp;
                  <strong>
                    {autoDiscount.type === 'percent' ? `${autoDiscount.value} %` : formatCurrency(autoDiscount.value / 100)} Rabatt
                  </strong>
                </span>
              </div>
            )}

            {/* Voucher code input — only for single-creator carts */}
            {singleCreator && !autoDiscount && (
              <div className="space-y-1.5">
                {codeDiscount ? (
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Code <strong>{codeDiscount.code}</strong> angewendet</span>
                    </div>
                    <button
                      onClick={() => { setCodeDiscount(null); setVoucher('') }}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input
                        value={voucher}
                        onChange={e => { setVoucher(e.target.value.toUpperCase()); setDiscountError('') }}
                        onKeyDown={e => e.key === 'Enter' && applyVoucher()}
                        placeholder="Gutscheincode"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono tracking-wider"
                      />
                    </div>
                    <button
                      onClick={applyVoucher}
                      disabled={!voucher.trim() || voucherLoading}
                      className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                    >
                      {voucherLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Anwenden'}
                    </button>
                  </div>
                )}
                {discountError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {discountError}
                  </div>
                )}
              </div>
            )}

            {/* Price breakdown */}
            {savingsCents > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Zwischensumme</span>
                  <span className="line-through text-gray-400">{formatCurrency(subtotalCents / 100)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-green-700 font-medium">
                  <span>Rabatt</span>
                  <span>−{formatCurrency(savingsCents / 100)}</span>
                </div>
                <div className="flex items-center justify-between font-bold text-gray-900 text-lg pt-1 border-t border-gray-100">
                  <span>Gesamt</span>
                  <span>{formatCurrency(totalCents / 100)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Gesamt</span>
                <span className="text-xl font-bold text-gray-900">{formatCurrency(subtotalCents / 100)}</span>
              </div>
            )}

            <p className="text-[11px] text-gray-400">inkl. MwSt. · Einmalzahlung</p>

            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors shadow-sm"
            >
              {loading ? (
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Zur Kasse <ArrowRight className="h-4 w-4" /></>
              )}
            </button>

            <button onClick={clearCart} className="w-full text-center text-xs text-gray-400 hover:text-red-500 transition-colors py-1">
              Warenkorb leeren
            </button>
          </div>
        )}
      </div>
    </>
  )
}
