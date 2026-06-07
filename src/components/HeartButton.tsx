'use client'

import { Heart } from 'lucide-react'
import { useFavorites } from '@/components/FavoritesProvider'
import { toast } from '@/lib/toast'

interface HeartButtonProps {
  type: 'product' | 'coach'
  itemId: string
  className?: string
}

export default function HeartButton({ type, itemId, className = '' }: HeartButtonProps) {
  const ctx = useFavorites()
  if (!ctx?.hasUser) return null

  const { isFavorited, toggle } = ctx
  const favorited = isFavorited(type, itemId)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    await toggle(type, itemId)
    toast.success(favorited ? 'Aus Favoriten entfernt' : 'Zu Favoriten hinzugefügt')
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center justify-center h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-sm hover:bg-white transition-all ${className}`}
      aria-label={favorited ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
    >
      <Heart
        className={`h-3.5 w-3.5 transition-colors ${
          favorited ? 'fill-red-500 text-red-500' : 'text-gray-500'
        }`}
      />
    </button>
  )
}
