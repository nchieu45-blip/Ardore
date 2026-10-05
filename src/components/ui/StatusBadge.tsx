import { CheckCircle2, Clock3, CircleHelp, ShieldCheck, XCircle } from 'lucide-react'
import { Badge } from './Badge'
import { BOOKING_STATUS_STYLES, bookingStatusLabel } from '@/lib/booking-presentation'

// Display-only adapters: authoritative states and labels still come from the existing models.
export function BookingStatusBadge({ status }: { status: string }) {
  const Icon = ['confirmed', 'completed', 'refunded'].includes(status) ? CheckCircle2
    : ['pending_payment'].includes(status) ? Clock3
      : ['cancelled', 'payment_failed', 'expired', 'reversed'].includes(status) ? XCircle : CircleHelp
  return <Badge className={BOOKING_STATUS_STYLES[status]} icon={<Icon />}>{bookingStatusLabel(status)}</Badge>
}
export function VerificationBadge() { return <Badge variant="success" icon={<ShieldCheck />}>Verifiziert</Badge> }
export function PublishBadge({ published }: { published: boolean }) {
  return <Badge variant={published ? 'success' : 'outline'} icon={published ? <CheckCircle2 /> : undefined}>{published ? 'Veröffentlicht' : 'Entwurf'}</Badge>
}
