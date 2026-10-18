import 'server-only'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownedProviderSubscription, type CancellableSubscription } from '@/lib/subscription-cancellation'

export class AccountDeletionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'AccountDeletionError'
  }
}

const support = 'Für dieses Konto bestehen Buchungs-, Kauf- oder Zahlungsaufzeichnungen. Bitte kontaktiere den Ardore-Support für eine sichere Kontolöschung.'
const unavailable = 'Die Kontolöschung wurde nicht ausgeführt, weil der Status nicht sicher geprüft werden konnte. Bitte versuche es später erneut oder kontaktiere den Ardore-Support.'
const stripeUnconfirmed = 'Die Beendigung aller Stripe-Abos konnte nicht bestätigt werden. Dein Konto wurde nicht gelöscht. Einzelne Abos können bereits beendet sein. Bitte prüfe deine Abos und versuche es später erneut oder kontaktiere den Ardore-Support.'
const selection = 'id,buyer_id,creator_id,tier_id,status,current_period_end,stripe_subscription_id,stripe_livemode'
const terminal = (remote: Stripe.Subscription) => ['canceled', 'incomplete_expired'].includes(remote.status)
const free = (row: CancellableSubscription) => row.stripe_livemode === null && row.stripe_subscription_id?.startsWith('free_')

// Unknown counts, unavailable tables and truncated snapshots never mean empty.
async function protectRecords(service: SupabaseClient, userId: string, creatorId?: string) {
  const storage = await service.rpc('account_deletion_storage_clear', { p_user_id: userId })
  if (storage.error || typeof storage.data !== 'boolean') throw new AccountDeletionError(503, unavailable)
  if (!storage.data) throw new AccountDeletionError(409, 'Zu diesem Konto gehören noch gespeicherte Dateien. Bitte kontaktiere den Ardore-Support, damit diese vor der Kontolöschung sicher geprüft werden.')
  const ownership = `buyer_id.eq.${userId}${creatorId ? `,creator_id.eq.${creatorId}` : ''}`
  const queries: PromiseLike<{ count: number | null; error: unknown }>[] = ['bookings', 'payment_orders', 'payment_settlements', 'coaching_payment_attempts', 'discount_redemptions']
    .map(table => service.from(table).select('id', { count: 'exact', head: true }).or(ownership))
  queries.push(service.from('purchases').select('id', { count: 'exact', head: true }).eq('buyer_id', userId))
  queries.push(service.from('video_class_bookings').select('id', { count: 'exact', head: true }).eq('user_id', userId))
  if (creatorId) {
    queries.push(service.from('purchases').select('id,products!inner(creator_id)', { count: 'exact', head: true }).eq('products.creator_id', creatorId))
    queries.push(service.from('video_class_bookings').select('id,video_classes!inner(creator_id)', { count: 'exact', head: true }).eq('video_classes.creator_id', creatorId))
  }
  const results = await Promise.all(queries)
  if (results.some(result => result.error || !Number.isSafeInteger(result.count) || result.count! < 0)) {
    throw new AccountDeletionError(503, unavailable)
  }
  if (results.some(result => result.count! > 0)) throw new AccountDeletionError(409, support)
}

async function subscriptions(service: SupabaseClient, userId: string, creatorId?: string): Promise<CancellableSubscription[]> {
  // Include every status: even a locally canceled row can still renew at Stripe.
  const { data, count, error } = await service.from('subscriptions').select(selection, { count: 'exact' })
    .or(`buyer_id.eq.${userId}${creatorId ? `,creator_id.eq.${creatorId}` : ''}`).order('id')
  if (error || !data || !Number.isSafeInteger(count) || data.length !== count) {
    throw new AccountDeletionError(503, unavailable)
  }
  if (data.some(row => row.buyer_id !== userId && row.creator_id !== creatorId)) {
    throw new AccountDeletionError(409, unavailable)
  }
  // Conflicting provider references need reconciliation, not silent deduplication.
  if (new Set(data.map(row => row.stripe_subscription_id)).size !== data.length) {
    throw new AccountDeletionError(409, unavailable)
  }
  return data as CancellableSubscription[]
}

