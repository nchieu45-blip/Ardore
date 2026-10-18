import { sendNewSubscriberNotification } from '@/lib/email/send'
import { createNotification } from '@/lib/notifications'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com'

// Shared helper — used by both the Stripe webhook and the free-tier route.
export async function notifyNewSubscriber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  buyerId: string,
  creatorId: string,
  tierId: string,
  agreedMonthlyCents?: number,
) {
  try {
    const [creatorRes, buyerRes, tierRes] = await Promise.all([
      supabase
        .from('creator_profiles')
        .select('user_id, display_name')
        .eq('id', creatorId)
        .single(),
      supabase.auth.admin.getUserById(buyerId),
      supabase
        .from('subscription_tiers')
        .select('name, price_monthly')
        .eq('id', tierId)
        .single(),
    ])

    const creatorUserId = creatorRes.data?.user_id
    if (!creatorUserId) return

    const creatorEmailRes = await supabase.auth.admin.getUserById(creatorUserId)
    const creatorEmail = creatorEmailRes.data?.user?.email
    if (!creatorEmail) return

    const creatorName = creatorRes.data.display_name ?? 'Creator'
    const subscriberName = buyerRes.data.user?.user_metadata?.full_name ?? 'Jemand'
    const tier = tierRes.data

    if (tier) {
      await Promise.allSettled([
        sendNewSubscriberNotification(creatorEmail, {
          creatorName,
          subscriberName,
          tierName: tier.name,
          priceMonthly: agreedMonthlyCents !== undefined && Number.isSafeInteger(agreedMonthlyCents) && agreedMonthlyCents >= 0
            ? agreedMonthlyCents / 100 : tier.price_monthly,
          dashboardUrl: `${APP_URL}/creator`,
        }),
        createNotification({
          userId: creatorUserId,
          type: 'new_subscriber',
          title: 'Neuer Abonnent',
          message: `${subscriberName} hat „${tier.name}" abonniert.`,
          link: '/creator',
        }),
      ])
    }
  } catch (err) {
    console.error('[notifyNewSubscriber]', err)
  }
}
