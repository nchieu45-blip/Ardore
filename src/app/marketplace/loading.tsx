import { ProductCardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div>
      {/* Hero skeleton */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="h-4 w-40 bg-white/20 rounded-full mx-auto animate-pulse" />
          <div className="h-10 w-80 bg-white/20 rounded-xl mx-auto animate-pulse" />
          <div className="h-13 max-w-xl w-full mx-auto bg-white/20 rounded-2xl animate-pulse" />
        </div>
      </div>
      {/* Filter bar skeleton */}
      <div className="border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-7 w-20 bg-gray-200 rounded-full animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
      {/* Results */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
