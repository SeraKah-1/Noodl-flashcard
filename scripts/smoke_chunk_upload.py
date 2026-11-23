#!/usr/bin/env python3
"""Verify real UI file-selector uploads chunked bytes over mocked ChatGPT MCP transport."""
import asyncio, base64, hashlib
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards,backPagesFor,nextBackPage} from '/shared/logic.js';",'').replace("import {mediaRequirementOf,frontImageIds,knownFrontMediaReady} from '/shared/mediaPolicy.js';",'')
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')+'\n'+(ROOT/'shared/mediaPolicy.js').read_text().replace('export ','')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content(HTML);await page.add_style_tag(content=CSS)
  file=Path('/mnt/data/serologi-tifoid-visual-candidates/images/slide-06.png') if Path('/mnt/data/serologi-tifoid-visual-candidates/images/slide-06.png').exists() else ROOT/'tests/fixtures/axon-sample.png'
  hashed=list(hashlib.sha256(file.read_bytes()).digest())
  await page.add_script_tag(content='Object.defineProperty(window.crypto,"subtle",{configurable:true,value:{digest:async()=>new Uint8Array('+str(hashed)+').buffer}});')
  await page.add_script_tag(content='''window._calls=[];window._uploaded='';window._expected=0;
  window.openai={callTool:async(name,args)=>{
   window._calls.push(name);
   if(name==='app_begin_media_review')return {structuredContent:{challenge:'test-one-time-token'}};
   if(name==='app_begin_media_upload'){window._expected=args.byteLength;return {structuredContent:{uploadId:'mock-uuid',chunkBytes:98304,expectedBytes:args.byteLength}};}
   if(name==='app_upload_media_chunk'){window._uploaded+=atob(args.base64);return {structuredContent:{uploadId:'mock-uuid',receivedBytes:window._uploaded.length}};}
   if(name==='app_get_media_chunk'){
    const size=98304,offset=args.index*size,chunk=window._uploaded.slice(offset,offset+size);
    const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(window._uploaded,c=>c.charCodeAt(0)));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    return {structuredContent:{mediaId:args.mediaId,index:args.index,chunkCount:Math.ceil(window._uploaded.length/size),chunkBytes:size,bytes:window._uploaded.length,mime:'image/png',sha256:hash,base64:btoa(chunk)}};
   }
   if(name==='app_finish_media_upload'){
    if(window._uploaded.length!==window._expected)throw Error('received size wrong');
    const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(window._uploaded,c=>c.charCodeAt(0)));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    return {structuredContent:{id:'00000000-0000-4000-8000-000000000099',status:'approved',width:300,height:200,bytes:window._uploaded.length,mime:'image/png',sha256:hash,provenance:{kind:'manual',origin:'slide-06.png'},visualReview:{observation:'source + visual pairing required per card',legible:false,relevant:false}}};
   }
   throw Error('unexpected tool '+name);
  }};''')
  init="state.initialized=true;state.backend='embedded';state.media=[];state.decks=[demoDeck()];state.visualBindings=[];renderStatus();navigate('settings');window.__testState=state;"
  await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',init))
  await page.locator('#mediaFile').set_input_files(str(file))
  await page.locator('#uploadMedia').click()
  await page.wait_for_function('window._calls.includes("app_finish_media_upload")')
  await page.wait_for_function('window.__testState.media[0]?.dataUrl?.startsWith("data:image/png;base64,")')
  data=await page.evaluate('({calls:window._calls,bytes:window._uploaded.length,count:window.__testState.media.length,status:window.__testState.media[0]?.status,expected:window._expected,rehydrated:window.__testState.media[0]?.dataUrl?.length})')
  assert data['bytes']==file.stat().st_size,data
  assert data['bytes']==data['expected'],data
  assert data['count']==1 and data['status']=='approved',data
  assert data['calls'][0]=='app_begin_media_upload' and 'app_finish_media_upload' in data['calls'] and all(x in ['app_upload_media_chunk','app_get_media_chunk'] for x in data['calls'][1:] if x!='app_finish_media_upload'),data
  assert len(data['calls'])>=3 and data['rehydrated']>data['bytes'],data
  assert await page.evaluate('atob(window.__testState.media[0].dataUrl.split(",")[1])===window._uploaded'), 'Reconstructed bytes differ' 
  await page.locator('[data-preview]').click()
  await page.locator('#fullPreview').wait_for()
  assert await page.locator('#fullPreview').evaluate('(img)=>img.complete&&img.naturalWidth>30'), 'Preview must decode actual slide'
  assert await page.locator('#approveForm').count()==0, 'Manual approval must not be present'
  await page.screenshot(path='/mnt/data/noodl-flashcards-v0.4-upload-preview.png',full_page=True)
  assert not errors,errors
  print('PASS real browser file picker -> base64 chunk MCP -> stored image without manual approval; no native host transfer available',data)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
