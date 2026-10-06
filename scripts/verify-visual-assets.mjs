import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const h=React.createElement
const assets=loadUiComponent('src/lib/visual-assets.ts')
test('asset guidance checks effective centered crop resolution, not only source dimensions',()=>{
 assert.equal(assets.assetDimensionAdvice('portrait',1200,1500),null)
 assert.equal(assets.assetDimensionAdvice('cover',1600,900),null)
 assert.equal(assets.assetDimensionAdvice('banner',2400,600),null)
 assert.match(assets.assetDimensionAdvice('portrait',1600,900),/scharfen 4:5/)
 assert.match(assets.assetDimensionAdvice('cover',1600,4000),/mittig beschnitten/)
 assert.match(assets.assetDimensionAdvice('portrait',800,4000),/mittig beschnitten/)
 assert.equal(assets.assetDimensionAdvice('cover',NaN,0),null)
})
function guideFixture(){
 let index=0;const state=[]
 const hooks={...React,useState(initial){const i=index++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=value}]}}
 const Guide=loadUiComponent('src/components/ui/ImageAssetGuide.tsx',{react:hooks}).ImageAssetGuide
 return{element(props){index=0;return Guide(props)}}
}
function images(node,out=[]){if(!node||typeof node!=='object')return out;if(node.type==='img')out.push(node);React.Children.forEach(node.props?.children,c=>images(c,out));return out}
test('upload preview has both portrait and circular crops; failed/new sources do not inherit stale dimensions',()=>{
 const f=guideFixture();let element=f.element({kind:'portrait',src:'blob:first'});const image=images(element)[0]
 assert.equal(images(element).length,2)
 image.props.onLoad({currentTarget:{naturalWidth:400,naturalHeight:500}})
 assert.match(render(f.element({kind:'portrait',src:'blob:first'})),/kann weiterhin gespeichert/)
 image.props.onError()
 assert.match(render(f.element({kind:'portrait',src:'blob:first'})),/Vorschau konnte nicht geladen/)
 const changed=render(f.element({kind:'portrait',src:'blob:second'}));assert.ok(changed.includes('blob:second'));assert.ok(!changed.includes('kann weiterhin gespeichert'));assert.ok(!changed.includes('konnte nicht geladen'))
 const missing=render(f.element({kind:'portrait',src:null}));assert.ok(!missing.includes('<img'));assert.ok(missing.includes('1200 × 1500'))
})
test('media preserves geometry, real image source and alt text; missing images do not create a person or photo',()=>{
 const {CoachPortrait,ProductThumbnail}=loadUiComponent('src/components/ui/Media.tsx')
 for(const [Component,ratio] of [[CoachPortrait,'aspect-[4/5]'],[ProductThumbnail,'aspect-video']]){
  const valid=render(h(Component,{src:'/local-calibration.png',alt:'Lokales Kalibrierbild'}));assert.ok(valid.includes(ratio));assert.ok(valid.includes('object-cover object-center'));assert.ok(valid.includes('Lokales Kalibrierbild'))
  const missing=render(h(Component,{src:null,alt:'Kein Bild'}));assert.ok(missing.includes(ratio));assert.ok(!missing.includes('<img'))
 }
})
