type SubscriptionTierOwner = { creator_id: string }

export interface SubscriptionEntitlement {
  creator_id: string
  status: string
  current_period_end: string
  stripe_subscription_id: string
  stripe_livemode: boolean | null
  tier?: SubscriptionTierOwner | SubscriptionTierOwner[] | null
  subscription_tiers?: SubscriptionTierOwner | SubscriptionTierOwner[] | null
}

// Commercial tier fields remain coach-controlled. Access is derived only from
// server-issued lifecycle/payment fields and a tier belonging to that creator.
export function hasActiveSubscriptionEntitlement(
  subscription: SubscriptionEntitlement | null | undefined,
  now = Date.now(),
): boolean {
  if (!subscription || subscription.status !== 'active') return false
  if (typeof subscription.creator_id !== 'string' || !subscription.creator_id) return false
  const periodEnd = Date.parse(subscription.current_period_end)
  if (!Number.isFinite(periodEnd) || periodEnd <= now) return false

  const relation = subscription.tier ?? subscription.subscription_tiers
  const tier = Array.isArray(relation) ? relation[0] : relation
  if (!tier || tier.creator_id !== subscription.creator_id) return false

  return subscription.stripe_livemode === true
    || (subscription.stripe_livemode === null
      && typeof subscription.stripe_subscription_id === 'string'
      && subscription.stripe_subscription_id.startsWith('free_'))
}
