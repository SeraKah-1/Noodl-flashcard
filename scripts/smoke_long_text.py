#!/usr/bin/env python3
"""Chromium regression: long front/back remains top-accessible, scrollable, and readable.
Uses a local UI fixture, not a live ChatGPT MCP connection.
"""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ', '')
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards} from '/shared/logic.js';",'')
front='MULAI PERTANYAAN — awalan ini tidak boleh hilang.\n'+'Pertanyaan panjang. Jelaskan indikasi, langkah, faktor risiko, dan interpretasi dengan konteks yang benar.\n'*95+'\nAKHIR PERTANYAAN'
back='MULAI JAWABAN — awalan ini wajib tampil.\n'+'Penjelasan klinis: interpretasi harus berdasarkan materi sumber, tidak sekadar warna atau angka.\n'*118+'\nAKHIR JAWABAN'
detail='DETAIL PEMBAHASAN DIMULAI\n'+'Langkah, alasan, keamanan, dan batas interpretasi.\n'*140+'\nAKHIR PEMBAHASAN'
card={'id':'long-1','position':0,'front':[{'type':'text','text':front}],'back':[{'type':'text','text':back}],'explanation':{'sections':[{'heading':'Alasan dan mekanisme','blocks':[{'type':'text','text':detail}]},{'heading':'Kesalahan umum','blocks':[{'type':'text','text':'Jangan memotong teks atau memakai gambar tanpa pemeriksaan.'}]}]},'clues':[{'atSecond':5,'text':'Clue A'},{'atSecond':10,'text':'Clue B'},{'atSecond':15,'text':'Clue C'}],'timerSeconds':20,'tags':[]}
deck={'id':'long-deck','title':'Deck dengan judul panjang yang sering menutupi tampilan atas flashcard saat jumlah kartunya sangat banyak','description':'Test','revision':1,'cards':[card]+[{'id':f'next-card-{i}','position':i,'front':[{'type':'text','text':f'Kartu {i+1}'}],'back':[{'type':'text','text':f'Jawaban {i+1}'}],'clues':card['clues'],'timerSeconds':20,'tags':[]} for i in range(1,64)]}

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height in [(1366,900),(390,844),(320,568),(844,390)]:
   page=await browser.new_page(viewport={'width':width,'height':height},is_mobile=width<500,has_touch=width<500)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content(HTML);await page.add_style_tag(content=CSS)
   await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
   boot=APP.replace('void initialize();',f'state.initialized=true;state.decks=[{json.dumps(deck,ensure_ascii=False)}];renderStatus();render();')
   await page.add_script_tag(type='module',content=SHARED+'\n'+boot)
   await page.locator('[data-nav="review"]').last.click();await page.locator('[data-start-deck]').first.click()
   frontbox=page.locator('.flash-face.front .face-content')
   meta=await frontbox.evaluate('e=>({at:e.scrollTop,sh:e.scrollHeight,ch:e.clientHeight,top:e.getBoundingClientRect().top,first:e.querySelector(".block-text").getBoundingClientRect().top,justify:getComputedStyle(e).justifyContent})')
   assert meta['sh']>meta['ch'] and meta['at']==0 and meta['first']>=meta['top']-2 and meta['justify']=='flex-start', ('front not scrollable/top reachable',meta)
   box=await frontbox.bounding_box()
   await page.mouse.move(box['x']+box['width']*.5,box['y']+min(95,box['height']*.5))
   await page.mouse.wheel(0,420)
   await page.wait_for_timeout(100)
   assert await frontbox.evaluate('e=>e.scrollTop>0'), 'Physical wheel must scroll long card'
   await frontbox.evaluate('e=>e.scrollTop=e.scrollHeight')
   assert (await frontbox.evaluate('e=>e.scrollTop'))>500
   assert 'AKHIR PERTANYAAN' in await frontbox.inner_text()
   await page.locator('#playerRead').click()
   if width in (390,1366): await page.screenshot(path=f'/mnt/data/noodl-v0.7-{width}-reader-question.png',full_page=True)
   assert await page.locator('#readerOverlay').count()==1
   assert await page.locator('.reader-tab[data-reader-side="back"]').is_disabled(), 'Spoiler: answer must not reveal before flip'
   reader=page.locator('#readerContent')
   assert await reader.evaluate('e=>e.scrollHeight>e.clientHeight && e.scrollTop===0')
   box=await reader.bounding_box()
   await page.mouse.move(box['x']+box['width']*.5,box['y']+min(125,box['height']*.5))
   await page.mouse.wheel(0,500)
   await page.wait_for_timeout(120)
   assert await reader.evaluate('e=>e.scrollTop>0'), 'Physical wheel must scroll reader'
   await reader.evaluate('e=>e.scrollTop=e.scrollHeight')
   assert await reader.evaluate('e=>e.scrollTop>500')
   assert 'AKHIR PERTANYAAN' in await reader.inner_text()
   await page.locator('#readerDone').click()
   assert await page.locator('#readerOverlay').count()==0
   await page.locator('#playerFlip').click()
   await page.wait_for_timeout(510)
   backbox=page.locator('.flash-face.back .face-content')
   meta2=await backbox.evaluate('e=>({sh:e.scrollHeight,ch:e.clientHeight,st:e.scrollTop,top:e.getBoundingClientRect().top,first:e.querySelector(".block-text").getBoundingClientRect().top})')
   assert meta2['sh']>meta2['ch'] and meta2['st']==0 and meta2['first']>=meta2['top']-2,('back not top reachable',meta2)
   await backbox.evaluate('e=>e.scrollTop=e.scrollHeight')
   assert await backbox.evaluate('e=>e.scrollTop>500')
   await page.locator('#playerRead').click()
   if width in (390,1366): await page.screenshot(path=f'/mnt/data/noodl-v0.7-{width}-reader-answer.png',full_page=True)
   assert 'Alasan dan mekanisme' in await page.locator('.reader-section').first.inner_text()
   assert 'AKHIR PEMBAHASAN' in await reader.inner_text()
   await reader.evaluate('e=>e.scrollTop=e.scrollHeight')
   assert await reader.evaluate('e=>e.scrollTop>500')
   assert await page.locator('.reader-end').is_visible()
   await page.locator('.reader-tab[data-reader-side="front"]').click()
   assert await reader.evaluate('e=>e.scrollTop===0'), 'Switching tabs must reset to top'
   await page.locator('#readerClose').click()
   # Existing left/right rating path must still function after scrolling and closing reader.
   await page.locator('[data-rating="3"]').click();await page.wait_for_timeout(260)
   assert '2 / 64' in await page.locator('.session-sub').inner_text()
   assert not errors,errors
   if width in (390,1366):
    await page.screenshot(path=f'/mnt/data/noodl-v0.7-{width}-after.png',full_page=True)
   print('PASS',width,height,'top visible, full text scroll, spoiler protected, detail reader, rating works')
   await page.close()
  await browser.close()

if __name__=='__main__':asyncio.run(main())
