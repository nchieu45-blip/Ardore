import { createHash } from 'node:crypto'
import { GROUP_ROOM_CAPACITY } from '@/lib/group-capacity'

const DAILY_API = 'https://api.daily.co/v1'
export const VIDEO_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export class VideoAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'VideoAccessError' }
}

export function validVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function canonicalOccurrenceStart(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null
  const timestamp = Date.parse(value)
  // Keep PostgreSQL's sub-millisecond identity when the booking starts_at has
  // microseconds, while normalizing its timezone and millisecond component.
  const remainder = (value.match(/\.\d{3}(\d{1,3})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').replace(/0+$/, '')
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace(/Z$/, `${remainder}Z`) : null
}

export function videoJoinWindow(startsAt: string, durationMinutes: number, now = Date.now()) {
  const start = Date.parse(startsAt)
  const end = start + durationMinutes * 60_000
  if (!canonicalOccurrenceStart(startsAt) || !Number.isFinite(start) || !Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480 || !Number.isSafeInteger(end)) {
    throw new VideoAccessError(409, 'Die Terminzeit konnte nicht bestätigt werden.')
  }
  const opens = start - 15 * 60_000
  if (now < opens) throw new VideoAccessError(409, 'Der Videoraum öffnet 15 Minuten vor Beginn.')
  if (now >= end) throw new VideoAccessError(410, 'Dieser Termin ist bereits beendet.')
  return { startsAt: canonicalOccurrenceStart(startsAt)!, opens, end }
}

type AccessInput = {
  kind: 'coaching' | 'group'
  identity: string
  startsAt: string
  durationMinutes: number
  userId: string
  userName: string
  isOwner: boolean
  /** Rechecks the database after provider latency, before minting a token. */
  reauthorize: () => Promise<void>
}

export function videoRoomName(kind: AccessInput['kind'], identity: string, startsAt: string) {
  const stamp = canonicalOccurrenceStart(startsAt)
  if (!validVideoId(identity) || !stamp) throw new VideoAccessError(404, 'Termin nicht gefunden.')
  // A fresh namespace prevents reuse of legacy public rooms. A rescheduled
  // appointment or another weekly occurrence always gets a different room.
  const digest = createHash('sha256').update(`${kind}:${identity}:${stamp}`).digest('hex').slice(0, 40)
  return `ardore-v2-${kind}-${digest}`
}

function providerFailure(): never {
  throw new VideoAccessError(503, 'Der Videoraum ist momentan nicht verfügbar. Bitte versuche es erneut.')
}

function verifiedRoom(value: unknown, name: string, opens: number, end: number, limit: number): string {
  if (!value || typeof value !== 'object') return providerFailure()
  const room = value as { name?: unknown; api_created?: unknown; privacy?: unknown; url?: unknown; config?: Record<string, unknown> }
  const config = room.config
  if (room.name !== name || room.api_created !== true || room.privacy !== 'private' || !config
    || config.enable_knocking !== false || config.eject_at_room_exp !== true || config.enforce_unique_user_ids !== true
    || config.nbf !== Math.floor(opens / 1000) || config.exp !== Math.floor(end / 1000)
    || config.max_participants !== limit || typeof room.url !== 'string') return providerFailure()
  try {
    const url = new URL(room.url)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.daily\.co$/i.test(url.hostname)
      || url.pathname !== `/${name}`) return providerFailure()
    return url.href
  } catch { return providerFailure() }
}

/** Only authenticated route handlers may call this after validating entitlement. */
export async function createVideoAccess(input: AccessInput, providerFetch: typeof fetch = fetch, now = Date.now()): Promise<{ roomUrl: string; token: string }> {
  const window = videoJoinWindow(input.startsAt, input.durationMinutes, now)
  if (!validVideoId(input.userId) || typeof input.isOwner !== 'boolean') throw new VideoAccessError(404, 'Termin nicht gefunden.')
  const key = process.env.DAILY_API_KEY
  if (!key?.trim()) throw new VideoAccessError(503, 'Videoanrufe sind noch nicht vollständig eingerichtet. Bitte kontaktiere den Support.')
  const name = videoRoomName(input.kind, input.identity, window.startsAt)
  const limit = input.kind === 'coaching' ? 2 : GROUP_ROOM_CAPACITY
  const request = async (path: string, method = 'GET', body?: unknown) => {
    try {
      return await providerFetch(`${DAILY_API}${path}`, {
        method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { return providerFailure() }
  }
  const readJson = async (response: Response): Promise<unknown> => {
    try { return await response.json() } catch { return providerFailure() }
  }

  await input.reauthorize()
  let response = await request(`/rooms/${name}`)
  if (response.status === 404) {
    await input.reauthorize()
    response = await request('/rooms', 'POST', {
      name, privacy: 'private', properties: {
        nbf: Math.floor(window.opens / 1000), exp: Math.floor(window.end / 1000),
        eject_at_room_exp: true, enable_knocking: false, max_participants: limit,
        enable_prejoin_ui: true, enforce_unique_user_ids: true,
        enable_chat: true, enable_screenshare: true,
      },
    })
    // A concurrent caller may have created the deterministic room first.
    // Read it once; never replace or relax an existing room's privacy.
    if (!response.ok) response = await request(`/rooms/${name}`)
  }
  if (!response.ok) return providerFailure()
  const roomUrl = verifiedRoom(await readJson(response), name, window.opens, window.end, limit)
  await input.reauthorize()
  videoJoinWindow(window.startsAt, input.durationMinutes)
  const tokenResponse = await request('/meeting-tokens', 'POST', {
    properties: {
      room_name: name, nbf: Math.floor(window.opens / 1000), exp: Math.floor(window.end / 1000),
      eject_at_token_exp: true, is_owner: input.isOwner,
      user_id: createHash('sha256').update(`${name}:${input.userId}`).digest('hex').slice(0, 32),
      user_name: input.userName.trim().slice(0, 80) || (input.isOwner ? 'Coach' : 'Teilnehmer'),
      enable_prejoin_ui: true, enable_screenshare: true, enable_recording_ui: false,
    },
  })
  if (!tokenResponse.ok) return providerFailure()
  const result = await readJson(tokenResponse) as { token?: unknown }
  if (typeof result?.token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.token)) return providerFailure()
  await input.reauthorize()
  videoJoinWindow(window.startsAt, input.durationMinutes)
  return { roomUrl, token: result.token }
}
