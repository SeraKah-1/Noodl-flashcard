#!/usr/bin/env python3
"""Browser regression for Deep Cards, read panel and natural pointer/touch gestures.
Fixture uses local demo with verified-media mock, not live cloud MCP.
"""
import asyncio,base64
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')+'\n'+(ROOT/'shared/mediaPolicy.js').read_text().replace('export ','')
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards,backPagesFor,nextBackPage} from '/shared/logic.js';",'').replace("import {mediaRequirementOf,frontImageIds,knownFrontMediaReady} from '/shared/mediaPolicy.js';",'')
PNG='data:image/png;base64,'+base64.b64encode((ROOT/'tests/fixtures/axon-sample.png').read_bytes()).decode()
async def launch(browser,w,h):
 ctx=await browser.new_context(viewport={'width':w,'height':h},is_mobile=w<=520,has_touch=w<=520)
 page=await ctx.new_page();errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 await page.set_content(HTML);await page.add_style_tag(content=CSS)
 await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
 boot=f"""state.initialized=true;state.decks=[demoDeck()];state.media=[{{id:'approved-demo',status:'approved',dataUrl:'{PNG}',provenance:{{origin:'neuro-slide-6.png'}}}}];state.decks[0].cards[0].backPages[0].blocks[0].text+=String.fromCharCode(10)+'Detail panjang tetapi tetap harus dapat digulir dari baris awal sampai akhir. '+String.fromCharCode(10)+'Ringkasan per baris. '.repeat(250)+'AKHIR HALAMAN PROSEDUR';state.decks[0].cards[0].backPages[3].blocks.push({{type:'image',assetId:'approved-demo',alt:'Label gambar tervalidasi dalam fixture'}});renderStatus();render();"""
 await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',boot))
 await page.locator('.dock [data-nav="review"]').click();await page.locator('[data-start-deck]').first.click()
 return ctx,page,errs
async def touch_drag(client,x,y,dx,dy=0,steps=14):
 await client.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
 for i in range(1,steps+1):
  await client.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/steps,'y':y+dy*i/steps,'id':1}]})
  await asyncio.sleep(.008)
 await client.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 await asyncio.sleep(.3)
async def mouse_swipe(page,selector,dx,dy=0):
 await page.locator(selector).scroll_into_view_if_needed()
 box=await page.locator(selector).bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,steps=16);await page.mouse.up();await page.wait_for_timeout(250)
async def test(browser,w,h):
 ctx,page,errs=await launch(browser,w,h)
 await page.locator('#playerFlip').click()
 assert await page.locator('#deepNav').is_visible(), 'Deep nav hidden after flip'
 assert '1 / 5' in await page.locator('#deepPageCounter').inner_text()
 assert await page.locator('#deepPrev').is_disabled()
 assert await page.locator('[data-rating]').count()==4
 before=await page.locator('.session-sub').inner_text()
 if w<=520:
  cdp=await ctx.new_cdp_session(page)
  b=await page.locator('#deepPageBody .block-text').first.bounding_box()
  await touch_drag(cdp,b['x']+b['width']/2,b['y']+b['height']/2,-125)
 else:await mouse_swipe(page,'#deepPageBody .block-text',-130)
 assert '2 / 5' in await page.locator('#deepPageCounter').inner_text(), 'Swipe left must navigate next back page'
 assert await page.locator('.session-sub').inner_text()==before, 'Back swipe must not rate/advance card'
 assert 'Lapisan mielin' in await page.locator('#deepPageBody').inner_text()
 scroll=page.locator('.flash-face.back .face-content')
 dims=await scroll.evaluate('e=>({scroll:e.scrollHeight,client:e.clientHeight,position:e.scrollTop})')
 assert dims['scroll']>dims['client'],('Deep page text must scroll',dims)
 if w<=520:
  b=await scroll.bounding_box();await touch_drag(cdp,b['x']+b['width']/2,b['y']+b['height']/2,2,-125)
 else:
  b=await scroll.bounding_box();await page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2);await page.mouse.wheel(0,440);await page.wait_for_timeout(150)
 assert (await scroll.evaluate('e=>e.scrollTop'))>0, 'Vertical gesture must scroll deep page instead of switching or rating'
 assert '2 / 5' in await page.locator('#deepPageCounter').inner_text()
 if w<=520:
  b=await scroll.bounding_box()
  await touch_drag(cdp,b['x']+b['width']/2,b['y']+b['height']/2,125)
 else:await mouse_swipe(page,'.flash-face.back .face-content',130)
 assert '1 / 5' in await page.locator('#deepPageCounter').inner_text(), 'Swipe right must navigate previous page'
 await page.locator('#deepNext').click();await page.locator('#deepNext').click()
 assert await page.locator('#deepPageTitle').inner_text()=='Keadaan normal'
 await page.locator('#playerRead').click()
 assert 'Keadaan normal' in await page.locator('#readerTitle').inner_text()
 await page.locator('#readerNext').click()
 assert 'Jika mielin rusak' in await page.locator('#readerTitle').inner_text()
 await page.locator('#readerNext').click()
 assert 'Visual terverifikasi' in await page.locator('#readerTitle').inner_text()
 assert await page.locator('#readerContent img[data-zoom]').count()==1
 await page.locator('#readerDone').click()
 assert '5 / 5' in await page.locator('#deepPageCounter').inner_text()
 if w in (1366,390):
  await page.screenshot(path=f'/mnt/data/noodl-v0.8-deep-{w}.png',full_page=True)
 # This must rate only once despite many page navigations.
 await page.locator('[data-rating="2"]').click();await page.wait_for_timeout(260)
 assert '2 / 5' in await page.locator('.session-sub').inner_text(), 'Rating button must advance only one card'
 # Legacy side-back swipe must continue rating (second card has no backPages).
 await page.locator('#playerFlip').click();await mouse_swipe(page,'.flash-face.back .block-text',-135)
 assert '3 / 5' in await page.locator('.session-sub').inner_text(), 'Legacy card rating broken'
 assert not errs,errs
 print('PASS',w,h,'backpages left/right, no false review, reader navigation, image, legacy rating')
 await ctx.close()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  try:
   for w,h in [(1366,900),(390,844),(320,568)]:await test(browser,w,h)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
