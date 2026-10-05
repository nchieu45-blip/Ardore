import { CoachCardSkeleton, Skeleton } from '@/components/ui/Skeleton'
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Coaches werden geladen">
      <div className="border-b border-border bg-surface">
        <div className="ardore-container space-y-4 py-8">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-11 w-full max-w-2xl" />
        </div>
      </div>
      <div className="ardore-container py-6">
        <div className="mb-6 flex gap-3">
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-36" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CoachCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
