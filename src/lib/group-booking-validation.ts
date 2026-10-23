export const validGroupId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function validGroupInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10)
}

/** Preserve PostgreSQL microseconds when comparing durable occurrence identity. */
export function sameGroupInstant(a: string, b: string) {
  const micros = (value: string) => BigInt(Date.parse(value)) * BigInt(1000)
    + BigInt((value.match(/\.(\d{1,6})/)?.[1] ?? '').padEnd(6, '0').slice(3))
  return validGroupInstant(a) && validGroupInstant(b) && micros(a) === micros(b)
}
