#!/usr/bin/env python3
"""Browser smoke for card-specific visual audit without user approval in a simulated MCP host.
This is NOT an actual live ChatGPT/Sites identity or R2 test.
"""
import asyncio, base64
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards,backPagesFor,nextBackPage} from '/shared/logic.js';",'').replace("import {mediaRequirementOf,frontImageIds,knownFrontMediaReady} from '/shared/mediaPolicy.js';",'')
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')+'\n'+(ROOT/'shared/mediaPolicy.js').read_text().replace('export ','')
fixture='data:image/png;base64,'+base64.b64encode((ROOT/'tests/fixtures/axon-sample.png').read_bytes()).decode()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content(HTML);await page.add_style_tag(content=CSS)
  await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
  await page.add_script_tag(content=f'''window._calls=[];window._bindingStatus='approved_for_card';window._fixture={fixture!r};window.openai={{callTool:async(name,args)=>{{window._calls.push(name);let data={{}};if(name==='get_card_visual_audit')data={{status:window._bindingStatus,checks:[{{phase:'source',report:{{sourceIntegrity:'unverified_host_context',evidenceNote:'The source page has labeled axon structures.'}}}},{{phase:'visual',report:{{supportedClaim:'The labeled diagram shows a myelinated axon.',countercheck:'No arrows are cropped.'}}}}]}};if(name==='app_snapshot')data={{decks:window._decks,media:window._media,visualBindings:[{{...window._binding,status:window._bindingStatus}}]}};if(name==='attach_visual_to_card'){{window._bindingStatus='attached';window._decks[0].cards[0].back.push({{type:'image',assetId:'img1',alt:'axon diagram'}});window._decks[0].revision++;data={{attached:true}};}}return {{structuredContent:data}};}}}};''')
  init="""state.initialized=true;state.backend='embedded';state.decks=[demoDeck()];state.media=[{id:'img1',status:'approved',dataUrl:window._fixture,provenance:{origin:'neuro.pdf',sourcePage:6,description:'Axon diagram'},mime:'image/png',width:300,height:200}];state.visualBindings=[{bindingId:'v1',cardId:'demo-1',deckId:'demo-noodl',mediaId:'img1',status:'approved_for_card',side:'back',provenance:{origin:'neuro.pdf',sourcePage:6}}];window._binding=state.visualBindings[0];window._media=state.media;window._decks=state.decks;renderStatus();navigate('settings');"""
  await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',init))
  await page.locator('[data-attach-binding]').wait_for()
  await page.locator('[data-attach-binding]').click()
  await page.wait_for_timeout(250)
  calls=await page.evaluate('window._calls')
  assert 'attach_visual_to_card' in calls,calls
  assert await page.evaluate('window._bindingStatus')=='attached'
  assert await page.locator('input[name="sourceMatches"]').count()==0
  await page.screenshot(path='/mnt/data/noodl-v0.9-media-audit.png',full_page=True)
  assert not errors,errors
  print('PASS UI: double-check attachment without user approval form (mocked MCP host)')
  await browser.close()
if __name__=='__main__':asyncio.run(main())
