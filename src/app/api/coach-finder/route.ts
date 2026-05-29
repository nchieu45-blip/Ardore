import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Du bist ein freundlicher Coach-Berater auf der Ardore-Plattform.
Deine Aufgabe ist es, Nutzern zu helfen, den passenden Gesundheits- oder Fitnesscoach zu finden.

Stelle zunächst kurze, gezielte Fragen, um die Ziele des Nutzers zu verstehen (z.B. Abnehmen, Muskelaufbau, Ernährung, Yoga, mentale Gesundheit).
Sobald du genug weißt (nach 1-2 Fragen), nutze das search_coaches-Tool um passende Coaches zu suchen und empfehle konkrete Coaches.

Sei freundlich, kurz und präzise. Antworte immer auf Deutsch.`

const CATEGORY_MAP: Record<string, string> = {
  fitness: 'fitness',
  training: 'fitness',
  krafttraining: 'krafttraining',
  muskel: 'krafttraining',
  gewichtheben: 'krafttraining',
  abnehmen: 'abnehmen',
  gewicht: 'abnehmen',
  ernährung: 'ernaehrung',
  diät: 'ernaehrung',
  yoga: 'yoga',
  meditation: 'meditation',
  mental: 'mental',
  psyche: 'mental',
  burnout: 'mental',
  laufen: 'laufen',
  ausdauer: 'laufen',
  joggen: 'laufen',
  schlaf: 'schlaf',
  schlafen: 'schlaf',
  stress: 'stressmanagement',
  stressmanagement: 'stressmanagement',
  rücken: 'rueckenschmerzen',
  rückenschmerzen: 'rueckenschmerzen',
  schwangerschaft: 'schwangerschaft',
  postnatal: 'schwangerschaft',
  mobility: 'mobility',
  dehnen: 'mobility',
  beweglichkeit: 'mobility',
}

async function searchCoaches(category: string) {
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('creator_profiles')
    .select('id, display_name, bio, category, categories, avatar_url, slug')
    .or(`categories.cs.{"${category}"},category.eq.${category}`)
    .limit(3)
  return data ?? []
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })
    }

    const tools: Anthropic.Tool[] = [
      {
        name: 'search_coaches',
        description: 'Sucht passende Coaches in der Datenbank nach Kategorie',
        input_schema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: ['fitness', 'ernaehrung', 'mental', 'abnehmen', 'schlaf', 'yoga', 'laufen', 'krafttraining', 'meditation', 'stressmanagement', 'rueckenschmerzen', 'schwangerschaft', 'mobility'],
              description: 'Die Kategorie des gewünschten Coaches',
            },
          },
          required: ['category'],
        },
      },
    ]

    let coaches: {
      id: string
      display_name: string
      bio: string | null
      category: string | null
      avatar_url: string | null
      slug: string
    }[] = []

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    })

    // Handle tool use
    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
      if (toolUse && toolUse.name === 'search_coaches') {
        const input = toolUse.input as { category: string }
        const category = CATEGORY_MAP[input.category.toLowerCase()] ?? input.category
        coaches = await searchCoaches(category)

        // Continue with tool result
        const followUp = await client.messages.create({
          model: 'claude-opus-4-7',
          max_tokens: 1024,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          tools,
          messages: [
            ...messages,
            { role: 'assistant', content: response.content },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(coaches),
                },
              ],
            },
          ],
        })

        const text = followUp.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('')

        return NextResponse.json({ text, coaches })
      }
    }

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('')

    return NextResponse.json({ text, coaches })
  } catch (err) {
    console.error('coach-finder error:', err)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}
