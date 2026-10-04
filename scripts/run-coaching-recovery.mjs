import { spawn } from 'node:child_process'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

// Only this idempotent recovery endpoint is retried. Reminder emails are not.
export const recoveryPolicy = Object.freeze({ attempts: 4, connectSeconds: 10, totalSeconds: 45, backoffMs: [2000, 4000, 8000] })
const marker = '\n__ARDORE_RECOVERY_METRICS__\n'
const retryableNetwork = new Set([6, 7, 28, 52, 55, 56])
const retryableHttp = new Set([500, 502, 503, 504])
const reservationKeys = ['checked', 'released', 'confirmed', 'reconciliation', 'unresolved', 'failed']
const summaryKeys = ['reconciled', 'pending', 'failed']

export function recoveryUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.replace(/\/+$/, '') !== 'https://www.ardore-health.com') {
    throw new Error('invalid_production_base_url')
  }
  return 'https://www.ardore-health.com/api/cron/coaching-payments'
}

export function curlArguments(url) {
  return ['--disable', '--silent', '--show-error', '--proto', '=https',
    '--connect-timeout', String(recoveryPolicy.connectSeconds), '--max-time', String(recoveryPolicy.totalSeconds),
    '--header', '@-', '--write-out', `${marker}%{json}`, url]
}

export function parseCurlOutput(output) {
  const index = output.lastIndexOf(marker)
  if (index < 0) return { body: '', metrics: null }
  try { return { body: output.slice(0, index), metrics: JSON.parse(output.slice(index + marker.length)) } }
  catch { return { body: '', metrics: null } }
}

export function curlAttempt({ url, secret, spawnProcess = spawn, env = process.env }) {
  return new Promise(resolve => {
    // Header is passed through stdin, never argv, a file, or diagnostic output.
    const childEnv = { ...env }
    delete childEnv.CRON_SECRET
    const child = spawnProcess('curl', curlArguments(url), { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let oversized = false
    const watchdog = setTimeout(() => child.kill('SIGKILL'), (recoveryPolicy.totalSeconds + 5) * 1000)
    child.stdout.on('data', chunk => {
      if (oversized) return
      output += chunk.toString()
      if (Buffer.byteLength(output) > 1_048_576) { oversized = true; output = ''; child.kill('SIGKILL') }
    })
    // Raw curl errors / HTTP bodies may contain sensitive server content.
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.on('error', () => { clearTimeout(watchdog); resolve({ exitCode: -1, body: '', metrics: null }) })
    child.on('close', code => {
      clearTimeout(watchdog)
      resolve({ exitCode: oversized ? -1 : code ?? -1, ...parseCurlOutput(output) })
    })
    child.stdin.end(`Authorization: Bearer ${secret}\n`)
  })
}

function timing(metrics, key) {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function diagnostics(result) {
  const m = result.metrics
  const status = Number.isInteger(m?.http_code) && m.http_code >= 0 && m.http_code <= 599 ? m.http_code : 0
  const tcp = timing(m, 'time_connect')
  const tls = timing(m, 'time_appconnect')
  const firstByte = timing(m, 'time_starttransfer')
  let phase = 'unknown'
  if (status) phase = 'http_response'
  else if (result.exitCode === 6) phase = 'dns'
  else if (firstByte > 0) phase = 'response_body'
  else if (tls > 0) phase = 'waiting_for_http'
  else if (tcp > 0) phase = 'tls_handshake'
  else if (timing(m, 'time_namelookup') > 0) phase = 'tcp_connect'
  return { curl_exit: result.exitCode, http_status: status, phase,
    remote_ip: typeof m?.remote_ip === 'string' && isIP(m.remote_ip) ? m.remote_ip : null,
    dns_seconds: timing(m, 'time_namelookup'), tcp_seconds: tcp, tls_seconds: tls,
    first_byte_seconds: firstByte, total_seconds: timing(m, 'time_total') }
}

function applicationSummary(body) {
  let data
  try { data = JSON.parse(body) } catch { return null }
  const counter = value => Number.isSafeInteger(value) && value >= 0
  if (!data || !summaryKeys.every(key => counter(data[key]))
    || !reservationKeys.every(key => counter(data.reservations?.[key]))) return null
  return { reservations: Object.fromEntries(reservationKeys.map(key => [key, data.reservations[key]])),
    ...Object.fromEntries(summaryKeys.map(key => [key, data[key]])) }
}

export function classifyAttempt(result) {
  const { http_status: status } = diagnostics(result)
  // A known non-retryable HTTP response takes precedence over a body timeout.
  if (status && status !== 200 && !retryableHttp.has(status)) return { retry: false, reason: `http_${status}` }
  if (result.exitCode !== 0) return { retry: retryableNetwork.has(result.exitCode), reason: 'transport_error' }
  if (retryableHttp.has(status)) return { retry: true, reason: `http_${status}` }
  if (status !== 200) return { retry: false, reason: 'missing_http_response' }
  const summary = applicationSummary(result.body)
  if (!summary) return { retry: false, reason: 'invalid_application_response' }
  if (summary.failed || summary.reservations.failed || summary.reservations.unresolved) {
    return { retry: true, reason: 'application_recovery_incomplete' }
  }
  return { success: true, summary }
}

export async function runRecovery({ baseUrl, secret, attempt = curlAttempt, pause = sleep, log = value => console.log(JSON.stringify(value)) }) {
  let url
  try { url = recoveryUrl(baseUrl) } catch { log({ event: 'recovery_failed', reason: 'invalid_production_base_url' }); return false }
  if (typeof secret !== 'string' || !secret.length || secret.length > 4096 || /[\r\n]/.test(secret)) {
    log({ event: 'recovery_failed', reason: 'missing_or_invalid_cron_secret' }); return false
  }
  log({ event: 'recovery_started', ...recoveryPolicy })
  for (let number = 1; number <= recoveryPolicy.attempts; number++) {
    let result
    try { result = await attempt({ url, secret }) }
    catch { result = { exitCode: -1, body: '', metrics: null } }
    const outcome = classifyAttempt(result)
    log({ event: 'recovery_attempt', attempt: number, ...diagnostics(result), result: outcome.success ? 'accepted' : outcome.reason })
    if (outcome.success) { log({ event: 'recovery_accepted', attempt: number, ...outcome.summary }); return true }
    if (!outcome.retry || number === recoveryPolicy.attempts) {
      log({ event: 'recovery_failed', reason: outcome.reason, attempts: number }); return false
    }
    const delay = recoveryPolicy.backoffMs[number - 1]
    log({ event: 'recovery_retry', next_attempt: number + 1, delay_ms: delay })
    await pause(delay)
  }
  return false
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRecovery({ baseUrl: process.env.ARDORE_BASE_URL, secret: process.env.CRON_SECRET })
    .then(success => { process.exitCode = success ? 0 : 1 })
    .catch(() => { console.error('Recovery runner failed'); process.exitCode = 1 })
}
