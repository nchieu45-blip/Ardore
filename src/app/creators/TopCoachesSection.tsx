import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'

const CATEGORY_LABELS: Record<string, string> = {
  fitness: 'Fitness',
  ernaehrung: 'Ernährung',
  mental: 'Mental Health',
  abnehmen: 'Abnehmen',
  schlaf: 'Schlaf',
  yoga: 'Yoga',
  laufen: 'Laufen',
  krafttraining: 'Krafttraining',
  meditation: 'Meditation',
  stressmanagement: 'Stressmanagement',
  rueckenschmerzen: 'Rückenschmerzen',
  schwangerschaft: 'Schwangerschaft & Postnatal',
  mobility: 'Mobility & Dehnen',
}

interface TopCoach {
  id: string
  slug: string
  display_name: string
  bio: string | null
  category: string | null
  categories: string[] | null
  avatar_url: string | null
  rank: number
}

interface Props {
  coaches: TopCoach[]
}

export default function TopCoachesSection({ coaches }: Props) {
  if (coaches.length === 0) return null

  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Top Coaches</h2>
      <div className="space-y-3">
        {coaches.map(coach => {
          const isTop = coach.rank === 1
          return (
            <Link key={coach.id} href={`/creators/${coach.slug}`}>
              <Card className={isTop ? 'border-2 border-amber-400 hover:shadow-md transition-shadow' : 'hover:shadow-md transition-shadow'}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 w-7 text-center">
                    <span className={`text-base font-bold ${isTop ? 'text-amber-500' : 'text-gray-400'}`}>
                      #{coach.rank}
                    </span>
                  </div>
                  <Avatar src={coach.avatar_url} name={coach.display_name} size="md" className={isTop ? 'ring-2 ring-amber-400' : ''} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-medium text-gray-900">{coach.display_name}</span>
                      {isTop && <Badge variant="warning">Beliebtester Coach</Badge>}
                      {(coach.categories?.length ? coach.categories : coach.category ? [coach.category] : []).slice(0, 2).map(cat => (
                        <Badge key={cat} variant="success">{CATEGORY_LABELS[cat] ?? cat}</Badge>
                      ))}
                    </div>
                    {coach.bio && (
                      <p className="text-sm text-gray-500 line-clamp-1">{coach.bio}</p>
                    )}
                  </div>
                  <span className="text-green-600 font-medium text-sm flex-shrink-0">Zum Profil →</span>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
