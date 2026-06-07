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

const CART_KEY = 'ardore_cart'
const OPEN_EVENT = 'ardore:cart:open'

type Listener = (items: CartItem[]) => void
const _listeners = new Set<Listener>()

function _load(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]')
  } catch {
    return []
  }
}

function _save(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items))
  _listeners.forEach(fn => fn([...items]))
}

export function addToCart(item: CartItem): boolean {
  const items = _load()
  if (items.some(i => i.id === item.id)) return false
  _save([...items, item])
  return true
}

export function removeFromCart(id: string) {
  _save(_load().filter(i => i.id !== id))
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
  return () => _listeners.delete(fn)
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
