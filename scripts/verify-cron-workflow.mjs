import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

// These tests evaluate workflow conditions and execute shell snippets with a
// synthetic curl executable only. No HTTP request or production job is run.
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const workflow = yaml.load(readFileSync(new URL('../.github/workflows/ardore-cron.yml', import.meta.url), 'utf8'))
const job = workflow.jobs['call-cron-endpoints']
const reminders = workflow.jobs['session-reminders']
const steps = Object.fromEntries([...reminders.steps, ...job.steps].filter(step => step.id).map(step => [step.id, step]))
const secret = 'fixture-cron-credential-not-real'
const baseUrl = 'https://www.ardore-health.com'
const endpointIds = ['reminders', 'review-prompts', 'cleanup']

function enabled(id, { schedule, target = 'all', manual = false, configuration = 'success', checkout = 'success', cancelled = false, recovery = 'success' } = {}) {
  const context = {
    cancelled: () => cancelled,
    github: { event_name: manual ? 'workflow_dispatch' : 'schedule', event: { schedule } },
    inputs: { target },
    steps: { configuration: { outcome: configuration }, checkout: { outcome: checkout }, recovery: { outcome: recovery } },
  }
  const evaluate = expression => runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), context)
  return evaluate((id === 'reminders' ? reminders : job).if) && evaluate(steps[id].if)
}

test('YAML preserves permissions and recovery/cleanup schedules without a duplicate 08:00 sweep', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(workflow.on.schedule.map(item => item.cron), ['*/10 * * * *', '4-54/10 * * * *', '0 9 * * *'])
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.target.options, ['all', 'coaching-payments'])
  assert.equal(job['timeout-minutes'], 10)
  assert.equal(job.env.ARDORE_BASE_URL, '${{ vars.ARDORE_BASE_URL }}')
  assert.equal(job.env.CRON_SECRET, undefined)
  assert.equal(steps.checkout.with['persist-credentials'], false)
})

test('every-ten-minute session checks coexist with recovery and daily cleanup', () => {
  for (const id of ['checkout', 'recovery', 'reminders', 'review-prompts']) assert.equal(enabled(id, { schedule: '*/10 * * * *' }), true, id)
  assert.equal(enabled('cleanup', { schedule: '*/10 * * * *' }), false)
  assert.equal(enabled('reminders', { schedule: '4-54/10 * * * *' }), true)
  for (const id of ['checkout', 'recovery', 'review-prompts', 'cleanup']) {
    assert.equal(enabled(id, { schedule: '4-54/10 * * * *' }), false, id)
  }
  assert.equal(reminders.needs, undefined)
  assert.equal(reminders['timeout-minutes'], 4)
  assert.equal(reminders.steps[0].run, steps.configuration.run)
  for (const id of ['recovery', ...endpointIds]) assert.equal(enabled(id, { schedule: '0 8 * * *' }), false, id)
  assert.equal(enabled('cleanup', { schedule: '0 9 * * *' }), true)
  for (const id of ['recovery', 'reminders', 'review-prompts']) assert.equal(enabled(id, { schedule: '0 9 * * *' }), false, id)
  for (const id of ['recovery', ...endpointIds]) assert.equal(enabled(id, { schedule: 'unrecognized' }), false, id)
})

test('manual all and recovery-only targets retain their exact endpoint scopes', () => {
  for (const id of ['recovery', ...endpointIds]) assert.equal(enabled(id, { manual: true }), true, id)
  assert.equal(enabled('recovery', { manual: true, target: 'coaching-payments' }), true)
  for (const id of endpointIds) assert.equal(enabled(id, { manual: true, target: 'coaching-payments' }), false, id)
})

test('failed recovery/checkout or another endpoint does not suppress independent requests', () => {
  for (const id of endpointIds) {
    assert.match(steps[id].if, /!cancelled\(\)/)
    assert.doesNotMatch(steps[id].if, /success\(\)|steps\.(?:recovery|checkout|reminders|review-prompts)\./)
    assert.equal(enabled(id, { manual: true, recovery: 'failure', checkout: 'failure' }), true, id)
    assert.equal(steps[id]['continue-on-error'], undefined)
  }
  assert.equal(steps.recovery['continue-on-error'], undefined)
  assert.equal(job['continue-on-error'], undefined)
})

test('configuration failures and cancelled runs prevent every authenticated request', () => {
  for (const id of ['recovery', ...endpointIds]) {
    assert.equal(enabled(id, { manual: true, configuration: 'failure' }), false, id)
    assert.equal(enabled(id, { manual: true, cancelled: true }), false, id)
  }
  assert.equal(enabled('recovery', { manual: true, checkout: 'failure' }), false)
})

test('all workflow shell blocks parse without executing commands', () => {
  for (const step of [...job.steps, ...reminders.steps].filter(step => step.run)) {
    const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' })
    assert.equal(result.status, 0, `${step.name}: ${result.stderr}`)
  }
})

