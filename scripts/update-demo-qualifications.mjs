/**
 * Sets qualifications[] on the 4 demo coach profiles.
 * UPDATE only — never touches auth.users.
 *
 * Usage:
 *   node scripts/update-demo-qualifications.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

const QUALIFICATIONS = [
  {
    slug: 'sarah-menzel',
    qualifications: ['Zertifizierte Yogalehrerin RYT 500 (Yoga Alliance)'],
  },
  {
    slug: 'daniel-krueger',
    qualifications: ['Personal Trainer A-Lizenz', '8 Jahre Erfahrung als Personal Trainer'],
  },
  {
    slug: 'dr-lisa-hartmann',
    qualifications: ['M.Sc. Ökotrophologie', 'Zertifizierte Ernährungsberaterin'],
  },
  {
    slug: 'jonas-weber',
    qualifications: ['Systemischer Coach', 'Achtsamkeitstrainer'],
  },
]

async function main() {
  console.log('=== Updating demo coach qualifications ===\n')

  // Read before-state
  const { data: before, error: beforeErr } = await supabase
    .from('creator_profiles')
    .select('slug, is_demo, qualifications')
    .in('slug', QUALIFICATIONS.map(q => q.slug))
  if (beforeErr) throw new Error(`Read failed: ${beforeErr.message}`)

  console.log('── Before ──────────────────────────────────────────')
  for (const row of before ?? []) {
    console.log(`  ${row.slug} (is_demo=${row.is_demo}): ${JSON.stringify(row.qualifications)}`)
  }

  // Safety check: every matched row must be a demo coach
  const nonDemo = (before ?? []).filter(r => !r.is_demo)
  if (nonDemo.length > 0) {
    console.error(`\n✗ Found non-demo rows matched by slug: ${nonDemo.map(r => r.slug).join(', ')}`)
    console.error('  Aborting — no changes made.')
    process.exit(1)
  }

  console.log('\n── Applying updates ────────────────────────────────')
  let updatedCount = 0

  for (const { slug, qualifications } of QUALIFICATIONS) {
    const { data, error } = await supabase
      .from('creator_profiles')
      .update({ qualifications })
      .eq('slug', slug)
      .eq('is_demo', true)
      .select('slug')

    if (error) throw new Error(`Update failed for ${slug}: ${error.message}`)
    if (!data || data.length === 0) {
      console.warn(`  ⚠ No row matched for slug="${slug}" with is_demo=true — skipped`)
    } else {
      console.log(`  ✓ ${slug}: ${JSON.stringify(qualifications)}`)
      updatedCount++
    }
  }

  // Read after-state
  const { data: after, error: afterErr } = await supabase
    .from('creator_profiles')
    .select('slug, is_demo, qualifications')
    .in('slug', QUALIFICATIONS.map(q => q.slug))
  if (afterErr) throw new Error(`Read after failed: ${afterErr.message}`)

  console.log('\n── After ───────────────────────────────────────────')
  for (const row of after ?? []) {
    console.log(`  ${row.slug} (is_demo=${row.is_demo}): ${JSON.stringify(row.qualifications)}`)
  }

  console.log(`\n✓ Done — updated ${updatedCount} rows (all is_demo=true).\n`)
}

main().catch(err => {
  console.error('\n✗ Script failed:', err.message)
  process.exit(1)
})
