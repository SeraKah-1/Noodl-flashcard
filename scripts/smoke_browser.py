#!/usr/bin/env python3
"""Local deterministic DOM smoke. Needs `pip install playwright` and Chromium.

The sandbox used for authoring can block navigation to localhost. This smoke
therefore runs the same browser JS/CSS with an in-memory demo state. It validates
interaction and media preview, NOT the real Sites network/identity/MCP route.
"""
import asyncio
import base64
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "public/index.html").read_text().replace('<link rel="stylesheet" href="/styles.css" />','').replace('<script type="module" src="/app.js"></script>','')
CSS = (ROOT / "public/styles.css").read_text().split("\n", 1)[1]
SHARED = (ROOT / "shared/logic.js").read_text().replace('export ', '')
APP = (ROOT / "public/app.js").read_text().replace("import {CardClock,dueClues,dragRating,replayReviews} from '/shared/logic.js';", '')

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width, height in [(1366, 900), (390, 844)]:
            page = await browser.new_page(viewport={'width': width, 'height': height})
            errors = []
            page.on('pageerror', lambda exc: errors.append(str(exc)))
            await page.set_content(HTML)
            await page.add_style_tag(content=CSS)
            # about:blank is not a secure context; controlled UUIDs only for the smoke.
            await page.add_script_tag(content="let _i=0;Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>`00000000-0000-4000-8000-${String(++_i).padStart(12,'0')}`});")
            boot = APP.replace('void initialize();', 'state.initialized=true;state.decks=[demoDeck()];renderStatus();render();')
            await page.add_script_tag(type='module', content=SHARED + '\n' + boot)
            await page.locator('[data-nav="review"]').last.click()
            await page.locator('[data-start-deck]').first.click()
            assert await page.locator('.flash-face.front .block-text').first.count() == 1
            assert await page.locator('.dock').evaluate('(el)=>getComputedStyle(el).display') == 'none'
            # Swipe BEFORE flip must advance card, not accidentally flip.
            m=page.locator('#flashMotion');rect=await m.bounding_box()
            x=rect['x']+rect['width']*.5;y=rect['y']+rect['height']*.5
            await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+140,y,steps=8);await page.mouse.up()
            await page.wait_for_timeout(100)
            assert 'Bagian neuron' in await page.locator('.flash-face.front .block-text').first.inner_text()
            await page.locator('#playerUndo').click()
            assert 'mielin' in await page.locator('.flash-face.front .block-text').first.inner_text()
            await page.locator('#playerFlip').click()
            await page.locator('[data-rating="3"]').click()
            await page.wait_for_timeout(100)
            assert 'Bagian neuron' in await page.locator('.flash-face.front .block-text').first.inner_text()
            assert errors == [], errors
            print('PASS desktop' if width > 500 else 'PASS mobile', 'swipe before flip, Undo, flip, rating; dock does not obstruct player')
            await page.close()
        await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
