// Read-only local visual harness for the four actual pilot surfaces. No auth/data/payment mutations.
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
import { pilotFixture, coach, product } from './fixtures/visual-identity-pilot.mjs'
const h=React.createElement
const css=readdirSync('.next/static/css').filter(f=>f.endsWith('.css')).map(f=>readFileSync(`.next/static/css/${f}`,'utf8')).join('\n')
const now=Date.now()
const bookings=[{id:'ui-booking-one',buyer_name:'UI Test Customer',scheduled_at:new Date(now+3600000).toISOString(),duration_minutes:60,status:'confirmed',payment_status:'paid',price_cents:6900,is_subscription_session:false},{id:'ui-booking-two',buyer_name:'UI Test Customer 2',scheduled_at:new Date(now+86400000).toISOString(),duration_minutes:45,status:'pending_payment',payment_status:'pending',price_cents:4900,is_subscription_session:false}]
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:3012')
  if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return}
  if(url.pathname.startsWith('/_next/static/')){res.writeHead(302,{Location:`http://127.0.0.1:3011${url.pathname}`});res.end();return}
  const workspace=url.pathname==='/workspace'
  const fixture=pilotFixture({workspace,bookings:url.searchParams.has('empty')?[]:bookings,errors:url.searchParams.has('error')?{bookings:{message:'synthetic'}}:{}})
  let element
  if(url.pathname==='/cards'){
   const ProductCard=loadUiComponent('src/components/ui/ProductCard.tsx',fixture.overrides).ProductCard
   const CoachCard=loadUiComponent('src/components/ui/CoachCard.tsx',fixture.overrides).CoachCard
   element=h('main',{className:'ardore-container py-8'},h('h1',{className:'section-title mb-6'},'Person & Werk · Kartenpilot'),h('div',{className:'grid gap-5 sm:grid-cols-2 xl:grid-cols-4'},h(CoachCard,{coach}),h(CoachCard,{coach:{...coach,id:'no-service',coachingPrice:null,hasVideoCoaching:false}}),h(ProductCard,{product}),h(ProductCard,{product:{...product,id:'free',price:0,title:'Ein außergewöhnlich langer Produktname für einen strukturierten und entspannten Trainingsalltag mit vielen zusätzlichen Informationen'}})))
  } else element=await fixture.element()
  const mocks={...fixture.overrides,'@/lib/supabase/client':{createClient:()=>({auth:{signOut:async()=>{}}})}}
  const Navbar=loadUiComponent('src/components/layout/Navbar.tsx',mocks).Navbar
  if(workspace){const Shell=loadUiComponent('src/components/creator/CreatorShell.tsx',mocks).default;element=h(Shell,{creatorSlug:coach.slug},element)}
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.end('<!doctype html>'+render(h('html',{lang:'de'},h('head',null,h('meta',{name:'viewport',content:'width=device-width,initial-scale=1'}),h('link',{rel:'stylesheet',href:'/style.css'}),h('style',null,':root{--font-geist-sans:Geist;}')),h('body',null,h('p',{className:'bg-amber-50 p-3 text-sm text-amber-900'},'Isolierte UI-Prüfung · synthetische Inhalte · keine Produktionszugriffe'),h(Navbar,{user:workspace?{id:coach.user_id,full_name:coach.display_name,email:'ui@example.invalid',role:'creator'}:null,creatorSlug:workspace?coach.slug:undefined}),h('nav',{className:'ardore-container flex flex-wrap gap-4 py-3 text-sm'},...['cards','storefront','workspace'].map(p=>h('a',{key:p,href:`/${p}`,className:'underline'},p))),element))))
 }catch(e){res.statusCode=500;res.end('Lokale Vorschau fehlgeschlagen');console.error(e.message)}
}).listen(3012,'127.0.0.1',()=>console.log('Read-only pilot preview: http://127.0.0.1:3012'))
