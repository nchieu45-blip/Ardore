import { CoachCardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div>
      {/* Hero skeleton */}
      <div className="bg-gradient-to-br from-green-950 to-emerald-800 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="h-6 w-48 bg-white/20 rounded-full mx-auto animate-pulse" />
          <div className="h-12 w-72 bg-white/20 rounded-xl mx-auto animate-pulse" />
          <div className="h-4 w-64 bg-white/20 rounded mx-auto animate-pulse" />
          <div className="h-13 max-w-xl w-full mx-auto bg-white/20 rounded-2xl animate-pulse" />
        </div>
      </div>
      {/* Filter bar skeleton */}
      <div className="border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 w-24 bg-gray-200 rounded-full animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
      {/* Grid */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="h-4 w-28 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <CoachCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
