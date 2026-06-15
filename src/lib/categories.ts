export const CATEGORY_GROUPS: { label: string; items: { key: string; label: string }[] }[] = [
  {
    label: 'Fitness & Sport',
    items: [
      { key: 'krafttraining',   label: 'Krafttraining' },
      { key: 'muskelaufbau',    label: 'Muskelaufbau' },
      { key: 'abnehmen',        label: 'Abnehmen' },
      { key: 'laufen',          label: 'Laufen' },
    ],
  },
  {
    label: 'Gesundheit & Wohlbefinden',
    items: [
      { key: 'ernaehrung',       label: 'Ernährung' },
      { key: 'rueckenschmerzen', label: 'Rückenschmerzen' },
      { key: 'schwangerschaft',  label: 'Schwangerschaft & Postnatal' },
    ],
  },
  {
    label: 'Mental & Entspannung',
    items: [
      { key: 'mental',     label: 'Mental Health' },
      { key: 'meditation', label: 'Meditation' },
      { key: 'yoga',       label: 'Yoga' },
      { key: 'pilates',    label: 'Pilates' },
    ],
  },
]

export const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.items)

export const CATEGORY_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ALL_CATEGORIES.map(c => [c.key, c.label])
)
