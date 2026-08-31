import { ProductCardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50/60" aria-busy="true" aria-label="Marktplatz wird geladen">
      {/* Hero skeleton */}
      <div className="bg-gradient-to-br from-green-950 via-green-900 to-green-800 px-4 py-8 sm:py-10 lg:py-12">
        <div className="max-w-3xl mx-auto text-center space-y-3">
          <div className="h-6 w-32 bg-white/15 rounded-full mx-auto animate-pulse" />
          <div className="h-8 sm:h-10 w-64 sm:w-80 max-w-full bg-white/20 rounded-xl mx-auto animate-pulse" />
          <div className="h-4 w-56 bg-white/15 rounded-full mx-auto animate-pulse" />
          <div className="h-11 sm:h-12 max-w-xl w-full mx-auto bg-white/90 rounded-2xl animate-pulse" />
        </div>
      </div>
      {/* Filter bar skeleton */}
      <div className="border-b border-gray-100 bg-white shadow-sm">
        <div className="md:hidden px-4 py-3 grid grid-cols-2 gap-2">
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
        </div>
        <div className="hidden md:flex max-w-7xl mx-auto px-4 py-3 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-7 w-20 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
      {/* Results */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-4 sm:mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <ProductCardSkeleton key={i} marketplace />
          ))}
        </div>
      </div>
    </div>
  )
}
