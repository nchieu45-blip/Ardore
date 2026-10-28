// Local confirmation/template fixtures. No real mail, Auth or database clients.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(file, overrides) {
  overrides = { '@/lib/group-effective-schedule': { effectiveGroupStart: async (_client, _class, start) => start }, ...overrides }
  const compiled=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText
  const fixtureModule={exports:{}}
  new Function('require','exports','module',compiled)(name=>name in overrides?overrides[name]:require(name),fixtureModule.exports,fixtureModule)
  return fixtureModule.exports
}
function fixture(changes={}) {
  const r={id:'reservation',buyer_id:'buyer',creator_id:'creator',class_title:'Trusted frozen title',occurrence_start:'2026-10-25T09:00:00Z',
    duration_minutes:60,price_cents:500,stripe_livemode:true,status:'confirmed',booking_id:'booking',refund_status:'not_requested',...changes.reservation}
  const calls={emails:[],inapp:[],auth:[],preferences:[],tables:[]}
  const service={from(table){
    calls.tables.push(table);let scoped=false
    return {select(){return this},eq(key,value){assert.equal(key,'id');assert.equal(value,table==='group_booking_reservations'?'reservation':'creator');scoped=true;return this},async maybeSingle(){
      assert.equal(scoped,true)
      return {data:table==='group_booking_reservations'?(changes.missing?null:r):{user_id:'coach',display_name:'Coach'},error:changes.databaseError?new Error('private details'):null}
    }}
  },auth:{admin:{async getUserById(id){calls.auth.push(id);return {data:{user:{email:`${id}@example.test`,user_metadata:{full_name:'Synthetic Buyer'}}},error:null}}}}}
  const lib=load('../src/lib/group-booking-notifications.ts',{
    '@/lib/app-url':{appOrigin:()=> 'https://www.ardore-health.com'},
    '@/lib/notifications':{async checkNotificationPreference(id,type,channel){calls.preferences.push({id,type,channel});return changes.preferences?.[channel]??true},
      async createNotification(args){calls.inapp.push(args);if(changes.deliveryError)throw new Error('synthetic failure')}},
    '@/lib/email/send':{async sendVideoClassConfirmation(to,data){calls.emails.push({to,data,type:'buyer'});if(changes.deliveryError)throw new Error('synthetic failure')},
      async sendVideoClassNewParticipant(to,data){calls.emails.push({to,data,type:'coach'});if(changes.deliveryError)throw new Error('synthetic failure')}},
  })
  return {calls,run:()=>lib.notifyGroupBookingConfirmed(service,'reservation')}
}
test('confirmed group sends frozen occurrence details and private dashboard entry only',async()=>{
  const f=fixture();await f.run();assert.equal(f.calls.emails.length,2);assert.equal(f.calls.inapp.length,1)
  const buyer=f.calls.emails.find(item=>item.type==='buyer')
  assert.equal(buyer.data.classTitle,'Trusted frozen title');assert.match(buyer.data.scheduleLabel,/25\. Oktober 2026/)
  assert.match(buyer.data.scheduleLabel,/10:00/,'Berlin winter time is explicit, independent of server timezone')
  assert.equal(buyer.data.roomUrl,null);assert.equal(buyer.data.bookingsUrl,'https://www.ardore-health.com/buyer/video-classes')
  assert.equal(f.calls.inapp[0].link,'/creator/settings/video-classes')
  assert.deepEqual(f.calls.auth,['buyer','coach']);assert.deepEqual(f.calls.tables,['group_booking_reservations','creator_profiles'])
})
test('pending, cancelled, refunding, missing and paid-test group reservations never send confirmation',async()=>{
  for(const changes of [{reservation:{status:'creating'}},{reservation:{status:'cancelled'}},{reservation:{booking_id:null}},
    {reservation:{refund_status:'pending'}},{reservation:{stripe_livemode:false}},{missing:true},{databaseError:true}]){
    const f=fixture(changes);await f.run();assert.equal(f.calls.emails.length,0);assert.equal(f.calls.inapp.length,0);assert.equal(f.calls.auth.length,0)
  }
})
test('confirmed free group retains buyer confirmation and respects coach preferences separately',async()=>{
  const f=fixture({reservation:{price_cents:0,stripe_livemode:null},preferences:{inapp:false,email:false}})
  await f.run();assert.equal(f.calls.emails.length,1);assert.equal(f.calls.emails[0].type,'buyer');assert.equal(f.calls.inapp.length,0)
  assert.deepEqual(f.calls.auth,['buyer']);assert.deepEqual(f.calls.preferences.map(p=>p.channel),['inapp','email'])
})
test('confirmation delivery failures cannot roll back or reject an already confirmed group booking',async()=>{
  const f=fixture({deliveryError:true});await assert.doesNotReject(f.run());assert.equal(f.calls.emails.length,2);assert.equal(f.calls.inapp.length,1)
})
test('group email HTML escapes coach-controlled titles/names while plain text preserves literal content',async()=>{
  const templates=load('../src/lib/email/templates.ts',{'@/lib/features':{VIDEO_CALLS_ENABLED:true}})
  const emails=[]
  const send=load('../src/lib/email/send.ts',{'./index':{FROM:'local@example.test',async sendEmail(args){emails.push(args)}},'./templates':templates})
  const title='<img src=x onerror="unsafe()"> & Training'
  await send.sendVideoClassConfirmation('buyer@example.test',{classTitle:title,coachName:'<b>Coach</b>',scheduleLabel:'Termin',durationMinutes:60,roomUrl:null,bookingsUrl:'https://www.ardore-health.com/buyer/video-classes'})
  await send.sendVideoClassNewParticipant('coach@example.test',{classTitle:title,coachName:'<b>Coach</b>',participantName:'<script>buyer</script>',scheduleLabel:'Termin',dashboardUrl:'https://www.ardore-health.com/creator/settings/video-classes'})
  for(const email of emails){assert.doesNotMatch(email.html,/<img src=x|<script>buyer|<b>Coach/);assert.match(email.html,/&lt;img src=x/);assert.ok(email.text.includes(title))}
})
