'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, User, RotateCcw } from 'lucide-react'
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
  mental: 'Mental Health',
  abnehmen: 'Abnehmen',
  schlaf: 'Schlaf',
  yoga: 'Yoga',
  laufen: 'Laufen',
  krafttraining: 'Krafttraining',
  meditation: 'Meditation',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft & Postnatal',
  mobility: 'Mobility & Dehnen',
}

const QUICK_GOALS = ['Abnehmen', 'Krafttraining', 'Ernährung', 'Mental Health', 'Yoga']

const TYPING_GOALS = [
  'Ich will 5 kg abnehmen …',
  'Ich will besser schlafen …',
  'Ich will Muskeln aufbauen …',
  'Ich will Stress abbauen …',
]

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: 'Was ist dein Ziel? Ich finde den passenden Coach für dich.',
}

export default function CoachFinderWidget() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [typedPlaceholder, setTypedPlaceholder] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const hasConversation = messages.length > 1

  useEffect(() => {
    if (hasConversation || inputFocused || input) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let goalIdx = 0
    let charIdx = 0
    let deleting = false
    let timerId: ReturnType<typeof setTimeout>

    function tick() {
      const goal = TYPING_GOALS[goalIdx]
      if (!deleting) {
        charIdx++
        setTypedPlaceholder(goal.slice(0, charIdx))
        if (charIdx === goal.length) {
          deleting = true
          timerId = setTimeout(tick, 1600)
        } else {
          timerId = setTimeout(tick, 55)
        }
      } else {
        charIdx--
        setTypedPlaceholder(goal.slice(0, charIdx))
        if (charIdx === 0) {
          deleting = false
          goalIdx = (goalIdx + 1) % TYPING_GOALS.length
          timerId = setTimeout(tick, 400)
        } else {
          timerId = setTimeout(tick, 28)
        }
      }
    }

    timerId = setTimeout(tick, 1200)
    return () => clearTimeout(timerId)
  }, [hasConversation, inputFocused, input])

  useEffect(() => {
    if (hasConversation) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, hasConversation])

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
        {
          role: 'assistant',
          content: data.text ?? 'Entschuldigung, etwas ist schiefgelaufen.',
          coaches: data.coaches?.length ? data.coaches : undefined,
        },
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

  function reset() {
    setMessages([INITIAL_MESSAGE])
    setInput('')
  }

  return (
    <div className="w-full max-w-xl mx-auto bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg overflow-hidden border border-white/60">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 bg-green-100 rounded-full flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-green-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">KI-Coach-Finder</span>
          <span className="text-xs text-gray-400 hidden sm:inline">— Finde deinen Coach per Chat</span>
        </div>
        {hasConversation && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Neu
          </button>
        )}
      </div>

      {/* Messages (only shown once conversation started) */}
      {hasConversation && (
        <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/50">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="h-6 w-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="h-3 w-3 text-green-600" />
                </div>
              )}
              <div className="max-w-[82%] space-y-2">
                <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-green-600 text-white rounded-tr-sm'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.content}
                </div>
                {msg.coaches && msg.coaches.length > 0 && (
                  <div className="space-y-1.5">
                    {msg.coaches.map(coach => (
                      <Link
                        key={coach.id}
                        href={`/creators/${coach.slug}`}
                        className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl p-2.5 hover:border-green-400 hover:shadow-sm transition-all"
                      >
                        <div className="h-8 w-8 rounded-full overflow-hidden bg-green-100 flex items-center justify-center flex-shrink-0">
                          {coach.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coach.avatar_url} alt={coach.display_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold text-green-700">{getInitials(coach.display_name)}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 text-xs truncate">{coach.display_name}</p>
                          {coach.category && (
                            <p className="text-[11px] text-green-600">{CATEGORY_LABELS[coach.category] ?? coach.category}</p>
                          )}
                        </div>
                        <span className="text-xs text-green-600 flex-shrink-0">→</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="h-6 w-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="h-3 w-3 text-gray-500" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className="h-6 w-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot className="h-3 w-3 text-green-600" />
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Initial greeting (shown before conversation starts) */}
      {!hasConversation && (
        <div className="px-4 pt-3 pb-1">
          <p className="text-sm text-gray-600">{INITIAL_MESSAGE.content}</p>
        </div>
      )}

      {/* Quick goals (only before first user message) */}
      {messages.length === 1 && (
        <div className="px-4 py-2 flex flex-wrap gap-1.5">
          {QUICK_GOALS.map((goal, idx) => (
            <button
              key={goal}
              onClick={() => send(goal)}
              disabled={loading}
              style={{ animationDelay: `${0.95 + idx * 0.07}s` }}
              className="hero-rise hp-chip px-3 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full hover:bg-green-100 transition-colors disabled:opacity-50"
            >
              {goal}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2">
        <form
          onSubmit={e => { e.preventDefault(); send(input) }}
          className="flex items-center gap-2 bg-gray-100 rounded-full px-3.5 py-2"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={inputFocused || input ? 'Beschreib dein Ziel…' : (typedPlaceholder || 'Beschreib dein Ziel…')}
            className="flex-1 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="h-6 w-6 bg-green-600 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity flex-shrink-0"
          >
            <Send className="h-3 w-3 text-white" />
          </button>
        </form>
      </div>
    </div>
  )
}
