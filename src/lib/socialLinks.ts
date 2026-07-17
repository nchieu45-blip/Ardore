/**
 * Normalization, validation, and href-building for coach social media links.
 * Shared between the coach settings form (client) and the public coach
 * profile page (server) so both sides agree on what a "clean" value looks
 * like and how it turns into a safe, clickable URL.
 *
 * Stored shape (creator_profiles.social_links, see migration 018):
 *   { instagram?: string; tiktok?: string; youtube?: string; website?: string }
 * - instagram / tiktok: bare handle, no "@", no domain.
 * - youtube: either a bare handle (no "@") or a full http(s) URL.
 * - website: a full http(s) URL.
 */

export interface SocialLinks {
  instagram?: string
  tiktok?: string
  youtube?: string
  website?: string
}

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/

/** If `raw` is a full profile URL for `host`, pull the first path segment out as the handle. */
function stripHandleFromUrl(raw: string, host: string): string | null {
  if (!/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    if (url.hostname.replace(/^www\./i, '').toLowerCase() !== host) return null
    const segment = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? ''
    return segment
  } catch {
    return null
  }
}

/** Accepts "@name", "name", or a full profile URL for `host` — always returns a bare handle. */
function normalizeHandle(raw: string, host: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const fromUrl = stripHandleFromUrl(trimmed, host)
  return (fromUrl ?? trimmed).replace(/^@/, '').trim()
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle)
}

export function normalizeInstagram(raw: string): string {
  return normalizeHandle(raw, 'instagram.com')
}

export function normalizeTiktok(raw: string): string {
  return normalizeHandle(raw, 'tiktok.com')
}

/** YouTube accepts either a handle or a full channel URL — stored as whichever was given. */
export function normalizeYoutube(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return trimmed.replace(/^@/, '').trim()
}

export function isValidYoutube(value: string): boolean {
  if (!value) return true
  if (/^https?:\/\//i.test(value)) return isHttpUrl(value)
  return isValidHandle(value)
}

export function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isValidWebsite(value: string): boolean {
  if (!value) return true
  return isHttpUrl(value)
}

// ── Href builders ────────────────────────────────────────────────────────
// Every href is assembled from a hardcoded base + the normalized handle only
// (never the raw stored value), so a corrupted/legacy row can't smuggle in a
// javascript: URL or an unexpected host.

export function instagramHref(handle: string): string | null {
  return isValidHandle(handle) ? `https://instagram.com/${handle}` : null
}

export function tiktokHref(handle: string): string | null {
  return isValidHandle(handle) ? `https://www.tiktok.com/@${handle}` : null
}

export function youtubeHref(value: string): string | null {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return isHttpUrl(value) ? value : null
  return isValidHandle(value) ? `https://youtube.com/@${value}` : null
}

/** Renders only if the stored value already is a well-formed http(s) URL — never javascript: or other schemes. */
export function websiteHref(value: string): string | null {
  if (!value) return null
  return isHttpUrl(value) ? value : null
}
