export const DISCOVERY_CATEGORIES = [
  {
    key: 'fitness-kraft',
    title: 'Fitness & Kraft',
    description: 'Trainiere Kraft und Ausdauer in deinem Tempo.',
    image: '/media/kategorien/fitness.webp',
    alt: 'Eine Person trainiert mit einer Kurzhantel im Studio.',
    categories: ['fitness', 'krafttraining', 'muskelaufbau', 'abnehmen', 'ausdauer', 'functional'],
  },
  {
    key: 'yoga',
    title: 'Yoga',
    description: 'Nimm dir Zeit für Bewegung und Atem.',
    image: '/media/kategorien/yoga.webp',
    alt: 'Eine Person steht mit ausgestreckten Armen in einer Yoga-Haltung.',
    categories: ['yoga'],
  },
  {
    key: 'pilates',
    title: 'Pilates',
    description: 'Stärke deine Mitte und spür, wie du dich bewegst.',
    image: '/media/kategorien/pilates.webp',
    alt: 'Eine Person macht eine Übung auf einem Pilates-Reformer.',
    categories: ['pilates'],
  },
  {
    key: 'ernaehrung',
    title: 'Ernährung',
    description: 'Finde heraus, was dir beim Essen im Alltag guttut.',
    image: '/media/kategorien/ernaehrung.webp',
    alt: 'Hände bereiten frisches Gemüse auf einem Schneidebrett vor.',
    categories: ['ernaehrung', 'ernaehrungsberatung', 'gewichtsmanagement', 'sporternaehrung'],
  },
  {
    key: 'kampfsport',
    title: 'Kampfsport',
    description: 'Übe Technik und Koordination mit klarem Fokus.',
    image: '/media/kategorien/kampfsport.webp',
    alt: 'Zwei Personen üben im Boxtraining mit Handschuhen und Pratzen.',
    categories: ['kampfsport'],
  },
] as const satisfies ReadonlyArray<{
  key: string; title: string; description: string; image: string; alt: string; categories: readonly string[]
}>
