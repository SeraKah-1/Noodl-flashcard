#!/usr/bin/env python3
"""UI simulation only. Does not certify medical performance or live MCP deployment."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ', '')
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards} from '/shared/logic.js';",'')
DECK=json.loads((ROOT/'examples/OSCE_TILIK_DEMO_NOT_OFFICIAL.json').read_text())
DECK['id']='osce-demo';DECK['revision']=1
for idx,card in enumerate(DECK['cards']):card.update(id='osce-'+str(idx+1),position=idx)

async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height in [(1366,900),(390,844)]:
   page=await browser.new_page(viewport={'width':width,'height':height},is_mobile=width<500,has_touch=width<500)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content(HTML)
   await page.add_style_tag(content=CSS)
   await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
   boot=APP.replace('void initialize();',f'state.initialized=true;state.decks=[{json.dumps(DECK,ensure_ascii=False)}];renderStatus();render();')
   await page.add_script_tag(type='module',content=SHARED+'\n'+boot)
   await page.locator('[data-nav="review"]').last.click()
   await page.locator('[data-start-deck]').first.click()
   assert 'TILIK OSCE' in await page.locator('.session-sub').inner_text()
   assert (await page.locator('#timerPill').inner_text())=='Tanpa timer'
   assert await page.locator('#clueBox').count()==0
   assert 'Apa yang perlu dilakukan' in await page.locator('.flash-face.front').inner_text()
   await page.locator('[data-procedure-view="sequence"]').click()
   assert 'Apa tindakan selanjutnya?' in await page.locator('.flash-face.front').inner_text()
   assert 'Apa yang perlu dilakukan' not in await page.locator('.flash-face.front').inner_text()
   await page.screenshot(path=f'/mnt/data/noodl-flashcards-v0.6-osce-{width}-front.png',full_page=True)
   await page.locator('#playerFlip').click()
   assert await page.locator('.flash-face.front').get_attribute('aria-hidden')=='true'
   assert 'Sapa pasien' in await page.locator('.flash-face.back').inner_text()
   assert 'Sumber:' in await page.locator('.flash-face.back').inner_text()
   await page.wait_for_timeout(540)
   assert await page.locator('.flash-face.back').get_attribute('aria-hidden')=='false'
   await page.screenshot(path=f'/mnt/data/noodl-flashcards-v0.6-osce-{width}-back.png',full_page=True)
   await page.locator('[data-rating="3"]').click()
   await page.wait_for_timeout(290)
   assert '2 / 5' in await page.locator('.session-sub').inner_text()
   assert 'Apa tindakan selanjutnya?' in await page.locator('.flash-face.front').inner_text()
   await page.locator('#playerUndo').click()
   assert '1 / 5' in await page.locator('.session-sub').inner_text()
   await page.locator('[data-procedure-view="technique"]').click()
   assert 'Apa yang perlu dilakukan' in await page.locator('.flash-face.front').inner_text()
   assert await page.locator('#timerPill').inner_text()=='Tanpa timer'
   assert errors==[],errors
   print('PASS OSCE',width,'sequence, technique, no timer, no clues, answer + source, rating and Undo')
   await page.close()
  await browser.close()
if __name__=='__main__':asyncio.run(run())