export async function deleteAccountSafely(input: {
  service: SupabaseClient
  userId: string
  getProvider: () => Promise<{ provider: Stripe; livemode: boolean }>
}): Promise<void> {
  const { service, userId, getProvider } = input
  const { data: creator, error } = await service.from('creator_profiles')
    .select('id,display_name').eq('user_id', userId).maybeSingle()
  if (error) throw new AccountDeletionError(503, unavailable)
  await protectRecords(service, userId, creator?.id)
  const snapshot = await subscriptions(service, userId, creator?.id)
  const paid = snapshot.filter(row => !free(row))

  // Fetch only affected recipients, never the entire Auth directory. A failed
  // lookup stops before provider cancellation or deletion.
  const notices: { email: string; name: string }[] = []
  if (creator) {
    const buyers = new Set(snapshot.filter(row => row.creator_id === creator.id && row.buyer_id !== userId
      && row.status !== 'canceled').map(row => row.buyer_id))
    for (const id of buyers) {
      const result = await service.auth.admin.getUserById(id)
      if (result.error || !result.data.user) throw new AccountDeletionError(503, unavailable)
      if (result.data.user.email) notices.push({ email: result.data.user.email, name: 'Abonnent' })
    }
  }

  if (paid.length) {
    try {
      const { provider, livemode } = await getProvider()
      // Validate the full provider set before the first cancellation.
      const remote = []
      for (const row of paid) remote.push(await ownedProviderSubscription(service, provider, row, livemode))
      for (let i = 0; i < paid.length; i++) {
        if (!terminal(remote[i])) {
          // Unlike normal period-end cancellation, account deletion ends the
          // subscription immediately, as disclosed. No refund/proration/invoice.
          await provider.subscriptions.cancel(remote[i].id, { invoice_now: false, prorate: false })
        }
      }
      // Missing resources/timeouts/partial success are NOT permission to delete.
      for (const row of paid) {
        if (!terminal(await ownedProviderSubscription(service, provider, row, livemode))) throw new Error('unconfirmed')
      }
    } catch {
      throw new AccountDeletionError(503, stripeUnconfirmed)
    }
  }

  // Detect changes observed during provider calls. This is not a distributed
  // transaction or a global checkout lock; financial cases require support.
  await protectRecords(service, userId, creator?.id)
  const current = await subscriptions(service, userId, creator?.id)
  const bindings = (rows: CancellableSubscription[]) => JSON.stringify(rows.map(row => ({
    id: row.id, buyer: row.buyer_id, creator: row.creator_id, tier: row.tier_id,
    provider: row.stripe_subscription_id, mode: row.stripe_livemode,
  })))
  if (bindings(snapshot) !== bindings(current)) throw new AccountDeletionError(409, unavailable)

  // One Auth Admin transaction using existing FK cascades. Never erase profiles
  // first: FK/storage restrictions must preserve account and recovery data.
  const result = await service.auth.admin.deleteUser(userId)
  if (result.error) {
    throw new AccountDeletionError(503, 'Die Kontolöschung konnte nicht bestätigt werden. Einzelne Abos können bereits beendet sein. Bitte melde dich erneut an und prüfe den Status oder kontaktiere den Ardore-Support.')
  }
  // GoTrue versions can return an empty success body. Confirm absence rather
  // than requiring an ID from a deleted user or treating any read error as gone.
  const confirmed = await service.auth.admin.getUserById(userId)
  if (confirmed.data.user || confirmed.error?.code !== 'user_not_found') {
    throw new AccountDeletionError(503, 'Die Kontolöschung konnte nicht bestätigt werden. Bitte melde dich erneut an und prüfe den Status oder kontaktiere den Ardore-Support.')
  }

  // Notices only after deletion succeeds; email failure cannot undo deletion.
  if (creator && notices.length) {
    try {
      const { sendSubscriptionCancelledNotice } = await import('@/lib/email/send')
      await Promise.allSettled(notices.map(notice => sendSubscriptionCancelledNotice(notice.email, {
        recipientName: notice.name, coachName: creator.display_name,
      })))
    } catch { /* no raw provider or recipient details in logs */ }
  }
}
