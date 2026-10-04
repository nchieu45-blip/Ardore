// Opt-in Auth rollout test. Secrets and emailed token hashes stay in memory.
// auth.users is READ ONLY here; all fixture writes/deletes use GoTrue.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
if (!process.argv.includes('--run-production-synthetic')) { console.log('Skipped: requires --run-production-synthetic'); process.exit(0) }
process.loadEnvFile('.env.local')
const project = 'yboeyxqeileicecqpwke'
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${project}.supabase.co`)
const base = 'https://www.ardore-health.com'
const managementToken = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
assert.ok(managementToken.startsWith('sbp_'), 'Existing CLI credential required')
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}})
const users = [], fixtureEmails = []
const tag = `ardore-confirm-${randomUUID().slice(0,12)}`
const pass = label => console.log(`PASS ${label}`)
let stage = 'initial audit', server, timeout, baseline, originalConfig, changedConfig = false, emailDeliveryVerified = false
async function manage(path, method='GET', body) {
 const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`, {method,headers:{Authorization:`Bearer ${managementToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
 assert.ok(response.ok, `Management ${path} accepted (${response.status})`)
 return response.json()
}
async function readAuth(query) { return manage('database/query','POST',{query}) }
async function check(promise) { const r=await promise;assert.ok(!r.error,`Fixture API succeeded (${r.error?.code??r.error?.status??'unknown'})`);return r.data }
function actor() {
 const cookies = new Map()
 const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:rows=>rows.forEach(({name,value})=>cookies.set(name,value))}})
 return {client,cookies,email:`delivered+${tag}-${fixtureEmails.length}@resend.dev`,password:randomBytes(32).toString('base64url')}
}
const cookieHeader = actor => [...actor.cookies].map(([name,value])=>`${name}=${value}`).join('; ')
async function page(path,actor) {return fetch(`${base}${path}`, {headers:actor?{Cookie:cookieHeader(actor)}:{},redirect:'manual'})}
async function emailedHash(id,kind) {
 assert.ok(users.includes(id)&&/^[0-9a-f-]{36}$/.test(id),'Only owned synthetic fixture tokens may be read')
 const rows=await readAuth(`select ${kind==='recovery'?'recovery_token':'confirmation_token'} as token from auth.users where id='${id}'::uuid`)
 assert.ok(Array.isArray(rows)&&typeof rows[0]?.token==='string'&&rows[0].token.length>0,'Synthetic emailed token is present')
 return rows[0].token
}
async function callback(hash,type,actor) {
 const r=await page(`/auth/callback?${new URLSearchParams({token_hash:hash,type,next:type==='recovery'?'/reset-password':'/verify-success'})}`,actor)
 for(const header of r.headers.getSetCookie()) {const pair=header.split(';')[0],index=pair.indexOf('=');actor.cookies.set(pair.slice(0,index),pair.slice(index+1))}
 assert.ok(r.status===307||r.status===303,'Production callback responds with redirect')
 assert.equal(r.headers.get('referrer-policy'),'no-referrer')
 assert.ok(r.headers.get('cache-control')?.includes('no-store'))
 return new URL(r.headers.get('location'),base).pathname
}
try {
 originalConfig=await manage('config/auth')
 baseline=await readAuth('select id, email_confirmed_at, banned_until from auth.users order by id')
 assert.ok(baseline.every(row=>row.email_confirmed_at),'No existing unconfirmed accounts need handling')
 assert.equal(originalConfig.site_url,base)
 assert.ok(originalConfig.smtp_host==='smtp.resend.com'&&Boolean(originalConfig.smtp_pass),'Existing working Resend SMTP required')
 const existing=actor();fixtureEmails.push(existing.email)
 const oldUser=await check(service.auth.admin.createUser({email:existing.email,password:existing.password,email_confirm:true,user_metadata:{full_name:'Synthetic confirmed account',role:'buyer'}}))
 existing.id=oldUser.user.id;users.push(existing.id)
 const oldSession=await check(existing.client.auth.signInWithPassword({email:existing.email,password:existing.password}))
 assert.ok(oldSession.session,'Existing confirmed synthetic user has a session before configuration change')
 stage='enable email confirmation'
 if(originalConfig.mailer_autoconfirm) {
  assert.ok(process.argv.includes('--enable-confirmation'),'Explicit rollout flag required to change Auth configuration')
  await manage('config/auth','PATCH',{mailer_autoconfirm:false});changedConfig=true
 }
 const after=await manage('config/auth')
 assert.equal(after.mailer_autoconfirm,false)
 for(const key of new Set([...Object.keys(originalConfig),...Object.keys(after)]))if(key!=='mailer_autoconfirm')assert.ok(JSON.stringify(after[key])===JSON.stringify(originalConfig[key]),`Other Auth setting preserved: ${key}`)
 assert.ok((await check(existing.client.auth.getUser(oldSession.session.access_token))).user.id===existing.id,'Existing session remains usable')
 await check(existing.client.auth.signInWithPassword({email:existing.email,password:existing.password}))
 pass('only mailer_autoconfirm changed; existing confirmed login and session preserved')
 stage='new signup and SMTP confirmation'
 const buyer=actor();fixtureEmails.push(buyer.email)
 const signed=await check(buyer.client.auth.signUp({email:buyer.email,password:buyer.password,options:{data:{full_name:'Synthetic confirmation account',role:'buyer'},emailRedirectTo:`${base}/auth/callback?next=/verify-success&type=signup`}}))
 assert.ok(signed.user?.id,'Synthetic signup created account');buyer.id=signed.user.id;users.push(buyer.id)
 assert.ok(!signed.session&&!signed.user.email_confirmed_at,'No session or confirmation before verification')
 assert.ok(!(await check(buyer.client.auth.getSession())).session,'No normal client session')
 const blocked=await buyer.client.auth.signInWithPassword({email:buyer.email,password:buyer.password})
 assert.ok(blocked.error?.code==='email_not_confirmed'&&!blocked.data.session,'Unconfirmed login is blocked')
 const anonymous=await page('/buyer',buyer)
 assert.ok(anonymous.status===307&&new URL(anonymous.headers.get('location'),base).pathname==='/login','Unconfirmed user cannot access dashboard')
 const firstHash=await emailedHash(buyer.id,'signup')
 emailDeliveryVerified=true
 pass('signup SMTP accepted; no session; unconfirmed login and dashboard blocked')
 stage='confirmation resend'
 console.log('Waiting for existing 60-second SMTP resend cooldown')
 await new Promise(resolve=>setTimeout(resolve,61000))
 await check(buyer.client.auth.resend({type:'signup',email:buyer.email,options:{emailRedirectTo:`${base}/auth/callback?next=/verify-success&type=signup`}}))
 const latestHash=await emailedHash(buyer.id,'signup')
 // Depending on GoTrue version a resend may re-use an unexpired hash. Never assume rotation.
 assert.ok(typeof firstHash==='string'&&latestHash.length>0)
 pass('one explicit confirmation resend accepted by existing SMTP')
 stage='production confirmation callback'
 assert.equal(await callback(latestHash,'signup',buyer),'/verify-success')
 const landing=await page('/verify-success',buyer)
 assert.ok(landing.status===307&&new URL(landing.headers.get('location'),base).pathname==='/buyer/onboarding','Confirmed signup reaches buyer onboarding')
 const fromCookies=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...buyer.cookies].map(([name,value])=>({name,value})),setAll:rows=>rows.forEach(({name,value})=>buyer.cookies.set(name,value))}})
 assert.ok((await check(fromCookies.auth.getUser())).user.id===buyer.id,'Production callback created authenticated cookie session')
 assert.ok((await check(buyer.client.auth.signInWithPassword({email:buyer.email,password:buyer.password}))).session,'Confirmed login succeeds')
 assert.equal(await callback(latestHash,'signup',actor()),'/verify-email','Consumed token cannot authenticate again')
 assert.equal(await callback(randomBytes(32).toString('hex'),'signup',actor()),'/verify-email','Invalid confirmation token fails clearly')
 pass('deployed callback confirms actual emailed token, sets session and onboarding redirect; invalid/used links rejected')
 stage='password reset regression'
 await check(buyer.client.auth.resetPasswordForEmail(buyer.email,{redirectTo:`${base}/auth/callback?next=/reset-password&type=recovery`}))
 const recoveryHash=await emailedHash(buyer.id,'recovery')
 const recovery=actor()
 assert.equal(await callback(recoveryHash,'recovery',recovery),'/reset-password')
 const resetPage=await page('/reset-password',recovery);assert.equal(resetPage.status,200)
 const recoveryClient=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...recovery.cookies].map(([name,value])=>({name,value})),setAll:rows=>rows.forEach(({name,value})=>recovery.cookies.set(name,value))}})
 const newPassword=randomBytes(32).toString('base64url')
 await check(recoveryClient.auth.updateUser({password:newPassword}))
 assert.ok((await check(buyer.client.auth.signInWithPassword({email:buyer.email,password:newPassword}))).session,'Login with reset password succeeds')
 assert.equal(await callback(recoveryHash,'recovery',actor()),'/forgot-password','Consumed recovery link fails on reset guidance')
 pass('actual SMTP password reset, production recovery callback, synthetic password update and login succeed')
 stage='creator onboarding redirect'
 // No extra email: only this synthetic confirmed fixture gets a generated test link.
 const creator=actor();fixtureEmails.push(creator.email)
 const created=await check(service.auth.admin.createUser({email:creator.email,password:creator.password,email_confirm:true,user_metadata:{full_name:'Synthetic coach confirmation',role:'creator'}}))
 creator.id=created.user.id;users.push(creator.id)
 const generated=await check(service.auth.admin.generateLink({type:'magiclink',email:creator.email}))
 assert.equal(await callback(generated.properties.hashed_token,'magiclink',creator),'/verify-success')
 const creatorLanding=await page('/verify-success',creator)
 assert.ok(new URL(creatorLanding.headers.get('location'),base).pathname==='/creator/onboarding','Coach lands at existing coach onboarding')
 pass('confirmed coach reaches existing coach onboarding; no coach/payment behavior changed')
 if(process.argv.includes('--browser')){
  stage='mobile review';let finish;const completed=new Promise(resolve=>{finish=resolve})
  server=createServer(async(req,res)=>{
   try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Read-only Auth preview');return}
    if(req.url==='/ux-finish'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<p>Synthetic Auth review finished.</p>');finish();return}
    const r=await fetch(`${base}${req.url}`,{redirect:'manual'})
    res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([name])=>!['content-encoding','content-length','transfer-encoding','set-cookie'].includes(name))));res.end(Buffer.from(await r.arrayBuffer()))
   }catch{res.writeHead(503);res.end('Synthetic preview unavailable')}
  })
  await new Promise(resolve=>server.listen(3011,'127.0.0.1',resolve));timeout=setTimeout(finish,10*60*1000)
  console.log('BROWSER REVIEW READY http://127.0.0.1:3011/register (read-only)')
  await completed;pass('mobile Auth review completed')
 }
} catch {
 console.error(`SYNTHETIC AUTH FAILED at: ${stage}`);process.exitCode=1
 // Restore only our config flag if the very first SMTP signup failed. Do not reopen
 // auto-confirmation after successful delivery or silently undo a healthy rollout.
 if(changedConfig&&!emailDeliveryVerified){await manage('config/auth','PATCH',{mailer_autoconfirm:originalConfig.mailer_autoconfirm});console.log('Restored original auto-confirm setting because SMTP rollout was not verified')}
} finally {
 if(timeout)clearTimeout(timeout);if(server)await new Promise(resolve=>server.close(resolve))
 // Recover a just-created fixture ID if the provider failed after inserting a user.
 for(const email of fixtureEmails){const {data}=await service.auth.admin.listUsers({page:1,perPage:1000});for(const user of data?.users??[])if(user.email===email&&!users.includes(user.id))users.push(user.id)}
 for(const id of users)await check(service.auth.admin.deleteUser(id))
 const finalUsers=await readAuth('select id, email_confirmed_at, banned_until from auth.users order by id')
 assert.ok(JSON.stringify(finalUsers)===JSON.stringify(baseline),'Existing real users and confirmation state unchanged; all synthetic users removed')
 pass('all synthetic users removed; existing real users and confirmation state untouched')
}
if(!process.exitCode)console.log('SYNTHETIC AUTH CONFIRMATION SUCCESS')
