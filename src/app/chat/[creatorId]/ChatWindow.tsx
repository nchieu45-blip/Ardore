'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface Message {
  id: string
  content: string
  sender_id: string
  created_at: string
  sender: { id: string; full_name: string | null; avatar_url: string | null } | null
}

interface ChatWindowProps {
  creatorId: string
  creator: { id: string; display_name: string; slug: string; avatar_url: string | null }
  currentUser: { id: string; full_name: string | null; avatar_url: string | null } | null
  initialMessages: Message[]
}

export default function ChatWindow({ creatorId, creator, currentUser, initialMessages }: ChatWindowProps) {
  const supabase = createClient()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const channel = supabase
      .channel(`chat-${creatorId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `creator_id=eq.${creatorId}` },
        async (payload) => {
          const newMsg = payload.new as Message & { sender_id: string }
          if (newMsg.sender_id === currentUser?.id) return // already added optimistically

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
  }, [creatorId, currentUser?.id, supabase])

  async function sendMessage() {
    if (!text.trim() || !currentUser) return
    setSending(true)

    const optimistic: Message = {
      id: crypto.randomUUID(),
      content: text.trim(),
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      sender: { id: currentUser.id, full_name: currentUser.full_name, avatar_url: currentUser.avatar_url },
    }
    setMessages((prev) => [...prev, optimistic])
    setText('')

    await supabase.from('messages').insert({
      sender_id: currentUser.id,
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

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <Avatar src={creator.avatar_url} name={creator.display_name} size="sm" />
        <div>
          <Link href={`/creators/${creator.slug}`} className="font-semibold text-gray-900 hover:text-green-600">
            {creator.display_name}
          </Link>
          <p className="text-xs text-green-600">Abonnenten-Chat</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">
            Noch keine Nachrichten. Schreibe die erste!
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUser?.id
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

      {/* Input */}
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
