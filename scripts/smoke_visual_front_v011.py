#!/usr/bin/env python3
"""Local browser regression only: no authenticated production MCP or R2 claims.
Checks text-only compatibility, optional images, required-image blocking, and modal zoom/pan.
"""
import asyncio,base64
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')+'\n'+(ROOT/'shared/mediaPolicy.js').read_text().replace('export ','')
APP=(ROOT/'public/app.js').read_text()
APP=APP.replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards,backPagesFor,nextBackPage} from '/shared/logic.js';",'').replace("import {mediaRequirementOf,frontImageIds,knownFrontMediaReady} from '/shared/mediaPolicy.js';",'')
PNG='data:image/png;base64,'+base64.b64encode((ROOT/'tests/fixtures/axon-sample.png').read_bytes()).decode()

def javascript_cards():
 return """const raw=demoDeck().cards[1];
 const plain={...raw,id:'test-text',front:[{type:'text',text:'Pertanyaan teks saja: Apa fungsi insulin?'}],back:[{type:'text',text:'Menurunkan kadar glukosa darah.'}]};
 const picture={...raw,id:'test-image',mediaRequirement:'required_for_question',front:[{type:'text',text:'Identifikasi struktur ini dari gambar.'},{type:'image',assetId:'good-image',alt:'Gambar neuron dari atlas'}],back:[{type:'text',text:'Struktur mielin pada akson.'}]};
 const broken={...raw,id:'test-broken',mediaRequirement:'required_for_question',front:[{type:'text',text:'Apa kelainan pada gambar rusak ini?'},{type:'image',assetId:'bad-image',alt:'Media tak dapat dimuat'}],back:[{type:'text',text:'Jawaban seharusnya tidak dapat dinilai.'}]};
 const optional={...raw,id:'test-optional',mediaRequirement:'optional',front:[{type:'text',text:'Kartu tanpa gambar tetap boleh jalan meskipun diberi status opsional.'}],back:[{type:'text',text:'Valid tanpa gambar.'}]};
 const missing={...raw,id:'test-missing',mediaRequirement:'required_for_question',front:[{type:'text',text:'Gambar wajib, tetapi tidak disediakan.'}],back:[{type:'text',text:'Tidak boleh direview.'}]};
 state.initialized=true;state.decks=[{id:'visual-deck',title:'DEMO Visual Optional v0.11',description:'Browser-only sample',revision:1,cards:[plain,picture,broken,optional,missing]}];
 state.media=[{id:'good-image',status:'approved',dataUrl:window._fixture,provenance:{kind:'slide',origin:'neuro.pdf',sourcePage:1},mime:'image/png',width:300,height:200},{id:'bad-image',status:'approved',dataUrl:'data:image/png;base64,BADIMAGE',provenance:{kind:'manual',origin:'failed.png'},mime:'image/png'}];state.reviews=[];renderStatus();render();"""

async def run_case(browser,w,h):
 ctx=await browser.new_context(viewport={'width':w,'height':h},is_mobile=w<=520,has_touch=w<=520)
 page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 await page.set_content(HTML);await page.add_style_tag(content=CSS)
 await page.add_script_tag(content="let _uid=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_uid).padStart(12,'0')}`});")
 await page.add_script_tag(content='window._fixture='+repr(PNG)+';')
 await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',javascript_cards()))
 await page.locator('.dock [data-nav="review"]').click();await page.locator('[data-start-deck]').first.click()
 assert '1 / 4' in await page.locator('.session-sub').inner_text(), 'Missing required front image must be filtered (5→4)'
 assert await page.locator('#questionVisualGate').count()==0, 'Text-only card must not render visual gate'
 await page.locator('#playerFlip').click();await page.locator('[data-rating="2"]').click()
 assert '2 / 4' in await page.locator('.session-sub').inner_text(), 'Text-only review broken'
 await page.locator('.flash-face.front img[data-required-question-image]').wait_for()
 await page.wait_for_function("document.querySelector('.flash-face.front img[data-required-question-image]')?.naturalWidth > 0")
 assert '✓ ' in await page.locator('#questionVisualGate').inner_text(), 'Loaded visual should enable review'
 if w in (1366,390):
  await page.locator('#toast').evaluate("el=>el.classList.remove('show')")
  await page.wait_for_timeout(350)
  await page.screenshot(path=f'/mnt/data/noodl-v0.11-front-{w}.png',full_page=True)
 await page.locator('.flash-face.front img[data-zoom]').click()
 assert await page.locator('#visualViewer').is_visible()
 await page.locator('#zoomIn').click();await page.locator('#zoomIn').click()
 assert int((await page.locator('#zoomLevel').inner_text()).replace('%',''))>100, 'Zoom controls must change scale'
 if w in (1366,390):
  await page.locator('#toast').evaluate("el=>el.classList.remove('show')")
  await page.wait_for_timeout(350)
  await page.screenshot(path=f'/mnt/data/noodl-v0.11-zoom-{w}.png',full_page=True)
 box=await page.locator('#imageZoomViewport').bounding_box()
 x,y=box['x']+box['width']/2,box['y']+box['height']/2
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y+25,steps=8);await page.mouse.up()
 transform=await page.locator('#fullPreview').evaluate('el=>el.style.transform')
 assert 'translate3d(' in transform and 'scale(' in transform, transform
 await page.locator('#zoomReset').click();assert await page.locator('#zoomLevel').inner_text()=='100%'
 await page.locator('#closePreview').click()
 await page.locator('#playerFlip').click();await page.locator('[data-rating="2"]').click()
 assert '3 / 4' in await page.locator('.session-sub').inner_text(), 'Visual rating not saved after valid image'
 await page.wait_for_timeout(200)
 assert '⚠ ' in await page.locator('#questionVisualGate').inner_text(), 'Broken front image must be blocked'
 await page.locator('#playerFlip').click()
 assert await page.locator('[data-rating="3"]').is_disabled(), 'Broken image rating must remain disabled after flip'
 assert '3 / 4' in await page.locator('.session-sub').inner_text()
 await page.locator('#playerSkip').click()
 assert '4 / 4' in await page.locator('.session-sub').inner_text()
 assert await page.locator('#questionVisualGate').count()==0, 'Optional image cannot become required for next card'
 await page.locator('#playerFlip').click();await page.locator('[data-rating="2"]').click()
 assert await page.locator('.page-title').count()==1, 'Session must complete'
 if w in (1366,390):await page.screenshot(path=f'/mnt/data/noodl-v0.11-browser-{w}.png',full_page=True)
 assert not errors,errors
 print(f'PASS {w}x{h}: text-only, optional, visual front, required missing, zoom/pan, rating guard')
 await ctx.close()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  try:
   for w,h in [(1366,900),(390,844),(320,568)]:await run_case(browser,w,h)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
