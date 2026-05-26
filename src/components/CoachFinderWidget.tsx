'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, Loader2, User } from 'lucide-react'
import Link from 'next/link'
import { getInitials } from '@/lib/utils'

interface Coach {
  id: string
  display_name: string
  bio: string | null
  category: string | null
  avatar_url: string | null
  slug: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  coaches?: Coach[]
}

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  yoga: 'Yoga',
  mental: 'Mental Health',
  laufen: 'Laufen',
  abnehmen: 'Abnehmen',
  muskelaufbau: 'Muskelaufbau',
  allgemein: 'Gesundheit',
}

const QUICK_GOALS = ['Abnehmen', 'Muskelaufbau', 'Ernährung', 'Yoga & Meditation', 'Laufen']

export default function CoachFinderWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hallo! Ich helfe dir, den passenden Coach zu finden. Was ist dein Ziel?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function send(text: string) {
    if (!text.trim() || loading) return
    setInput('')

    const newMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('/api/coach-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.text ?? 'Entschuldigung, etwas ist schiefgelaufen.', coaches: data.coaches?.length ? data.coaches : undefined },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Verbindungsfehler. Bitte versuche es erneut.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-green-700 font-semibold rounded-full border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all shadow-sm text-base"
      >
        <Bot className="h-5 w-5" />
        KI-Coach-Finder
      </button>

      {/* Widget overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6 pointer-events-none">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col pointer-events-auto"
            style={{ height: '520px' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-green-600 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">KI-Coach-Finder</p>
                  <p className="text-green-100 text-xs">Finde deinen perfekten Coach</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-white/70 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="h-7 w-7 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-green-600" />
                    </div>
                  )}
                  <div className={`max-w-[80%] space-y-2`}>
                    <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-green-600 text-white rounded-tr-sm'
                        : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    }`}>
                      {msg.content}
                    </div>
                    {/* Coach cards */}
                    {msg.coaches && msg.coaches.length > 0 && (
                      <div className="space-y-2 mt-1">
                        {msg.coaches.map(coach => (
                          <Link
                            key={coach.id}
                            href={`/creators/${coach.slug}`}
                            className="block bg-white border border-gray-200 rounded-xl p-3 hover:border-green-400 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="h-9 w-9 rounded-full overflow-hidden bg-green-100 flex items-center justify-center flex-shrink-0">
                                {coach.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={coach.avatar_url} alt={coach.display_name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-xs font-semibold text-green-700">{getInitials(coach.display_name)}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 text-sm truncate">{coach.display_name}</p>
                                {coach.category && (
                                  <p className="text-xs text-green-600">{CATEGORY_LABELS[coach.category] ?? coach.category}</p>
                                )}
                              </div>
                              <span className="ml-auto text-xs text-green-600 font-medium flex-shrink-0">→</span>
                            </div>
                            {coach.bio && (
                              <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{coach.bio}</p>
                            )}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="h-7 w-7 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-2 justify-start">
                  <div className="h-7 w-7 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3.5 w-3.5 text-green-600" />
                  </div>
                  <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
                    <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Quick goals (only show at start) */}
            {messages.length === 1 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                {QUICK_GOALS.map(goal => (
                  <button
                    key={goal}
                    onClick={() => send(goal)}
                    className="px-3 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full hover:bg-green-100 transition-colors"
                  >
                    {goal}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-3 pb-3 pt-1 border-t border-gray-100">
              <form
                onSubmit={e => { e.preventDefault(); send(input) }}
                className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1.5"
              >
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Schreib dein Ziel..."
                  className="flex-1 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="h-7 w-7 bg-green-600 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity flex-shrink-0"
                >
                  <Send className="h-3.5 w-3.5 text-white" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
