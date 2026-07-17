// Curated language list for coach profiles, ordered by relevance for the
// German market. Codes are stored in the DB; labels are for display only.
export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
  { code: 'tr', label: 'Türkisch' },
  { code: 'ru', label: 'Russisch' },
  { code: 'pl', label: 'Polnisch' },
  { code: 'ar', label: 'Arabisch' },
  { code: 'es', label: 'Spanisch' },
  { code: 'fr', label: 'Französisch' },
  { code: 'it', label: 'Italienisch' },
  { code: 'pt', label: 'Portugiesisch' },
  { code: 'uk', label: 'Ukrainisch' },
  { code: 'ro', label: 'Rumänisch' },
  { code: 'nl', label: 'Niederländisch' },
  { code: 'el', label: 'Griechisch' },
  { code: 'sr', label: 'Serbisch' },
  { code: 'hr', label: 'Kroatisch' },
  { code: 'vi', label: 'Vietnamesisch' },
  { code: 'zh', label: 'Chinesisch' },
  { code: 'hi', label: 'Hindi' },
]

export const LANGUAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.map(l => [l.code, l.label])
)

export const MAX_COACH_LANGUAGES = 6