test('configuration rejects noncanonical origins and missing/header-unsafe credentials without disclosure', () => {
  for (const [origin, credential, expected] of [
    [baseUrl, secret, 0], [`${baseUrl}/`, secret, 0],
    [baseUrl, '', 1], [baseUrl, 'bad\r\nX-Injected: yes', 1], [baseUrl, 'x'.repeat(4097), 1],
    ['http://www.ardore-health.com', secret, 1], ['https://ardore-health.com', secret, 1],
    [`${baseUrl}/path`, secret, 1], [`${baseUrl}@example.invalid`, secret, 1], ['', secret, 1],
  ]) {
    const result = spawnSync('bash', ['-c', steps.configuration.run], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ARDORE_BASE_URL: origin, CRON_SECRET: credential },
    })
    assert.equal(result.status, expected)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret))
    assert.doesNotMatch(result.stdout + result.stderr, /X-Injected/)
  }
  const missing = spawnSync('bash', ['-c', steps.configuration.run], { encoding: 'utf8', env: { PATH: process.env.PATH, ARDORE_BASE_URL: baseUrl } })
  assert.equal(missing.status, 1)
})

test('endpoint shell steps accept only 2xx, fail on transport errors and keep credentials out of curl argv/env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ardore-cron-workflow-'))
  const capture = join(directory, 'capture.json')
  const curl = join(directory, 'curl')
  writeFileSync(curl, `#!/usr/bin/env node
const fs = require('node:fs');
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const attempts = process.env.FIXTURE_CAPTURE + '.attempts';
  const attempt = fs.existsSync(attempts) ? fs.readFileSync(attempts, 'utf8').length + 1 : 1;
  fs.appendFileSync(attempts, '.');
  fs.writeFileSync(process.env.FIXTURE_CAPTURE, JSON.stringify({
    args: process.argv.slice(2), headerMatches: input === 'Authorization: Bearer ${secret}\\n',
    secretInEnvironment: process.env.CRON_SECRET !== undefined,
  }));
  process.stdout.write(attempt === 2 && process.env.FIXTURE_RECOVERS ? '200' : process.env.FIXTURE_STATUS);
  process.exitCode = Number(process.env.FIXTURE_EXIT);
});
`, { mode: 0o700 })
  writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  try {
    for (const id of endpointIds) {
      const step = steps[id]
      assert.equal(step.env.CRON_SECRET, '${{ secrets.CRON_SECRET }}')
      for (const [status, exitCode, expected] of [
        ['200', 0, 0], ['201', 0, 0], ['204', 0, 0], ['299', 0, 0],
        ['199', 0, 1], ['301', 0, 1], ['302', 0, 1], ['400', 0, 1], ['401', 0, 1],
        ['404', 0, 1], ['429', 0, 1], ['500', 0, 1], ['503', 0, 1], ['000', 28, 1], ['200', 7, 1],
      ]) {
        writeFileSync(capture + '.attempts', '')
        const result = spawnSync('bash', ['-c', step.run], { encoding: 'utf8', env: {
          PATH: `${directory}:${process.env.PATH}`, ARDORE_BASE_URL: `${baseUrl}/`, CRON_SECRET: secret,
          FIXTURE_CAPTURE: capture, FIXTURE_STATUS: status, FIXTURE_EXIT: String(exitCode),
        } })
        assert.equal(result.status, expected, `${id}: HTTP ${status}, curl ${exitCode}`)
        const transient = exitCode || status === '429' || /^5/.test(status)
        assert.equal(readFileSync(capture + '.attempts', 'utf8').length, id === 'reminders' && transient ? 3 : 1)
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret))
        const invocation = JSON.parse(readFileSync(capture, 'utf8'))
        assert.equal(invocation.headerMatches, true)
        assert.equal(invocation.secretInEnvironment, false)
        assert.doesNotMatch(JSON.stringify(invocation.args), new RegExp(secret))
        assert.equal(invocation.args[0], '--disable')
        for (const forbidden of ['--insecure', '-k', '--location', '-L', '--retry', '--retry-all-errors', '--verbose', '-v']) assert.equal(invocation.args.includes(forbidden), false)
        for (const [flag, value] of [['--proto', '=https'], ['--connect-timeout', '10'], ['--max-time', '60'], ['--header', '@-'], ['--output', '/dev/null']]) {
          assert.equal(invocation.args[invocation.args.indexOf(flag) + 1], value, flag)
        }
        const endpoint = { reminders: 'session-reminders', 'review-prompts': 'session-review-prompts', cleanup: 'cleanup-verification-docs' }[id]
        assert.equal(invocation.args.at(-1), `${baseUrl}/api/cron/${endpoint}`)
      }
    }
    writeFileSync(capture + '.attempts', '')
    const retry = spawnSync('bash', ['-c', steps.reminders.run], { encoding: 'utf8', env: {
      PATH: `${directory}:${process.env.PATH}`, ARDORE_BASE_URL: baseUrl, CRON_SECRET: secret,
      FIXTURE_CAPTURE: capture, FIXTURE_STATUS: '503', FIXTURE_EXIT: '0', FIXTURE_RECOVERS: '1',
    } })
    assert.equal(retry.status, 0)
    assert.equal(readFileSync(capture + '.attempts', 'utf8').length, 2)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
