import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div>
      {/* Hero skeleton */}
      <div className="bg-gradient-to-br from-green-950 to-emerald-800 px-4 py-14">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20 bg-white/20" />
            <Skeleton className="h-9 w-64 bg-white/20 rounded-xl" />
            <Skeleton className="h-4 w-80 bg-white/20" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40 bg-white/20 rounded-xl" />
            <Skeleton className="h-9 w-32 bg-white/20 rounded-xl" />
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-3 gap-4 mb-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 p-5 bg-white">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-4 w-4 rounded" />
              </div>
              <Skeleton className="h-7 w-12 mb-1" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-12" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="rounded-2xl border border-gray-100 bg-white p-4 flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-8 w-20 rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
