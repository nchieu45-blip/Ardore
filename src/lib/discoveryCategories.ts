export const DISCOVERY_CATEGORIES = [
  {
    key: 'fitness-kraft',
    title: 'Fitness & Kraft',
    description: 'Finde Training für mehr Kraft und Ausdauer.',
    image: '/media/kategorien/fitness.webp',
    alt: 'Eine Person trainiert mit einer Kurzhantel im Studio.',
    categories: ['fitness', 'krafttraining', 'muskelaufbau', 'abnehmen', 'ausdauer', 'functional'],
  },
  {
    key: 'yoga',
    title: 'Yoga',
    description: 'Verbinde Bewegung und Atem in deiner Praxis.',
    image: '/media/kategorien/yoga.webp',
    alt: 'Eine Person steht mit ausgestreckten Armen in einer Yoga-Haltung.',
    categories: ['yoga'],
  },
  {
    key: 'pilates',
    title: 'Pilates',
    description: 'Entdecke Übungen für Stabilität und Körpergefühl.',
    image: '/media/kategorien/pilates.webp',
    alt: 'Eine Person macht eine Übung auf einem Pilates-Reformer.',
    categories: ['pilates'],
  },
  {
    key: 'ernaehrung',
    title: 'Ernährung',
    description: 'Entwickle Essgewohnheiten, die in deinen Alltag passen.',
    image: '/media/kategorien/ernaehrung.webp',
    alt: 'Hände bereiten frisches Gemüse auf einem Schneidebrett vor.',
    categories: ['ernaehrung', 'ernaehrungsberatung', 'gewichtsmanagement', 'sporternaehrung'],
  },
  {
    key: 'kampfsport',
    title: 'Kampfsport',
    description: 'Trainiere Technik, Koordination und Konzentration.',
    image: '/media/kategorien/kampfsport.webp',
    alt: 'Zwei Personen üben im Boxtraining mit Handschuhen und Pratzen.',
    categories: ['kampfsport'],
  },
] as const satisfies ReadonlyArray<{
  key: string; title: string; description: string; image: string; alt: string; categories: readonly string[]
}>
