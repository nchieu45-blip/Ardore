'use client'

import { useState, useEffect, useRef } from 'react'
import { Star, CheckCircle2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  bookingId: string
  coachName: string
  existingReview?: { rating: number; content: string | null } | null
  autoOpen?: boolean
}

const STAR_LABELS = ['', 'Nicht gut', 'Okay', 'Gut', 'Sehr gut', 'Ausgezeichnet']

export default function SessionReviewPrompt({ bookingId, coachName, existingReview, autoOpen }: Props) {
  const [open, setOpen] = useState(!!(autoOpen || existingReview))
  const [rating, setRating] = useState(existingReview?.rating ?? 0)
  const [hovered, setHovered] = useState(0)
  const [content, setContent] = useState(existingReview?.content ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(!!existingReview)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoOpen && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [autoOpen])

  if (submitted && !open) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-xl px-4 py-2.5 border border-green-100">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span>Du hast diese Session bewertet</span>
        <div className="flex ml-auto gap-0.5">
          {[1, 2, 3, 4, 5].map(s => (
            <Star key={s} className={`h-3 w-3 ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-100'}`} />
          ))}
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full flex items-center justify-between gap-2 text-sm text-gray-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl px-4 py-2.5 transition-colors"
      >
        <span className="font-medium">Wie war deine Session? Jetzt bewerten</span>
        <ChevronDown className="h-4 w-4 text-amber-500 flex-shrink-0" />
      </button>
    )
  }

  async function handleSubmit() {
    if (!rating) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/session-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, rating, content }),
      })
      if (res.ok) {
        setSubmitted(true)
        setOpen(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const displayRating = hovered || rating

  return (
    <div ref={ref} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-medium text-gray-900 mb-3 text-sm">
        Wie war deine Session mit {coachName}?
      </p>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(s)}
              className="transition-transform hover:scale-110 focus:outline-none"
            >
              <Star
                className={`h-7 w-7 transition-colors ${
                  s <= displayRating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-100'
                }`}
              />
            </button>
          ))}
        </div>
        {displayRating > 0 && (
          <span className="text-sm text-amber-700 font-medium">{STAR_LABELS[displayRating]}</span>
        )}
      </div>

      {rating > 0 && (
        <>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Optionaler Kommentar (wird öffentlich auf dem Coach-Profil angezeigt)…"
            rows={3}
            className="w-full text-sm rounded-xl border border-gray-200 bg-white px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 mb-3"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? 'Wird gespeichert…' : 'Bewertung abgeben'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Abbrechen
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
