'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  Flame, Check, Dumbbell, Apple, Brain, Moon,
  Waves, Zap, Activity, Heart, TrendingDown, Wind,
} from 'lucide-react'

const INTERESTS = [
  { value: 'fitness',         label: 'Fitness',          icon: <Dumbbell  className="h-5 w-5" /> },
  { value: 'ernaehrung',      label: 'Ernährung',        icon: <Apple     className="h-5 w-5" /> },
  { value: 'mental',          label: 'Mental Health',    icon: <Brain     className="h-5 w-5" /> },
  { value: 'abnehmen',        label: 'Abnehmen',         icon: <TrendingDown className="h-5 w-5" /> },
  { value: 'schlaf',          label: 'Schlaf',           icon: <Moon      className="h-5 w-5" /> },
  { value: 'yoga',            label: 'Yoga',             icon: <Waves     className="h-5 w-5" /> },
  { value: 'pilates',         label: 'Pilates',          icon: <Wind      className="h-5 w-5" /> },
  { value: 'laufen',          label: 'Laufen',           icon: <Zap       className="h-5 w-5" /> },
  { value: 'krafttraining',   label: 'Krafttraining',    icon: <Activity  className="h-5 w-5" /> },
  { value: 'meditation',      label: 'Meditation',       icon: <Heart     className="h-5 w-5" /> },
]

export default function BuyerOnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [firstName, setFirstName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      if (user.user_metadata?.buyer_onboarded) { router.push('/buyer'); return }
      setFirstName(user.user_metadata?.full_name?.split(' ')[0] ?? '')
      setChecking(false)
    }
    check()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  async function finish(skip = false) {
    setSaving(true)
    await supabase.auth.updateUser({
      data: { interests: skip ? [] : selected, buyer_onboarded: true },
    })
    if (skip) {
      router.push('/buyer')
    } else {
      const top = selected[0]
      router.push(top ? `/creators?category=${top}` : '/creators')
    }
  }

  if (checking) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <p className="text-sm text-gray-400">Lädt…</p>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50 px-4 py-10">
      <div className="max-w-xl mx-auto animate-slide-up">

        {/* Logo */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl text-green-600 mb-6">
            <div className="h-8 w-8 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
              <Flame className="h-4 w-4 text-white" />
            </div>
            Ardore
          </Link>

          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Herzlich willkommen{firstName ? `, ${firstName}` : ''}!
          </h1>
          <p className="text-gray-500 mt-2">
            Was sind deine Gesundheits- und Fitnessziele?
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Wähle alles aus, was auf dich zutrifft — wir zeigen dir passende Coaches.
          </p>
        </div>

        {/* Interest grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {INTERESTS.map((interest) => {
            const isSelected = selected.includes(interest.value)
            return (
              <button
                key={interest.value}
                type="button"
                onClick={() => toggle(interest.value)}
                className={cn(
                  'relative flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all duration-150',
                  isSelected
                    ? 'border-green-600 bg-green-50 text-green-800'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
                )}
              >
                <span className={cn(
                  'flex-shrink-0 transition-colors',
                  isSelected ? 'text-green-600' : 'text-gray-400',
                )}>
                  {interest.icon}
                </span>
                <span className="text-sm font-medium leading-tight">{interest.label}</span>
                {isSelected && (
                  <span className="absolute top-2 right-2 h-4 w-4 rounded-full bg-green-600 flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* CTAs */}
        <Button
          className="w-full"
          size="lg"
          loading={saving}
          onClick={() => finish(false)}
        >
          {selected.length > 0 ? 'Passende Coaches entdecken' : 'Coaches entdecken'}
        </Button>

        <p className="text-center mt-4">
          <button
            type="button"
            onClick={() => finish(true)}
            disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Überspringen — direkt zur Übersicht
          </button>
        </p>

      </div>
    </div>
  )
}
