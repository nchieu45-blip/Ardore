'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface FavoritesContextValue {
  isFavorited: (type: 'product' | 'coach', id: string) => boolean
  toggle: (type: 'product' | 'coach', id: string) => Promise<void>
  hasUser: boolean
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function useFavorites() {
  return useContext(FavoritesContext)
}

export function FavoritesProvider({
  userId,
  children,
}: {
  userId: string | null
  children: React.ReactNode
}) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const supabase = createClient()

  useEffect(() => {
    if (!userId) return
    supabase
      .from('favorites')
      .select('item_type, item_id')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (data) {
          setFavorites(
            new Set(
              (data as { item_type: string; item_id: string }[]).map(
                f => `${f.item_type}:${f.item_id}`
              )
            )
          )
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const isFavorited = useCallback(
    (type: 'product' | 'coach', id: string) => favorites.has(`${type}:${id}`),
    [favorites]
  )

  const toggle = useCallback(
    async (type: 'product' | 'coach', id: string) => {
      if (!userId) return
      const key = `${type}:${id}`
      const wasFav = favorites.has(key)

      setFavorites(prev => {
        const next = new Set(prev)
        wasFav ? next.delete(key) : next.add(key)
        return next
      })

      try {
        if (wasFav) {
          await supabase
            .from('favorites')
            .delete()
            .eq('user_id', userId)
            .eq('item_type', type)
            .eq('item_id', id)
        } else {
          await supabase
            .from('favorites')
            .insert({ user_id: userId, item_type: type, item_id: id })
        }
      } catch {
        setFavorites(prev => {
          const next = new Set(prev)
          wasFav ? next.add(key) : next.delete(key)
          return next
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites, userId]
  )

  return (
    <FavoritesContext.Provider value={{ isFavorited, toggle, hasUser: !!userId }}>
      {children}
    </FavoritesContext.Provider>
  )
}
