import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

export default function BuyerChatLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8" aria-busy="true" aria-label="Nachrichten werden geladen">
      <Skeleton className="h-8 w-40 mb-2" />
      <Skeleton className="h-5 w-56 mb-8" />
      <div className="space-y-2">
        {[0, 1, 2].map((item) => (
          <Card key={item}>
            <CardContent className="flex items-center gap-4 p-4">
              <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
