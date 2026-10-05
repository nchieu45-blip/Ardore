'use client'

import { useEffect, useState } from 'react'
import { subscribeToasts, type ToastItem } from '@/lib/toast'
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

const CONFIG = {
  success: { icon: CheckCircle2,   color: 'text-green-600',  bg: 'bg-white border-green-200' },
  error:   { icon: XCircle,        color: 'text-red-500',    bg: 'bg-white border-red-200' },
  info:    { icon: Info,            color: 'text-blue-500',   bg: 'bg-white border-blue-200' },
  warning: { icon: AlertTriangle,   color: 'text-amber-500',  bg: 'bg-white border-amber-200' },
}

function Toast({ toast }: { toast: ToastItem }) {
  const { icon: Icon, color, bg } = CONFIG[toast.type]
  return (
    <div className={cn(
      'surface-elevated flex items-start gap-3 px-4 py-3',
      'w-full max-w-sm animate-slide-up-sm pointer-events-auto',
      bg
    )}>
      <Icon className={cn('h-5 w-5 flex-shrink-0', color)} />
      <p className="text-sm text-gray-800 font-medium leading-snug">{toast.message}</p>
    </div>
  )
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => <Toast key={t.id} toast={t} />)}
    </div>
  )
}
