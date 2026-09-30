// Run from a trusted operator machine with the existing server environment loaded.
// Never prints the authentication header or any environment variable value.
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!secret) throw new Error('Existing server credential is unavailable')
const url = 'https://www.ardore-health.com/api/admin/email-test'
const headers = { Authorization: `Bearer ${secret}` }
const status = await fetch(url, { headers, redirect: 'error' })
const statusBody = await status.json()
console.log(JSON.stringify({ stage: 'runtime', status: status.status, ...statusBody }))
if (!status.ok || !statusBody.resendKeyPresent) process.exit(1)
const response = await fetch(url, { method: 'POST', headers, redirect: 'error' })
console.log(JSON.stringify({ stage: 'send', status: response.status, ...await response.json() }))
if (!response.ok) process.exitCode = 1
