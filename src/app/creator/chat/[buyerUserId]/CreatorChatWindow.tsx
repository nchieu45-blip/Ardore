'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Send, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface Message {
  id: string
  content: string
  sender_id: string
  created_at: string
  sender: { id: string; full_name: string | null; avatar_url: string | null } | null
}

interface Props {
  creatorId: string
  creatorUserId: string
  buyer: { id: string; full_name: string | null; avatar_url: string | null }
  currentUserId: string
  currentUserName: string | null
  currentUserAvatar: string | null
  initialMessages: Message[]
}

export default function CreatorChatWindow({
  creatorId,
  creatorUserId,
  buyer,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  initialMessages,
}: Props) {
  const supabase = createClient()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Mark thread as read whenever this window mounts
  useEffect(() => {
    fetch('/api/chat-last-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerUserId: buyer.id }),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel(`creator-chat-${creatorId}-${buyer.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `creator_id=eq.${creatorId}` },
        async (payload) => {
          const newMsg = payload.new as Message & { sender_id: string }
          // Only add if it's from the buyer we're currently chatting with
          if (newMsg.sender_id !== buyer.id) return
          if (newMsg.sender_id === currentUserId) return

          const { data: sender } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .eq('id', newMsg.sender_id)
            .single()

          setMessages((prev) => [...prev, { ...newMsg, sender }])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [creatorId, buyer.id, currentUserId, supabase])

  async function sendMessage() {
    if (!text.trim()) return
    setSending(true)

    const optimistic: Message = {
      id: crypto.randomUUID(),
      content: text.trim(),
      sender_id: currentUserId,
      created_at: new Date().toISOString(),
      sender: { id: currentUserId, full_name: currentUserName, avatar_url: currentUserAvatar },
    }
    setMessages((prev) => [...prev, optimistic])
    setText('')

    await supabase.from('messages').insert({
      sender_id: currentUserId,
      creator_id: creatorId,
      content: optimistic.content,
    })

    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const buyerName = buyer.full_name ?? 'Abonnent'

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <Link href="/creator/chat" className="text-gray-400 hover:text-gray-600 transition-colors mr-1">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Avatar src={buyer.avatar_url} name={buyerName} size="sm" />
        <div>
          <p className="font-semibold text-gray-900">{buyerName}</p>
          <p className="text-xs text-green-600">Abonnent</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">
            Noch keine Nachrichten. Schreibe die erste!
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId
          const senderName = msg.sender?.full_name ?? 'Unbekannt'

          return (
            <div key={msg.id} className={cn('flex items-end gap-2', isMe && 'flex-row-reverse')}>
              <Avatar src={msg.sender?.avatar_url} name={senderName} size="sm" className="flex-shrink-0" />
              <div className={cn(
                'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm',
                isMe
                  ? 'bg-green-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              )}>
                {msg.content}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nachricht schreiben..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 max-h-32"
          />
          <Button
            onClick={sendMessage}
            disabled={!text.trim() || sending}
            className="h-10 w-10 p-0 rounded-xl flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
