import { z } from 'zod'
import { CATEGORY_LABEL_MAP } from '@/lib/categories'

export const COACH_SETUP_STEPS = ['Profil', 'Bilder', 'Abos', 'Produkt', 'Veröffentlichen'] as const
export const coachProfileSchema = z.object({
  display_name: z.string().trim().min(2, 'Mindestens 2 Zeichen').max(50),
  bio: z.string().max(500, 'Max. 500 Zeichen').optional(),
  categories: z.array(z.string().refine(value => value in CATEGORY_LABEL_MAP, 'Ungültige Kategorie')).min(1, 'Bitte wähle mindestens eine Kategorie'),
}).strict()

export type CoachSetupProfile = {
  id: string; display_name: string; slug: string; bio: string | null;
  categories: string[]; category: string | null; avatar_url: string | null; banner_url: string | null;
  is_published: boolean; onboarding_step: number
}

export function missingCoachRequirements(profile: Pick<CoachSetupProfile, 'display_name' | 'slug' | 'categories' | 'category' | 'onboarding_step'>): string[] {
  const missing: string[] = []
  if (profile.display_name.trim().length < 2 || profile.display_name.trim().length > 50) missing.push('Coach-Name (2–50 Zeichen)')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(profile.slug)) missing.push('Gültige Profiladresse')
  if (!profile.categories.some(value => value.trim()) && !profile.category?.trim()) missing.push('Mindestens eine Kategorie')
  if (profile.onboarding_step < 5) missing.push(`Einrichtung fortsetzen: ${COACH_SETUP_STEPS[profile.onboarding_step - 1]}`)
  return missing
}
