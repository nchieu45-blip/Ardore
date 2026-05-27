'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { StarRating } from '@/components/ui/StarRating'

interface ReviewProfile {
  full_name: string | null
  avatar_url: string | null
}

interface ReviewData {
  id: string
  product_id: string
  buyer_id: string
  rating: number
  content: string | null
  created_at: string
  profiles: ReviewProfile | null
}

interface Props {
  productId: string
  reviews: ReviewData[]
  hasPurchased: boolean
  currentUserId: string | null
  currentUserName: string | null
  currentUserAvatar: string | null
}

export default function ReviewSection({
  productId,
  reviews: initialReviews,
  hasPurchased,
  currentUserId,
  currentUserName,
  currentUserAvatar,
}: Props) {
  const [reviews, setReviews] = useState(initialReviews)
  const [showAll, setShowAll] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [hoverRating, setHoverRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const myReview = reviews.find(r => r.buyer_id === currentUserId) ?? null

  const [rating, setRating] = useState(myReview?.rating ?? 0)
  const [content, setContent] = useState(myReview?.content ?? '')

  const visibleReviews = showAll ? reviews : reviews.slice(0, 3)

  function openForm(existing?: ReviewData) {
    setRating(existing?.rating ?? 0)
    setContent(existing?.content ?? '')
    setError('')
    setShowForm(true)
  }

  async function handleSubmit() {
    if (rating === 0) {
      setError('Bitte wähle eine Bewertung aus')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, rating, content }),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.error || 'Fehler beim Speichern')
        return
      }
      const { review } = await res.json()
      setReviews(prev => {
        const without = prev.filter(r => r.buyer_id !== currentUserId)
        return [
          {
            ...review,
            profiles: { full_name: currentUserName, avatar_url: currentUserAvatar },
          },
          ...without,
        ]
      })
      setShowForm(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (reviews.length === 0 && !hasPurchased) return null

  return (
    <div className="px-5 pb-5 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-600">
          Bewertungen{reviews.length > 0 ? ` (${reviews.length})` : ''}
        </span>
        {hasPurchased && !showForm && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openForm(myReview ?? undefined)}
          >
            {myReview ? 'Bearbeiten' : 'Bewertung schreiben'}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <div className="flex gap-1 mb-3">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
              >
                <Star
                  className={`h-6 w-6 transition-colors ${
                    star <= (hoverRating || rating)
                      ? 'text-amber-400 fill-amber-400'
                      : 'text-gray-300 fill-gray-100'
                  }`}
                />
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Erfahrungsbericht schreiben (optional)..."
            className="w-full text-sm border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
            rows={3}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={handleSubmit} loading={submitting}>
              Speichern
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="text-xs text-gray-400">Noch keine Bewertungen.</p>
      ) : (
        <>
          <div className="space-y-3">
            {visibleReviews.map(review => (
              <div key={review.id} className="flex gap-2.5">
                <Avatar
                  src={review.profiles?.avatar_url ?? null}
                  name={review.profiles?.full_name ?? 'Anonym'}
                  size="sm"
                  className="h-7 w-7 text-xs flex-shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-700">
                      {review.profiles?.full_name ?? 'Anonym'}
                    </span>
                    <StarRating rating={review.rating} size="sm" />
                  </div>
                  {review.content && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      {review.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {reviews.length > 3 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="text-xs text-green-600 mt-3 hover:underline"
            >
              {showAll ? 'Weniger anzeigen' : `Alle ${reviews.length} Bewertungen anzeigen`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
