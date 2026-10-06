// Loopback-only crop calibration. No people, production assets, storage writes or payments.
import { createServer } from 'node:http'
import { readFileSync,readdirSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import sharp from 'sharp'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
import { pilotFixture,coach,product } from './fixtures/visual-identity-pilot.mjs'
const h=React.createElement
const css=readdirSync('.next/static/css').filter(f=>f.endsWith('.css')).map(f=>readFileSync(`.next/static/css/${f}`,'utf8')).join('\n')
const dimensions={portrait:[1200,1500],cover:[1600,900],wide:[2400,600],tall:[600,2400]}
const buffers=new Map()
async function pattern(kind){
 if(buffers.has(kind))return buffers.get(kind)
 const [w,v]=dimensions[kind],unit=Math.min(w,v)
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${v}"><rect width="100%" height="100%" fill="#eaf3ec"/><rect x="${w*.1}" y="${v*.1}" width="${w*.8}" height="${v*.8}" fill="#c9dfce"/><rect x="${w*.3}" y="${v*.3}" width="${w*.4}" height="${v*.4}" fill="#1e6847"/><path d="M ${w/2} 0 V ${v} M 0 ${v/2} H ${w}" stroke="white" stroke-width="4"/><text x="${w/2}" y="${v/2-unit*.08}" text-anchor="middle" font-family="sans-serif" font-size="${unit*.04}" fill="white">LOCAL CROP TEST</text><text x="${w/2}" y="${v/2+unit*.08}" text-anchor="middle" font-family="sans-serif" font-size="${unit*.035}" fill="white">NO PERSON / NO PRODUCT</text></svg>`
 const png=await sharp(Buffer.from(svg)).png().toBuffer();buffers.set(kind,png);return png
}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:3012')
  if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return}
  if(url.pathname.startsWith('/asset/')){const kind=url.pathname.split('/').at(-1).replace('.png','');if(!dimensions[kind]){res.statusCode=404;res.end();return}res.setHeader('Content-Type','image/png');res.end(await pattern(kind));return}
  if(url.pathname.startsWith('/_next/static/')){res.writeHead(302,{Location:`http://127.0.0.1:3011${url.pathname}`});res.end();return}
  const mode=url.searchParams.get('case')??'valid'
  const portrait=mode==='missing'?null:`/asset/${mode==='wide'||mode==='tall'?mode:'portrait'}.png`
  const cover=mode==='missing'?null:`/asset/${mode==='wide'||mode==='tall'?mode:'cover'}.png`
  const identity={...coach,avatar_url:portrait,display_name:'Ein bewusst langer synthetischer Coachname zur Layoutprüfung'}
  const work={...product,thumbnail_url:cover,title:'Ein bewusst langer Produkttitel für einen entspannten und strukturierten Alltag mit zusätzlichen Informationen',creator:identity}
  const workspace=url.pathname==='/workspace'
  const f=pilotFixture({workspace,profile:identity,products:[work]})
  const overrides={...f.overrides,'next/image':{__esModule:true,default:({fill,sizes,...props})=>h('img',{...props,sizes,style:fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:props.style})},'@/lib/supabase/client':{createClient:()=>({auth:{signOut:async()=>{}}})}}
  let element
  if(url.pathname==='/cards'){
   const CoachCard=loadUiComponent('src/components/ui/CoachCard.tsx',overrides).CoachCard
   const ProductCard=loadUiComponent('src/components/ui/ProductCard.tsx',overrides).ProductCard
   element=h('main',{className:'ardore-container py-8'},h('h1',{className:'section-title mb-5'},'Ausschnitte · lokale Kalibrierung'),h('div',{className:'grid grid-cols-1 items-start gap-5 sm:grid-cols-2'},h('div',{className:'w-full min-w-0 max-w-sm'},h(CoachCard,{coach:identity})),h('div',{className:'w-full min-w-0 max-w-sm'},h(ProductCard,{product:work}))))
  } else if(url.pathname==='/guides') {
   const Guide=loadUiComponent('src/components/ui/ImageAssetGuide.tsx',overrides).ImageAssetGuide
   element=h('main',{className:'ardore-container py-8'},h('h1',{className:'section-title mb-5'},'Upload-Hinweise & Vorschauen'),h('div',{className:'grid gap-6 md:grid-cols-2'},h('section',{className:'surface-card p-5'},h(Guide,{kind:'portrait',src:portrait})),h('section',{className:'surface-card p-5'},h(Guide,{kind:'cover',src:cover}))))
  }else{
   // Reuse actual page with the same read fixture and Next image display adapter.
   const Page=loadUiComponent(workspace?'src/app/creator/page.tsx':'src/app/creators/[slug]/page.tsx',overrides).default
   element=workspace?await Page():await Page({params:Promise.resolve({slug:identity.slug})})
  }
  if(workspace){const Shell=loadUiComponent('src/components/creator/CreatorShell.tsx',overrides).default;element=h(Shell,{creatorSlug:identity.slug},element)}
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.end('<!doctype html>'+render(h('html',{lang:'de'},h('head',null,h('meta',{name:'viewport',content:'width=device-width,initial-scale=1'}),h('link',{rel:'stylesheet',href:'/style.css'}),h('style',null,':root{--font-geist-sans:Geist;}')),h('body',null,h('p',{className:'bg-amber-50 p-3 text-sm text-amber-900'},'Lokale Asset-Prüfung · geometrische Kalibrierbilder, keine Personen · keine Produktionszugriffe'),element))))
 }catch(e){res.statusCode=500;res.end('Lokale Vorschau fehlgeschlagen');console.error(e.message)}
}).listen(3012,'127.0.0.1',()=>console.log('Local asset calibration: http://127.0.0.1:3012'))
