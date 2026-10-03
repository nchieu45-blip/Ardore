import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { reconcileExpiredCoachingReservations } from '@/lib/coaching-payment-lifecycle'
import { processCoachingPaymentReconciliation } from '@/lib/coaching-payment-reconciliation'

// Recover missed provider events without releasing a checkout that can still pay.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const service = await createServiceClient()
    const reservations = await reconcileExpiredCoachingReservations({ service, limit: 50 })
    const { data: attempts, error } = await service.from('coaching_payment_attempts').select('id')
      .eq('fulfillment_state', 'reconciliation_pending').order('updated_at').limit(50)
    if (error) throw error
    let reconciled = 0
    let pending = 0
    let failed = (reservations.failed ?? 0) + reservations.unresolved
    for (const attempt of attempts ?? []) {
      try {
        const result = await processCoachingPaymentReconciliation({ service, attemptId: attempt.id })
        if (result.state === 'succeeded') reconciled++
        else if (result.state === 'failed') failed++
        else pending++
      } catch { failed++ }
    }
    return NextResponse.json({ reservations, reconciled, pending, failed }, { status: failed ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: 'Payment recovery could not be completed' }, { status: 503 })
  }
}
