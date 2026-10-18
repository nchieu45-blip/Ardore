import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton-shimmer rounded-xl', className)} />
}

export function ProductCardSkeleton({ compact, marketplace }: { compact?: boolean; marketplace?: boolean }) {
  if (compact) {
    return (
      <div className="flex-shrink-0 w-48 surface-card overflow-hidden">
        <Skeleton className="aspect-video rounded-none" />
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
      <div className="surface-card overflow-hidden">
        <Skeleton className="aspect-video rounded-none" />
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
    <div className="surface-card overflow-hidden">
      <Skeleton className="aspect-video rounded-none" />
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

export function CoachCardSkeleton({ layout = 'default' }: { layout?: 'default' | 'rail' }) {
  const rail = layout === 'rail'
  return (
    <div className={`surface-card grid grid-cols-[5rem_minmax(0,1fr)] gap-4 overflow-hidden p-4 ${rail ? '' : 'sm:block sm:p-0'}`}>
      <Skeleton className={`aspect-[4/5] rounded-xl ${rail ? '' : 'sm:rounded-none'}`} />
      <div className={`space-y-3 self-center pr-10 ${rail ? '' : 'sm:p-5 sm:pb-0 sm:pr-5'}`}>
        <Skeleton className={`h-5 w-full ${rail ? '' : 'sm:w-2/3'}`} />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className={`col-span-2 space-y-3 ${rail ? '' : 'sm:p-5'}`}>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  )
}
