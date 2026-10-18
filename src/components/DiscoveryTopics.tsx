import Link from 'next/link'

interface DiscoveryTopicsProps {
  topics: { key: string; label: string; href: string }[]
  active?: string
}

export default function DiscoveryTopics({ topics, active = 'all' }: DiscoveryTopicsProps) {
  if (topics.length < 2) return null

  return (
    <nav aria-label="Nach Thema entdecken" className="discovery-topics">
      <ul>
        {topics.map(topic => (
          <li key={topic.key}>
            <Link
              href={topic.href}
              scroll={false}
              aria-current={active === topic.key ? 'page' : undefined}
              className={`button-base whitespace-nowrap px-4 text-sm ${active === topic.key ? 'border-brand bg-brand text-white hover:bg-brand-dark' : 'button-secondary'}`}
            >
              {topic.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
