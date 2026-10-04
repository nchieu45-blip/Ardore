import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { classifyAttempt, curlArguments, curlAttempt, diagnostics, parseCurlOutput, recoveryPolicy, recoveryUrl, runRecovery } from './run-coaching-recovery.mjs'

const baseUrl = 'https://www.ardore-health.com'
const secret = 'synthetic-cron-secret-never-log'
const counters = { reservations: { checked: 0, released: 0, confirmed: 0, reconciliation: 0, unresolved: 0, failed: 0 }, reconciled: 0, pending: 0, failed: 0 }
const response = (status = 200, exitCode = 0, body = JSON.stringify(counters)) => ({ exitCode, body,
  metrics: { http_code: status, remote_ip: '203.0.113.1', time_namelookup: 0.01, time_connect: 0.02,
    time_appconnect: 0.04, time_starttransfer: 0.1, time_total: 0.11 } })
async function runSequence(sequence) {
  const logs = [], delays = [], calls = []
  const success = await runRecovery({ baseUrl, secret, log: value => logs.push(value), pause: async value => delays.push(value),
    attempt: async args => { calls.push(args); return sequence[Math.min(calls.length - 1, sequence.length - 1)] } })
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(secret))
  return { success, logs, delays, calls }
}

test('network timeout retries with bounded exponential backoff and accepts an authentic application response', async () => {
  const f = await runSequence([response(0, 28, ''), response(0, 7, ''), response(503), response()])
  assert.equal(f.success, true); assert.equal(f.calls.length, 4)
  assert.deepEqual(f.delays, [2000, 4000, 8000]); assert.equal(f.logs.at(-1).event, 'recovery_accepted')
  assert.ok(f.calls.every(call => call.url === `${baseUrl}/api/cron/coaching-payments`))
})

test('persistent failures stop after four attempts and the total budget fits the five-minute job', async () => {
  const f = await runSequence([response(0, 28)])
  assert.equal(f.success, false); assert.equal(f.calls.length, 4); assert.equal(f.delays.length, 3)
  assert.equal(f.logs.at(-1).event, 'recovery_failed')
  assert.ok(recoveryPolicy.attempts * (recoveryPolicy.totalSeconds + 5) + recoveryPolicy.backoffMs.reduce((sum, delay) => sum + delay / 1000, 0) < 240)
})

