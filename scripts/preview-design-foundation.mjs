// Local-only, read-only visual fixtures. No database, auth, Stripe or email calls.
// Uses the actual protected page/components with mocked reads; never a production route.
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const h = React.createElement
const date = '2026-10-05'
const now = Date.parse(`${date}T07:00:00Z`)
const profile = { id:'synthetic-ui-user',full_name:'UI Test',email:'ui@example.invalid',role:'creator' }
const coach = { id:'synthetic-ui-coach',user_id:profile.id,display_name:'UI Test Coach',slug:'synthetic-ui-coach',category:'yoga',categories:['yoga'],is_published:true,stripe_account_active:true }
const product = { id:'synthetic-ui-product',title:'Trainingsplan für einen aktiven Alltag',price:39,amount_paid:39,type:'pdf',created_at:`${date}T08:00:00Z`,is_published:true,creator_id:coach.id,product:{title:'Trainingsplan für einen aktiven Alltag',type:'pdf',creator:{display_name:coach.display_name,slug:coach.slug}},payment_status:'paid',stripe_livemode:true }
const totals = { gross:10000,retained:10000,fee:1000,net:9000,transferred:9000,pending:0,refunded:0,reversalPending:0,refundPending:0,reversed:0,payments:1 }
const earnings = {all:totals,month:totals,testMode:true,legacy:{products:0,bookings:0,subscriptions:0,unclear:0,knownProductGross:0,knownBookingGross:0},days:[],sources:[]}
function client(role) {
  return {auth:{getUser:async()=>({data:{user:profile}})},from(table){
    const data=table==='profiles'?{...profile,role}:table==='creator_profiles'?coach:table==='products'||table==='purchases'?[product]:[]
    return { select(){return this},eq(){return this},neq(){return this},gte(){return this},order(){return this},limit(){return this},in(){return this},single:async()=>({data}),maybeSingle:async()=>({data}),then(resolve){resolve({data,error:null,count:0})} }
  }
}
}
const calendarData = {
  loadedAt:now,
  availability:{ slots:Array.from({length:7},(_,day_of_week)=>({day_of_week,start_time:'09:00',end_time:'17:00'})),dateOverrides:[],offer:{is_enabled:true,min_notice_hours:0,max_horizon_days:60,buffer_minutes:15} },
  bookings:[{id:'synthetic-ui-booking',buyer_name:'UI Test Customer',scheduled_at:`${date}T10:00:00Z`,duration_minutes:60,buffer_minutes:15,status:'confirmed',payment_status:'paid',price_cents:10000,is_subscription_session:false}]
}
const css = readdirSync('.next/static/css').filter(v=>v.endsWith('.css')).map(v=>readFileSync(`.next/static/css/${v}`,'utf8')).join('\n')
async function page(path,view) {
  const mocks = {
    'next/navigation':{usePathname:()=>path,useRouter:()=>({push(){},refresh(){}}),redirect:()=>{throw new Error('Unexpected fixture redirect')}},
    '@/lib/supabase/server':{createClient:async()=>client(path.includes('buyer')?'buyer':'creator'),createServiceClient:async()=>client('buyer')},
    '@/lib/supabase/client':{createClient:()=>({auth:{signOut:async()=>{}}})},
    '@/lib/subscription-price':{subscriptionPriceLabels:async()=>({})},
    '@/lib/coach-earnings-server':{loadCoachEarnings:async()=>earnings},
  }
  let element
  if(path==='/buyer') element=await loadUiComponent('src/app/buyer/page.tsx',mocks).default()
  else if(path==='/creator') element=await loadUiComponent('src/app/creator/page.tsx',mocks).default()
  else if(path==='/calendar') {
    let index=0
    const hooks={...React,useEffect(){},useSyncExternalStore:()=>view==='week',useState(initial){const position=index++;return [position===1?date:position===3?{key:`${date}:${view}:0`,data:calendarData}:typeof initial==='function'?initial():initial,()=>{}]}}
    element=h(loadUiComponent('src/app/creator/calendar/CoachCalendar.tsx',{...mocks,react:hooks}).default)
  } else {
    const { Button,ButtonLink,IconButton }=loadUiComponent('src/components/ui/Button.tsx')
    const { Input,Select,Textarea,Checkbox,Radio }=loadUiComponent('src/components/ui/Input.tsx')
    const { Card,CardContent }=loadUiComponent('src/components/ui/Card.tsx')
    const { StatePanel }=loadUiComponent('src/components/ui/StatePanel.tsx')
    const { Badge }=loadUiComponent('src/components/ui/Badge.tsx')
    element=h('div',{className:'ardore-container py-8 space-y-6'},h('h1',{className:'section-title'},'Design-Grundlage'),
      h(Card,null,h(CardContent,{className:'flex flex-wrap gap-3'},h(Button,null,'Primär'),h(Button,{variant:'outline'},'Sekundär'),h(Button,{variant:'ghost'},'Textaktion'),h(Button,{variant:'danger'},'Destruktiv'),h(Button,{loading:true},'Speichern …'),h(ButtonLink,{href:'/buyer'},'Kundenbereich'),h(IconButton,{label:'Beispielaktion'},'+'))),
      h(Card,null,h(CardContent,{className:'grid gap-4 md:grid-cols-2'},h(Input,{label:'Name',hint:'Zugeordneter Hilfetext'}),h(Input,{label:'E-Mail',type:'email',error:'Bitte prüfe deine E-Mail-Adresse'}),h(Select,{label:'Format',options:[{value:'pdf',label:'PDF'}]}),h(Textarea,{label:'Nachricht'}),h(Checkbox,{label:'Option auswählen'}),h(Radio,{label:'Online',name:'format'}))),
      h('div',{className:'flex flex-wrap gap-3'},...['default','success','warning','danger','info','outline'].map(variant=>h(Badge,{key:variant,variant},variant))),
      h(StatePanel,{kind:'error',title:'Daten nicht erreichbar',description:'Bitte versuche es erneut.',action:h(Button,{variant:'outline'},'Erneut versuchen')}))
  }
  const Navbar=loadUiComponent('src/components/layout/Navbar.tsx',mocks).Navbar
  if(path==='/creator'||path==='/calendar') {
    const Shell=loadUiComponent('src/components/creator/CreatorShell.tsx',mocks).default
    element=h(Shell,{creatorSlug:coach.slug},element)
  }
  return '<!doctype html>'+renderToStaticMarkup(h('html',{lang:'de'},h('head',null,h('meta',{name:'viewport',content:'width=device-width,initial-scale=1'}),h('link',{rel:'stylesheet',href:'/style.css'}),h('style',null,':root{--font-geist-sans:Geist;}')),h('body',null,
    h('p',{className:'bg-amber-50 p-3 text-sm text-amber-900'},'Isolierte UI-Prüfung · synthetische Daten · keine Produktionszugriffe'),
    h(Navbar,{user:{...profile,role:path==='/buyer'?'buyer':'creator'},creatorSlug:coach.slug}),
    h('nav',{className:'ardore-container flex flex-wrap gap-4 py-3 text-sm'},...[['/','Komponenten'],['/buyer','Kundendashboard'],['/creator','Coachdashboard'],['/calendar?view=day','Kalender · Tag'],['/calendar?view=week','Kalender · Woche']].map(([href,label])=>h('a',{href,key:href,className:'underline'},label))),element)))
}
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:3012')
    if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return}
    if(url.pathname.startsWith('/_next/static/')){res.writeHead(302,{Location:`http://127.0.0.1:3010${url.pathname}`});res.end();return}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await page(url.pathname,url.searchParams.get('view')==='week'?'week':'day'))
  } catch(error){res.statusCode=500;res.end('Fixture error');console.error(error.message)}
}).listen(3012,'127.0.0.1',()=>console.log('Read-only UI fixtures: http://127.0.0.1:3012'))
