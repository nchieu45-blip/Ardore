export interface ProductRating {
  avg: number
  count: number
}

interface ProductReviewRating {
  id: string
  product_id: string
  rating: number
}

const RATING_PRIOR_AVERAGE = 3.5
const RATING_PRIOR_WEIGHT = 3

export function productRatingScore(rating?: ProductRating): number {
  if (!rating || rating.count <= 0) return 0

  return (
    rating.avg * rating.count + RATING_PRIOR_AVERAGE * RATING_PRIOR_WEIGHT
  ) / (rating.count + RATING_PRIOR_WEIGHT)
}

export function compareProductRatings(a?: ProductRating, b?: ProductRating): number {
  const scoreDifference = productRatingScore(b) - productRatingScore(a)
  if (scoreDifference !== 0) return scoreDifference

  const averageDifference = (b?.avg ?? 0) - (a?.avg ?? 0)
  if (averageDifference !== 0) return averageDifference

  return (b?.count ?? 0) - (a?.count ?? 0)
}

export function aggregateProductRatings(rows: ProductReviewRating[]): Record<string, ProductRating> {
  const seenReviewIds = new Set<string>()
  const totals: Record<string, { sum: number; count: number }> = {}

  for (const row of rows) {
    if (seenReviewIds.has(row.id)) continue
    seenReviewIds.add(row.id)

    if (!totals[row.product_id]) totals[row.product_id] = { sum: 0, count: 0 }
    totals[row.product_id].sum += row.rating
    totals[row.product_id].count++
  }

  return Object.fromEntries(
    Object.entries(totals).map(([productId, { sum, count }]) => [
      productId,
      { avg: sum / count, count },
    ])
  )
}
