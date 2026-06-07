'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, Calendar, CheckCircle2, Users, MessageCircle, Clock, Star,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  new_booking:       <Calendar      className="h-4 w-4 text-green-600" />,
  booking_confirmed: <CheckCircle2  className="h-4 w-4 text-green-600" />,
  new_subscriber:    <Users         className="h-4 w-4 text-purple-600" />,
  new_message:       <MessageCircle className="h-4 w-4 text-blue-600" />,
  session_reminder:  <Clock         className="h-4 w-4 text-amber-600" />,
  new_review:        <Star          className="h-4 w-4 text-amber-600" />,
}

const TYPE_BG: Record<string, string> = {
  new_booking:       'bg-green-50',
  booking_confirmed: 'bg-green-50',
  new_subscriber:    'bg-purple-50',
  new_message:       'bg-blue-50',
  session_reminder:  'bg-amber-50',
  new_review:        'bg-amber-50',
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'Gerade eben'
  if (mins < 60)  return `vor ${mins} Min.`
  const h = Math.floor(mins / 60)
  if (h < 24)     return `vor ${h} Std.`
  const d = Math.floor(h / 24)
  return `vor ${d} Tag${d !== 1 ? 'en' : ''}`
}

export default function NavbarNotificationBell({ userId }: { userId: string }) {
  const [open,          setOpen]          = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading,       setLoading]       = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router      = useRouter()
  const supabase    = createClient()

  const unreadCount = notifications.filter(n => !n.read).length

  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, message, link, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications((data ?? []) as Notification[])
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    fetchNotifications()

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications(prev => [payload.new as Notification, ...prev.slice(0, 19)])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, userId, fetchNotifications])

  useEffect(() => {
    if (!open) return
    function onOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [open])

  async function markRead(n: Notification) {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
    }
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all focus:outline-none"
        aria-label="Benachrichtigungen"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">Benachrichtigungen</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
              >
                Alle als gelesen markieren
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[26rem] overflow-y-auto divide-y divide-gray-50">
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-400">Lädt…</div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Keine Benachrichtigungen</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={cn(
                    'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors',
                    !n.read && 'bg-blue-50/30'
                  )}
                >
                  <div className={cn(
                    'h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                    TYPE_BG[n.type] ?? 'bg-gray-50'
                  )}>
                    {TYPE_ICON[n.type] ?? <Bell className="h-4 w-4 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-900 leading-snug">{n.title}</p>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5 whitespace-nowrap">
                        {relativeTime(n.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                  </div>
                  {!n.read && (
                    <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-2.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
