export async function POST() {
  return Response.json(
    { error: 'Der KI-Coach-Finder ist derzeit deaktiviert. Nutze die Coach-Suche.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
