export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

type Listener = (toasts: ToastItem[]) => void

let _toasts: ToastItem[] = []
const _listeners = new Set<Listener>()

function _notify() {
  _listeners.forEach(fn => fn([..._toasts]))
}

function _add(type: ToastType, message: string, duration = 4000) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  _toasts = [..._toasts, { id, message, type }]
  _notify()
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id)
    _notify()
  }, duration)
}

export const toast = {
  success: (message: string) => _add('success', message),
  error:   (message: string) => _add('error', message, 5000),
  info:    (message: string) => _add('info', message),
  warning: (message: string) => _add('warning', message, 5000),
}

export function subscribeToasts(fn: Listener): () => void {
  _listeners.add(fn)
  fn([..._toasts])
  return () => { _listeners.delete(fn) }
}
