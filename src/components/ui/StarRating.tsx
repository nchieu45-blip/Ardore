import { Star } from 'lucide-react'

interface Props {
  rating: number
  count?: number
  size?: 'sm' | 'md'
}

export function StarRating({ rating, count, size = 'md' }: Props) {
  const cls = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const rounded = Math.round(rating)

  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        {[1, 2, 3, 4, 5].map(star => (
          <Star
            key={star}
            className={`${cls} ${star <= rounded ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-100'}`}
          />
        ))}
      </div>
      {count !== undefined && count > 0 && (
        <span className={`text-gray-500 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
          {rating.toFixed(1)} ({count})
        </span>
      )}
    </div>
  )
}
