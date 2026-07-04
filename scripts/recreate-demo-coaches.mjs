/**
 * Recreates the 4 demo coach profiles after the corrupted auth.users rows
 * have been removed via the Supabase SQL Editor.
 *
 * Run AFTER executing this SQL in the Supabase SQL Editor:
 *   DELETE FROM auth.users
 *   WHERE id IN (
 *     'a1000000-0000-0000-0000-000000000001',
 *     'a1000000-0000-0000-0000-000000000002',
 *     'a1000000-0000-0000-0000-000000000003',
 *     'a1000000-0000-0000-0000-000000000004'
 *   );
 *
 * Usage:
 *   node scripts/recreate-demo-coaches.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env.local from the project root (same directory as package.json)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envLines = readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')
const env = Object.fromEntries(
  envLines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map((s, i) => (i === 0 ? s : s)))
    .filter(([k]) => k)
    .map(([k, ...rest]) => [k, rest.join('=')])
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const COACHES = [
  {
    email: 'sarah-menzel.demo@ardore-health.com',
    fullName: 'Sarah Menzel',
    slug: 'sarah-menzel',
    bio: 'Zertifizierte Yogalehrerin (RYT 500) aus Köln. Ich helfe dir, Beweglichkeit und innere Ruhe in deinen Alltag zu bringen — ohne Esoterik, mit fundierter Methodik.',
    category: 'yoga',
    categories: ['yoga'],
    products: [
      {
        title: 'Morgenroutine: 20 Min Yoga für Einsteiger',
        description: 'Ein geführtes 20-Minuten-Yoga-Programm für Einsteiger. Perfekt für einen achtsamen Start in den Tag — ohne Vorkenntnisse.',
        type: 'course',
        price: 29.00,
      },
      {
        title: '1:1 Yoga-Session',
        description: 'Eine persönliche 60-Minuten Yoga-Session, zugeschnitten auf deine Ziele und dein Level. Ideal für gezielte Fortschritte.',
        type: 'video',
        price: 45.00,
      },
    ],
    tiers: [],
  },
  {
    email: 'daniel-krueger.demo@ardore-health.com',
    fullName: 'Daniel Krüger',
    slug: 'daniel-krueger',
    bio: 'Personal Trainer (A-Lizenz) mit 8 Jahren Erfahrung. Mein Fokus: sauberes Techniktraining und Trainingspläne, die zu deinem Leben passen — nicht umgekehrt.',
    category: 'krafttraining',
    categories: ['krafttraining'],
    products: [
      {
        title: '12-Wochen Ganzkörper-Trainingsplan',
        description: 'Strukturierter 12-Wochen-Plan für effektives Ganzkörpertraining. Mit Progressionsplan, Alternativübungen und Technik-Erläuterungen.',
        type: 'pdf',
        price: 39.00,
      },
      {
        title: 'Technik-Check per Video-Analyse',
        description: 'Lade ein Video deiner Trainingseinheit hoch und erhalte detailliertes Technik-Feedback von Daniel. Perfekt zur Verletzungsprävention.',
        type: 'video',
        price: 49.00,
      },
    ],
    tiers: [],
  },
  {
    email: 'lisa-hartmann.demo@ardore-health.com',
    fullName: 'Dr. Lisa Hartmann',
    slug: 'dr-lisa-hartmann',
    bio: 'Ökotrophologin (M.Sc.) und zertifizierte Ernährungsberaterin. Ich zeige dir, wie gesunde Ernährung ohne Verzicht und Kalorienzählen funktioniert.',
    category: 'ernaehrung',
    categories: ['ernaehrung'],
    products: [
      {
        title: 'Ernährungs-Basics: Der 4-Wochen-Kurs',
        description: 'In vier Wochen lernst du die Grundlagen einer ausgewogenen Ernährung — wissenschaftlich fundiert, alltagstauglich und ohne Verbote.',
        type: 'course',
        price: 59.00,
      },
      {
        title: 'Persönliche Ernährungsanalyse',
        description: 'Lisa analysiert deine aktuelle Ernährung und erstellt einen individuellen Handlungsplan — inkl. Beratungsgespräch.',
        type: 'video',
        price: 79.00,
      },
    ],
    tiers: [],
  },
  {
    email: 'jonas-weber.demo@ardore-health.com',
    fullName: 'Jonas Weber',
    slug: 'jonas-weber',
    bio: 'Systemischer Coach und Achtsamkeitstrainer. Ich unterstütze Berufstätige dabei, Stress abzubauen und mental gesund zu bleiben — praxisnah und ohne Floskeln.',
    category: 'mental',
    categories: ['mental'],
    products: [
      {
        title: 'Stressfrei durch den Arbeitsalltag',
        description: 'Praktische Techniken und Achtsamkeitsübungen für Berufstätige. Lerne, Stress gezielt abzubauen — in deinem eigenen Tempo.',
        type: 'course',
        price: 34.00,
      },
    ],
    tiers: [
      {
        name: 'Coaching-Abo: 2 Sessions/Monat',
        description: 'Zwei persönliche Coaching-Sessions pro Monat für nachhaltige Fortschritte im Stressmanagement und mentaler Gesundheit.',
        price_monthly: 89.00,
        is_active: true,
      },
    ],
  },
]

// Returns the set of slugs that still belong to the OLD broken auth users
// (those UUIDs were inserted raw into auth.users and corrupted GoTrue).
const OLD_DEMO_IDS = new Set([
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000004',
])

async function verifyClean() {
  const { data: existing } = await supabase
    .from('creator_profiles')
    .select('slug, user_id')
    .in('slug', COACHES.map(c => c.slug))

  // Profiles that still reference the OLD corrupted UUIDs mean the SQL deletion
  // hasn't been run yet.
  const stale = (existing ?? []).filter(r => OLD_DEMO_IDS.has(r.user_id))
  if (stale.length > 0) {
    console.error('\n✗ The old corrupted demo rows are still present in auth.users.')
    console.error('  Run this SQL in the Supabase SQL Editor first, then re-run this script:\n')
    console.error(`  DELETE FROM auth.users WHERE id IN (
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000004'
  );`)
    console.error()
    process.exit(1)
  }
  console.log('✓ Old corrupted rows are cleared — proceeding\n')
}

async function createCoach(coach) {
  // Skip if already created in a previous partial run (different UUID, not stale).
  const { data: existingCp } = await supabase
    .from('creator_profiles')
    .select('id, user_id')
    .eq('slug', coach.slug)
    .maybeSingle()

  if (existingCp && !OLD_DEMO_IDS.has(existingCp.user_id)) {
    console.log(`  ⟳ Already exists (slug: ${coach.slug}) — skipping`)
    return
  }

  // 1. Create auth user via GoTrue admin API.
  //    GoTrue handles: proper password hash, auth.identities, instance_id, etc.
  //    The handle_new_user DB trigger auto-creates the profiles row.
  console.log(`  Creating auth user: ${coach.email}`)
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: coach.email,
    email_confirm: true,
    user_metadata: {
      role: 'creator',
      full_name: coach.fullName,
    },
  })
  if (authErr) throw new Error(`auth.admin.createUser failed for ${coach.email}: ${authErr.message}`)
  const userId = authData.user.id
  console.log(`  ✓ Auth user created (id: ${userId})`)

  // 2. Insert creator_profile.
  //    The profile row was auto-created by the trigger, so user_id FK is satisfied.
  const { data: cp, error: cpErr } = await supabase
    .from('creator_profiles')
    .insert({
      user_id: userId,
      display_name: coach.fullName,
      slug: coach.slug,
      bio: coach.bio,
      category: coach.category,
      categories: coach.categories,
      stripe_account_active: false,
      is_demo: true,
    })
    .select('id')
    .single()
  if (cpErr) throw new Error(`creator_profiles insert failed for ${coach.slug}: ${cpErr.message}`)
  console.log(`  ✓ Creator profile created (id: ${cp.id})`)

  // 3. Insert products.
  for (const product of coach.products) {
    const { error: pErr } = await supabase.from('products').insert({
      creator_id: cp.id,
      title: product.title,
      description: product.description,
      type: product.type,
      price: product.price,
      is_published: true,
    })
    if (pErr) throw new Error(`product insert failed "${product.title}": ${pErr.message}`)
    console.log(`  ✓ Product: "${product.title}"`)
  }

  // 4. Insert subscription tiers (if any).
  for (const tier of coach.tiers) {
    const { error: tErr } = await supabase.from('subscription_tiers').insert({
      creator_id: cp.id,
      ...tier,
    })
    if (tErr) throw new Error(`subscription_tier insert failed "${tier.name}": ${tErr.message}`)
    console.log(`  ✓ Subscription tier: "${tier.name}"`)
  }
}

async function verify() {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .order('created_at', { ascending: true })

  const { data: cps } = await supabase
    .from('creator_profiles')
    .select('slug, is_demo, user_id')
    .eq('is_demo', true)

  const { data: products } = await supabase
    .from('products')
    .select('title, price')
    .eq('is_published', true)

  console.log('\n── Final state ────────────────────────────────────')
  console.log(`profiles (${profiles?.length ?? 0} rows):`)
  for (const p of profiles ?? []) console.log(`  ${p.email} / ${p.role}`)
  console.log(`\ndemo creator_profiles (${cps?.length ?? 0}):`)
  for (const c of cps ?? []) console.log(`  ${c.slug} (is_demo=${c.is_demo})`)
  console.log(`\npublished products (${products?.length ?? 0}):`)
  for (const p of products ?? []) console.log(`  "${p.title}" — €${p.price}`)
  console.log('───────────────────────────────────────────────────\n')
}

async function main() {
  console.log('=== Recreating demo coaches ===\n')
  await verifyClean()

  for (const coach of COACHES) {
    console.log(`\n→ ${coach.fullName}`)
    await createCoach(coach)
  }

  await verify()
  console.log('✓ All done. Test customer login and homepage should now work.\n')
}

main().catch(err => {
  console.error('\n✗ Script failed:', err.message)
  process.exit(1)
})
