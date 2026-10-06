// In-memory reads only. Exercises actual server pages; never connects to production.
import React from 'react'
import { loadUiComponent } from './load-ui-component.mjs'
const h = React.createElement
export const coach = {
  id:'synthetic-pilot-coach', user_id:'synthetic-pilot-user', slug:'jonas-weber', display_name:'UI Test Coach',
  avatar_url:null, banner_url:null, bio:'Achtsamkeit und Bewegung für einen Alltag, der zu dir passt.',
  category:'yoga', categories:['yoga','stressbewaeltigung'], qualifications:['Qualifikation des synthetischen Coaches'],
  languages:['de'], services:['1to1_coaching'], social_links:{}, is_verified:false, is_published:true,
  stripe_account_active:false, created_at:'2026-10-05T08:00:00Z', productCount:1, hasVideoCoaching:true,
  hasSubscription:true, hasGroupClasses:false, coachingPrice:{price_cents:6900,duration_minutes:60}, rating:null,
}
export const product = {id:'synthetic-pilot-product', title:'Ein klarer Plan für mehr Ruhe und Bewegung im Alltag', description:'Synthetischer Inhalt',type:'pdf',price:39,thumbnail_url:null,is_published:true,creator_id:coach.id,created_at:coach.created_at, level:'anfaenger',duration:'30_60',creator:coach}
export const tier={id:'synthetic-pilot-tier',name:'Begleitung im Alltag',description:'Synthetische monatliche Begleitung',price_monthly:49,features:[],included_video_sessions:0}
const totals={gross:10000,retained:10000,fee:1000,net:9000,transferred:4500,pending:4500,refunded:0,reversalPending:0,refundPending:0,reversed:0,payments:1}
export const report={all:totals,month:totals,testMode:true,legacy:{products:0,bookings:0,subscriptions:0,unclear:0,knownProductGross:0,knownBookingGross:0},days:[],sources:[]}
export function pilotFixture({workspace=false,profile=coach,bookings=[],errors={},signedIn=workspace,meetingIds=[],products=[product],tiers=[tier],offer=null,earnings=report}={}) {
  const reads=[]
  const user=signedIn?{id:profile.user_id,email:'ui@example.invalid'}:null
  const client={auth:{getUser:async()=>({data:{user}})},from(table){
    const filters=[]
    const data=table==='creator_profiles'?profile:table==='products'?products:table==='subscription_tiers'?tiers:table==='coaching_offers'?offer:table==='profiles'?{full_name:'UI Test',avatar_url:null}:table==='bookings'?bookings:table==='booking_meeting_links'?meetingIds.map(booking_id=>({booking_id})):[]
    const result=()=>{reads.push({table,filters});return {data,error:errors[table]??null,count:0}}
    return {select(value){filters.push(['select',value]);return this},eq(k,v){filters.push(['eq',k,v]);return this},is(k,v){filters.push(['is',k,v]);return this},in(k,v){filters.push(['in',k,v]);return this},neq(){return this},lt(){return this},gte(){return this},order(){return this},limit(){return this},single:async()=>result(),maybeSingle:async()=>result(),then(resolve){resolve(result())}}
  },rpc:async(name)=>{reads.push({rpc:name});return{data:[],error:null}}}
  const overrides={
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/coach-earnings-server':{loadCoachEarnings:async()=>earnings},
    'next/navigation':{redirect(path){throw new Error(`Redirect:${path}`)},notFound(){throw new Error('NotFound')},usePathname:()=>'/creator',useRouter:()=>({push(){},refresh(){}}),useSearchParams:()=>new URLSearchParams()},
    '@/components/HeartButton':{__esModule:true,default:props=>h('button',{className:`icon-button rounded-full bg-white border border-border ${props.className??''}`,'aria-label':'Favorit'},'♡')},
    '@/components/creator/RevenueChart':{RevenueChart:()=>h('p',null,'Diagramm · isolierte SSR-Prüfung')},
    './BuyButton':{__esModule:true,default:props=>h('button',{className:'button-base button-primary','data-product':props.productId},'In den Warenkorb')},
    './SubscribeButton':{__esModule:true,default:props=>h('button',{className:'button-base button-primary','data-tier':props.tierId},'Abonnieren')},
    './ReviewSection':{__esModule:true,default:()=>null},
  }
  return {reads,overrides,async element(){const Page=loadUiComponent(workspace?'src/app/creator/page.tsx':'src/app/creators/[slug]/page.tsx',overrides).default;return workspace?await Page():await Page({params:Promise.resolve({slug:profile.slug})})}}
}
