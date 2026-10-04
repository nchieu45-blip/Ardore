import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { diagnostics } from './run-coaching-recovery.mjs'

const execute = promisify(execFile)
export function dnsAddresses(output) {
  return [...new Set(output.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(address => isIP(address)))]
}
export function probeArguments(url, ipv4 = false) {
  return ['--disable', '--silent', '--show-error', '--proto', '=https',
    '--connect-timeout', '10', '--max-time', '15', '--output', '/dev/null', '--write-out', '%{json}',
    ...(ipv4 ? ['--ipv4'] : []), url]
}

// Public requests only; no credentials, redirects, alternate production domain
// or payment endpoint. A successful probe never changes the failed job result.
async function probe(label, url, ipv4 = false) {
  let output, exitCode = 0
  try { output = await execute('curl', probeArguments(url, ipv4), { timeout: 20_000, maxBuffer: 65_536 }) }
  catch (error) { output = error; exitCode = typeof error.code === 'number' ? error.code : -1 }
  let metrics = null
  try { metrics = JSON.parse(output.stdout) } catch {}
  console.log(JSON.stringify({ event: 'recovery_network_probe', probe: label, ...diagnostics({ exitCode, metrics }) }))
}
async function dns() {
  const started = performance.now()
  let addresses = []
  try { const result = await execute('getent', ['ahosts', 'www.ardore-health.com'], { timeout: 5000 }); addresses = dnsAddresses(result.stdout) }
  catch {}
  console.log(JSON.stringify({ event: 'recovery_dns_probe', resolved_ips: addresses,
    lookup_succeeded: addresses.length > 0, total_seconds: (performance.now() - started) / 1000 }))
}
export async function diagnoseNetwork() {
  await Promise.all([dns(),
    probe('ardore_homepage', 'https://www.ardore-health.com/'),
    probe('ardore_homepage_ipv4', 'https://www.ardore-health.com/', true),
    probe('github_api_control', 'https://api.github.com/'),
  ])
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  diagnoseNetwork().catch(() => { console.error('Public network diagnostics unavailable'); process.exitCode = 1 })
}
