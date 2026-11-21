#!/usr/bin/env python3
"""Browser smoke for card-specific visual approval in a simulated MCP host.
This is NOT an actual live ChatGPT/Sites identity or R2 test.
"""
import asyncio, base64
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews} from '/shared/logic.js';",'')
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')
fixture='data:image/png;base64,'+base64.b64encode((ROOT/'tests/fixtures/axon-sample.png').read_bytes()).decode()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content(HTML);await page.add_style_tag(content=CSS)
  await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
  await page.add_script_tag(content=f'''window._calls=[];window._bindingStatus='awaiting_user_approval';window._fixture={fixture!r};window.openai={{callTool:async(name,args)=>{{window._calls.push(name);let data={{}};if(name==='get_card_visual_audit')data={{status:window._bindingStatus,checks:[{{phase:'source',report:{{sourceIntegrity:'unverified_host_context',evidenceNote:'The source page has labeled axon structures.'}}}},{{phase:'visual',report:{{supportedClaim:'The labeled diagram shows a myelinated axon.',countercheck:'No arrows are cropped.'}}}}]}};if(name==='app_begin_visual_approval')data={{challenge:'test-challenge'}};if(name==='app_approve_card_visual'){{if(args.challenge!=='test-challenge')throw Error('wrong challenge');window._bindingStatus='approved_for_card';data={{status:window._bindingStatus}};}}if(name==='app_snapshot')data={{decks:window._decks,media:window._media,visualBindings:[{{...window._binding,status:window._bindingStatus}}]}};if(name==='attach_visual_to_card'){{window._bindingStatus='attached';window._decks[0].cards[0].back.push({{type:'image',assetId:'img1',alt:'axon diagram'}});window._decks[0].revision++;data={{attached:true}};}}return {{structuredContent:data}};}}}};''')
  init="""state.initialized=true;state.backend='embedded';state.decks=[demoDeck()];state.media=[{id:'img1',status:'approved',dataUrl:window._fixture,provenance:{origin:'neuro.pdf',sourcePage:6,description:'Axon diagram'},mime:'image/png',width:300,height:200}];state.visualBindings=[{bindingId:'v1',cardId:'demo-1',deckId:'demo-noodl',mediaId:'img1',status:'awaiting_user_approval',side:'back',provenance:{origin:'neuro.pdf',sourcePage:6}}];window._binding=state.visualBindings[0];window._media=state.media;window._decks=state.decks;renderStatus();navigate('settings');"""
  await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',init))
  await page.locator('[data-review-binding]').click()
  await page.locator('#bindingPreview').wait_for()
  assert await page.locator('text=Cek A — Sumber').count()>=1
  assert await page.locator('text=Cek B — Gambar final').count()>=1
  await page.screenshot(path='/mnt/data/noodl_visual_approval_v03.png',full_page=True)
  for name in ['sourceMatches','labelsLegible','contentRelevant']:
   await page.locator('input[name="'+name+'"]').check()
  await page.locator('textarea[name="note"]').fill('This exact image visibly supports the axon and myelin sheath relationship in the answer.')
  await page.locator('#approveBindingForm button[type="submit"]').click()
  await page.wait_for_timeout(200)
  calls=await page.evaluate('window._calls')
  assert all(x in calls for x in ['get_card_visual_audit','app_begin_visual_approval','app_approve_card_visual','attach_visual_to_card']),calls
  assert await page.evaluate('window._bindingStatus')=='attached'
  assert not errors,errors
  print('PASS UI: exact image preview, A/B report display, user checkboxes, approval challenge and persisted attach callback (mocked MCP host)')
  await browser.close()
if __name__=='__main__':asyncio.run(main())
