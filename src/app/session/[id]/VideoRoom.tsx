'use client'

import ProtectedVideoRoom from '@/components/ProtectedVideoRoom'

export default function VideoRoom({ bookingId, scheduledAt, durationMinutes, configurationReady }: {
  bookingId: string; scheduledAt: string; durationMinutes: number; configurationReady: boolean
}) {
  return <ProtectedVideoRoom endpoint={`/api/coaching/meeting/${bookingId}/join`} scheduledAt={scheduledAt} durationMinutes={durationMinutes} configurationReady={configurationReady} />
}
