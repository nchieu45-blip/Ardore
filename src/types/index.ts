export type UserRole = 'buyer' | 'creator'

export type ProductType = 'pdf' | 'video' | 'course' | 'image'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole
  created_at: string
}

export interface CreatorProfile {
  id: string
  user_id: string
  display_name: string
  slug: string
  bio: string | null
  category: string | null
  categories: string[]
  services: string[]
  avatar_url: string | null
  banner_url: string | null
  stripe_account_id: string | null
  stripe_account_active: boolean
  created_at: string
  profile?: Profile
}

export interface SubscriptionTier {
  id: string
  creator_id: string
  name: string
  description: string | null
  price_monthly: number
  stripe_price_id: string | null
  features: string[]
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  creator_id: string
  title: string
  description: string | null
  type: ProductType
  price: number
  file_url: string | null
  thumbnail_url: string | null
  stripe_price_id: string | null
  is_published: boolean
  created_at: string
  creator?: CreatorProfile
}

export interface Purchase {
  id: string
  buyer_id: string
  product_id: string
  amount_paid: number
  stripe_payment_intent_id: string | null
  created_at: string
  product?: Product
}

export interface Subscription {
  id: string
  buyer_id: string
  creator_id: string
  tier_id: string
  stripe_subscription_id: string
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  current_period_end: string
  created_at: string
  creator?: CreatorProfile
  tier?: SubscriptionTier
}

export interface Message {
  id: string
  sender_id: string
  creator_id: string
  content: string
  created_at: string
  sender?: Profile
}

export interface Review {
  id: string
  product_id: string
  buyer_id: string
  rating: number
  content: string | null
  created_at: string
  profiles?: {
    full_name: string | null
    avatar_url: string | null
  } | null
}

export interface CreatorStats {
  total_revenue: number
  monthly_revenue: number
  total_subscribers: number
  total_products: number
  total_purchases: number
}
