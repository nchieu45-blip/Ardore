'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Heart, Package, Users, ArrowRight } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ProductCard, type ProductCardData } from '@/components/ui/ProductCard'
import HeartButton from '@/components/HeartButton'

interface CoachFav {
  id: string
  display_name: string
  avatar_url: string | null
  slug: string
  category: string | null
  categories: string[]
  bio: string | null
}

interface Props {
  products: ProductCardData[]
  coaches: CoachFav[]
}

export default function FavoritesPageClient({ products, coaches }: Props) {
  const [tab, setTab] = useState<'products' | 'coaches'>('products')

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Meine Favoriten</h1>
        <p className="text-sm text-gray-500">Deine gespeicherten Coaches und Produkte</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-8 w-fit">
        <button
          onClick={() => setTab('products')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'products'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package className="h-4 w-4" />
          Produkte
          {products.length > 0 && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-semibold">
              {products.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('coaches')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'coaches'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-4 w-4" />
          Coaches
          {coaches.length > 0 && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-semibold">
              {coaches.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'products' && (
        products.length === 0 ? (
          <Empty
            icon={<Package className="h-8 w-8 text-gray-300" />}
            title="Noch keine Produkte gespeichert"
            desc="Klicke auf das Herz-Symbol auf einem Produkt, um es hier zu speichern."
            href="/marketplace"
            cta="Zum Marketplace"
          />
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.map(product => (
              <div key={product.id} className="relative">
                <ProductCard product={product} />
                <HeartButton
                  type="product"
                  itemId={product.id}
                  className="absolute top-3 left-3 z-10"
                />
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'coaches' && (
        coaches.length === 0 ? (
          <Empty
            icon={<Users className="h-8 w-8 text-gray-300" />}
            title="Noch keine Coaches gespeichert"
            desc="Klicke auf das Herz-Symbol auf einem Coach-Profil, um ihn hier zu speichern."
            href="/coaches"
            cta="Coaches entdecken"
          />
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
            {coaches.map(coach => (
              <div key={coach.id} className="relative">
                <Link href={`/creators/${coach.slug}`} className="group block h-full">
                  <div className="rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 h-full flex flex-col">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar
                        src={coach.avatar_url}
                        name={coach.display_name}
                        size="lg"
                        className="flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate group-hover:text-green-700 transition-colors">
                          {coach.display_name}
                        </p>
                        {coach.category && (
                          <p className="text-xs text-gray-400 truncate">{coach.category}</p>
                        )}
                      </div>
                    </div>
                    {coach.bio && (
                      <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed flex-1 mb-3">
                        {coach.bio}
                      </p>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 group-hover:text-green-700 transition-colors mt-auto">
                      Profil ansehen <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
                <HeartButton
                  type="coach"
                  itemId={coach.id}
                  className="absolute top-3 right-3 z-10"
                />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

function Empty({
  icon,
  title,
  desc,
  href,
  cta,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  href: string
  cta: string
}) {
  return (
    <div className="text-center py-20">
      <div className="h-16 w-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <div className="h-8 w-8 rounded-full bg-red-50 flex items-center justify-center mx-auto -mt-8 ml-12 mb-4">
        <Heart className="h-4 w-4 text-red-400" />
      </div>
      <p className="text-gray-700 font-semibold mb-1">{title}</p>
      <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">{desc}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 bg-green-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-green-700 transition-colors"
      >
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
