export const CATEGORY_GROUPS: { label: string; items: { key: string; label: string }[] }[] = [
  {
    label: 'Fitness & Training',
    items: [
      { key: 'krafttraining',    label: 'Krafttraining' },
      { key: 'muskelaufbau',     label: 'Muskelaufbau' },
      { key: 'abnehmen',         label: 'Abnehmen' },
      { key: 'ausdauer',         label: 'Ausdauer' },
      { key: 'functional',       label: 'Functional Training' },
    ],
  },
  {
    label: 'Ernährung',
    items: [
      { key: 'ernaehrungsberatung', label: 'Ernährungsberatung' },
      { key: 'gewichtsmanagement',  label: 'Gewichtsmanagement' },
      { key: 'sporternaehrung',     label: 'Sporternährung' },
    ],
  },
  {
    label: 'Mental & Entspannung',
    items: [
      { key: 'mental',            label: 'Mental Health' },
      { key: 'yoga',              label: 'Yoga' },
      { key: 'meditation',        label: 'Meditation' },
      { key: 'stressbewaeltigung',label: 'Stressbewältigung' },
    ],
  },
  {
    label: 'Körper & Reha',
    items: [
      { key: 'rueckengesundheit', label: 'Rückengesundheit' },
      { key: 'physiotherapie',    label: 'Physiotherapie' },
      { key: 'beweglichkeit',     label: 'Beweglichkeit' },
      { key: 'schwangerschaft',   label: 'Schwangerschaft & Postnatal' },
    ],
  },
  {
    label: 'Sportarten',
    items: [
      { key: 'kampfsport', label: 'Kampfsport' },
      { key: 'laufen',     label: 'Laufen' },
      { key: 'pilates',    label: 'Pilates' },
    ],
  },
]

export const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.items)

export const CATEGORY_LABEL_MAP: Record<string, string> = {
  ...Object.fromEntries(ALL_CATEGORIES.map(c => [c.key, c.label])),
  // Legacy slugs used by coaches onboarded before the category rename
  fitness:          'Fitness',
  ernaehrung:       'Ernährung',
  schlaf:           'Schlaf',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  mobility:         'Mobility & Dehnen',
}
