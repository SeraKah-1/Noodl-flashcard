#!/usr/bin/env python3
"""Whole-card gesture regression tests with actual browser pointer and touch input.

Requires playwright and installed Chromium. In-memory boot exercises production
app.js/CSS, not real network auth, database sync, or a live ChatGPT host.
"""
import asyncio
import base64
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'public/index.html').read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS=(ROOT/'public/styles.css').read_text().split('\n',1)[1]
SHARED=(ROOT/'shared/logic.js').read_text().replace('export ','')
APP=(ROOT/'public/app.js').read_text().replace("import {CardClock,dueClues,dragRating,replayReviews} from '/shared/logic.js';",'')
PNG='data:image/png;base64,'+base64.b64encode((ROOT/'tests/fixtures/axon-sample.png').read_bytes()).decode()

async def boot(page,media=False,long_text=False):
    errs=[];page.on('pageerror',lambda ex: errs.append(str(ex)))
    await page.set_content(HTML)
    await page.add_style_tag(content=CSS)
    await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
    code='state.initialized=true;state.decks=[demoDeck()];'
    if media:
        code+=f"state.media=[{{id:'verified-asset',status:'approved',dataUrl:'{PNG}',provenance:{{origin:'slide7.png'}}}}];"
        code+="state.decks[0].cards[0].front.push({type:'image',assetId:'verified-asset',alt:'Sample axon image'});"
    if long_text:
        code+="state.decks[0].cards[0].front[0].text += '\\n'+'Long explanation. '.repeat(250);"
    code+='renderStatus();render();'
    await page.add_script_tag(type='module',content=SHARED+'\n'+APP.replace('void initialize();',code))
    await page.locator('.dock [data-nav="review"]').click()
    await page.locator('[data-start-deck]').first.click()
    return errs

async def text(page):
    return await page.locator('.flash-face.front .block-text').first.inner_text()

async def mouse_swipe(page, selector, dx, dy=0, steps=12, end_outside=False):
    rect=await page.locator(selector).bounding_box()
    x=rect['x']+rect['width']*.5;y=rect['y']+rect['height']*.5
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.mouse.move(x+dx,y+dy,steps=steps)
    await page.mouse.up()
    await page.wait_for_timeout(260)

async def touch_drag(client,x,y,dx,dy=0,steps=14):
    await client.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
    for i in range(1,steps+1):
        await client.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/steps,'y':y+dy*i/steps,'id':1}]})
        await asyncio.sleep(.008)
    await client.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    await asyncio.sleep(.3)

async def test_mouse(browser):
    ctx=await browser.new_context(viewport={'width':1366,'height':900})
    page=await ctx.new_page();errs=await boot(page)
    # The text in the center is a gesture surface in both directions.
    await mouse_swipe(page,'.flash-face.front .block-text',135)
    assert 'Bagian neuron' in await text(page),'right swipe did not advance from center text'
    await mouse_swipe(page,'.flash-face.front .block-text',-135)
    assert 'Neurotransmiter' in await text(page),'left swipe did not advance from center text'
    # Undo navigates back to the previous card and its review entry is undone.
    await page.locator('#playerUndo').click()
    assert 'Bagian neuron' in await text(page),'Undo did not navigate back'
    # Fast reversal on same card must follow final direction (no premature commit).
    box=await page.locator('#flashStage').bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+115,y,steps=6)
    await page.mouse.move(x-110,y,steps=9);await page.mouse.up();await page.wait_for_timeout(280)
    assert 'Neurotransmiter' in await text(page),'direction reversal did not use final direction'
    # Short drag bounces back rather than flips or advances.
    await mouse_swipe(page,'.flash-face.front .block-text',40,steps=12)
    assert 'Neurotransmiter' in await text(page),'small drag unexpectedly advanced'
    assert 'flipped' not in (await page.locator('#flashScene').get_attribute('class'))
    # Back face center also supports swipe.
    await page.locator('#playerFlip').click()
    assert 'flipped' in await page.locator('#flashScene').get_attribute('class')
    await mouse_swipe(page,'.flash-face.back .block-text',-160)
    assert 'Di mana impuls' in await text(page),'back face center cannot swipe'
    assert not errs,errs
    await ctx.close()
    print('PASS mouse: text center left/right, reversed drag, gentle snap back, back-face swipe, Undo')

async def test_touch(browser):
    ctx=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True,device_scale_factor=1)
    page=await ctx.new_page();errs=await boot(page,media=True)
    cdp=await ctx.new_cdp_session(page)
    img=page.locator('img[data-zoom]');assert await img.count()==1
    # Tap image still zooms, rather than flipping or being swallowed by capture.
    await img.tap();await page.wait_for_timeout(80)
    assert await page.locator('#fullPreview').count()==1,'tap-to-zoom image broken'
    await page.locator('#closePreview').click()
    assert await page.locator('.preview-modal').count()==0
    # Actual touchscreen drag beginning on the image itself, not blank margin.
    box=await img.bounding_box();x=box['x']+box['width']*.5;y=box['y']+box['height']*.5
    await touch_drag(cdp,x,y,-130)
    assert 'Bagian neuron' in await text(page),'touch swipe over image did not advance'
    # Touch right-to-left and left-to-right from center text.
    tbox=await page.locator('.flash-face.front .block-text').bounding_box()
    x=tbox['x']+tbox['width']*.5;y=tbox['y']+tbox['height']*.5
    await touch_drag(cdp,x,y,128)
    assert 'Neurotransmiter' in await text(page),'touch right-swipe center text failed'
    # Vertical scroll on long text must not rate or flip a card.
    await ctx.close()
    ctx=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True,device_scale_factor=1)
    page=await ctx.new_page();errs2=await boot(page,long_text=True)
    cdp=await ctx.new_cdp_session(page)
    content=page.locator('.flash-face.front .face-content')
    info=await content.evaluate('(el)=>({scroll:el.scrollHeight,client:el.clientHeight})')
    assert info['scroll']>info['client'],info
    box=await content.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    await touch_drag(cdp,x,y,4,-125)
    assert 'mielin' in await text(page)
    assert 'flipped' not in await page.locator('#flashScene').get_attribute('class')
    scroll=await content.evaluate('(el)=>el.scrollTop')
    assert scroll>0, f'vertical scrolling interrupted: {scroll}'
    assert not errs+errs2,errs+errs2
    print('PASS mobile touch: image tap/zoom, image-center swipe, center-text swipe, native vertical scrolling')
    await ctx.close()

async def run():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        try:
            await test_mouse(browser)
            await test_touch(browser)
        finally:await browser.close()
if __name__=='__main__':asyncio.run(run())
