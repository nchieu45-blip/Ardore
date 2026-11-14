export interface CartItem {
  id: string
  title: string
  type: 'pdf' | 'video' | 'course' | 'image'
  price: number
  thumbnail_url: string | null
  creatorId: string
  creatorName: string
  creatorSlug: string
}

export const MAX_CART_ITEMS = 50
export const MIXED_CART_MESSAGE = 'Kaufe Produkte von verschiedenen Coaches getrennt.'

const CART_KEY = 'ardore_cart'
const OPEN_EVENT = 'ardore:cart:open'

type Listener = (items: CartItem[]) => void
const _listeners = new Set<Listener>()

function _load(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string') : []
  } catch {
    return []
  }
}

function _save(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items))
  _listeners.forEach(fn => fn([...items]))
}

export function addToCart(item: CartItem): 'added' | 'duplicate' | 'different_coach' | 'full' {
  const items = _load()
  if (items.some(i => i.id === item.id)) return 'duplicate'
  if (!item.creatorId || items.some(i => i.creatorId !== item.creatorId)) return 'different_coach'
  if (items.length >= MAX_CART_ITEMS) return 'full'
  _save([...items, item])
  return 'added'
}

export function removeFromCart(id: string) {
  _save(_load().filter(i => i.id !== id))
}

export function removePurchasedFromCart(productIds: string[]) {
  const purchased = new Set(productIds.filter(id => typeof id === 'string'))
  const items = _load()
  const remaining = items.filter(item => !purchased.has(item.id))
  if (remaining.length !== items.length) _save(remaining)
}

export function clearCart() {
  _save([])
}

export function isInCart(id: string): boolean {
  return _load().some(i => i.id === id)
}

export function getCart(): CartItem[] {
  return _load()
}

export function subscribeCart(fn: Listener): () => void {
  _listeners.add(fn)
  fn(_load())
  const onStorage = (event: StorageEvent) => { if (event.key === CART_KEY || event.key === null) fn(_load()) }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => { _listeners.delete(fn); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage) }
}

export function openCart() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_EVENT))
  }
}

export function subscribeCartOpen(fn: () => void): () => void {
  window.addEventListener(OPEN_EVENT, fn)
  return () => window.removeEventListener(OPEN_EVENT, fn)
}