for (const status of [301, 302, 400, 401, 403, 404, 405, 409, 422, 429, 501, 505]) {
  test(`HTTP ${status} is fatal even when the response body times out`, async () => {
    for (const exitCode of [0, 28]) {
      const f = await runSequence([response(status, exitCode), response()])
      assert.equal(f.success, false); assert.equal(f.calls.length, 1); assert.deepEqual(f.delays, [])
    }
  })
}
for (const status of [500, 502, 503, 504]) {
  test(`HTTP ${status} can retry safely`, async () => {
    const f = await runSequence([response(status), response()]); assert.equal(f.success, true); assert.equal(f.calls.length, 2)
  })
}
for (const exitCode of [6, 7, 28, 52, 55, 56]) {
  test(`curl network exit ${exitCode} can retry safely`, async () => {
    const f = await runSequence([response(0, exitCode), response()]); assert.equal(f.success, true)
  })
}
for (const exitCode of [3, 35, 60, 77, -1]) {
  test(`curl configuration/TLS exit ${exitCode} cannot be hidden by a retry`, async () => {
    const f = await runSequence([response(0, exitCode), response()]); assert.equal(f.success, false); assert.equal(f.calls.length, 1)
  })
}
test('HTTP 200 browser challenge, malformed JSON and private error bodies are never reported as success or logged', async () => {
  for (const body of ['<html>browser challenge PRIVATE CONTENT</html>', 'broken PRIVATE CONTENT', '{"error":"PRIVATE CONTENT"}', 'null']) {
    const f = await runSequence([response(200, 0, body), response()])
    assert.equal(f.success, false); assert.equal(f.calls.length, 1)
    assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE CONTENT/)
  }
})
test('only whitelisted aggregate recovery counters are emitted', async () => {
  const f = await runSequence([response(200, 0, JSON.stringify({ ...counters, private: secret,
    reservations: { ...counters.reservations, private: secret } }))])
  assert.equal(f.success, true); assert.deepEqual(f.logs.at(-1).reservations, counters.reservations)
  assert.equal('private' in f.logs.at(-1), false)
  assert.equal(classifyAttempt(response(200, 0, JSON.stringify({ ...counters, failed: 1 }))).retry, true)
})
test('timeout diagnostics distinguish DNS, TCP, TLS and HTTP wait without raw server output', () => {
  assert.equal(diagnostics(response(0, 6)).phase, 'dns')
  for (const [phase, changes] of [
    ['tcp_connect', { time_connect: 0, time_appconnect: 0, time_starttransfer: 0 }],
    ['tls_handshake', { time_appconnect: 0, time_starttransfer: 0 }],
    ['waiting_for_http', { time_starttransfer: 0 }],
  ]) {
    const result = response(0, 28); Object.assign(result.metrics, changes)
    assert.equal(diagnostics(result).phase, phase)
  }
  const result = response(); Object.assign(result.metrics, { remote_ip: secret, time_total: secret, errormsg: secret })
  assert.doesNotMatch(JSON.stringify(diagnostics(result)), new RegExp(secret))
})
test('configuration rejects alternate domains, HTTP and unsafe headers before attempting any request', async () => {
  for (const invalid of ['http://www.ardore-health.com', 'https://ardore-health.com', 'https://www.ardore-health.com@evil.invalid', `${baseUrl}/other`, undefined]) {
    assert.throws(() => recoveryUrl(invalid))
  }
  assert.equal(recoveryUrl(`${baseUrl}/`), `${baseUrl}/api/cron/coaching-payments`)
  for (const invalid of ['', undefined, 'injected\r\nX-Test: unsafe']) {
    let called = false
    assert.equal(await runRecovery({ baseUrl, secret: invalid, log() {}, attempt: async () => { called = true; return response() } }), false)
    assert.equal(called, false)
  }
})
test('curl preserves SSL verification, does not follow redirects and receives the secret only through stdin', async () => {
  let header = '', invocation
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options }
    const child = new EventEmitter()
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.stdin.on('data', chunk => { header += chunk.toString() })
    child.kill = () => {}
    queueMicrotask(() => {
      child.stderr.write(`PRIVATE PROVIDER ERROR ${secret}`)
      child.stdout.end(`${JSON.stringify(counters)}\n__ARDORE_RECOVERY_METRICS__\n${JSON.stringify(response().metrics)}`)
      child.emit('close', 0)
    })
    return child
  }
  const result = await curlAttempt({ url: recoveryUrl(baseUrl), secret, spawnProcess, env: { CRON_SECRET: secret, PATH: '/fixture' } })
  assert.equal(classifyAttempt(result).success, true); assert.equal(header, `Authorization: Bearer ${secret}\n`)
  assert.equal(invocation.command, 'curl'); assert.equal(invocation.args[0], '--disable')
  assert.deepEqual(invocation.args, curlArguments(recoveryUrl(baseUrl)))
  assert.doesNotMatch(JSON.stringify(invocation), new RegExp(secret))
  for (const forbidden of ['--insecure', '-k', '--location', '-L', '--retry', '--retry-all-errors']) assert.ok(!invocation.args.includes(forbidden))
  assert.equal(parseCurlOutput('missing diagnostics').metrics, null)
  assert.equal(parseCurlOutput('\n__ARDORE_RECOVERY_METRICS__\nnot JSON').metrics, null)
})
test('workflow syntax keeps recovery retries separate from non-idempotent email cron jobs', () => {
  const require = createRequire(import.meta.url)
  const yaml = require('js-yaml')
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/ardore-cron.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on.schedule.map(item => item.cron), ['*/10 * * * *', '0 8 * * *', '0 9 * * *'])
  const job = workflow.jobs['call-cron-endpoints']
  assert.equal(job['timeout-minutes'], 5); assert.equal(workflow.permissions.contents, 'read')
  const recovery = job.steps.find(step => step.name === 'Recover coaching payment reservations and refunds')
  assert.equal(recovery.run, 'node scripts/run-coaching-recovery.mjs')
  assert.match(recovery.if, /coaching|10/) // Existing recovery-only schedule is preserved.
  for (const step of job.steps.filter(step => /session cron|verification cleanup/.test(step.name))) {
    assert.doesNotMatch(step.run, /run-coaching-recovery|--retry/)
  }
})
