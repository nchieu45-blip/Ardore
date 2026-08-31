import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-lg', className)} />
}

export function ProductCardSkeleton({ compact, marketplace }: { compact?: boolean; marketplace?: boolean }) {
  if (compact) {
    return (
      <div className="flex-shrink-0 w-48 rounded-2xl overflow-hidden border border-gray-100 bg-white">
        <Skeleton className="h-32 rounded-none" />
        <div className="p-3 space-y-2">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3.5 w-1/3 mt-1" />
        </div>
      </div>
    )
  }
  if (marketplace) {
    return (
      <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
        <Skeleton className="h-32 sm:h-40 lg:h-44 rounded-none" />
        <div className="p-3 sm:p-4 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3.5 sm:h-4 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-4 w-16 mt-2" />
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <Skeleton className="h-44 rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function CoachCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <Skeleton className="h-20 rounded-none" />
      <div className="px-5 pb-5">
        <div className="-mt-7 mb-3 relative z-10">
          <Skeleton className="h-14 w-14 rounded-full" />
        </div>
        <Skeleton className="h-5 w-2/3 mb-2" />
        <div className="flex gap-1 mb-3">
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="h-4 w-20 rounded-full" />
        </div>
        <Skeleton className="h-3 w-full mb-1" />
        <Skeleton className="h-3 w-4/5 mb-4" />
        <div className="flex gap-3 mb-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  )
}
