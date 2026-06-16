'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Runs once on the initial page load (root layout, never unmounts).
 * Detects a broken or corrupted Supabase session stored in the browser —
 * e.g. a partial write after a failed registration — and clears it before
 * it can crash the app.
 */
export default function SessionGuard() {
  useEffect(() => {
    function handler(event: PromiseRejectionEvent) {
      event.preventDefault()
      console.error('[SessionGuard] Unhandled promise rejection caught:', event.reason)
    }
    window.addEventListener('unhandledrejection', handler)
    return () => window.removeEventListener('unhandledrejection', handler)
  }, [])

  useEffect(() => {
    async function guard() {
      let supabase: ReturnType<typeof createClient> | null = null
      try {
        supabase = createClient()
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.log('[SessionGuard] session error, clearing:', error.message)
          await supabase.auth.signOut().catch(() => {})
          window.location.href = '/login'
          return
        }

        // Session object present but user is missing — corrupted/partial state
        if (data.session && !data.session.user) {
          console.log('[SessionGuard] session without user, clearing')
          await supabase.auth.signOut().catch(() => {})
          window.location.href = '/login'
        }
      } catch (err) {
        console.log('[SessionGuard] unexpected error, clearing session:', err)
        if (supabase) await supabase.auth.signOut().catch(() => {})
        window.location.href = '/login'
      }
    }
    guard()
  }, [])

  return null
}
