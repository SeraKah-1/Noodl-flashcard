import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('whole-card stage handles pointer capture and image zoom without hijacking vertical scroll',()=>{
 const app=readFileSync('public/app.js','utf8');
 const css=readFileSync('public/styles.css','utf8');
 assert.match(app,/function bindGestures\(\)/);
 assert.match(app,/stage\.setPointerCapture\(e\.pointerId\)/);
 assert.match(app,/if\(!pointer\.zoomTarget\)/);
 assert.match(app,/e\.target===stage&&pointer\?\.id===e\.pointerId/);
 assert.match(app,/requestAnimationFrame\(paint\)/);
 assert.match(css,/touch-action:pan-y/);
 assert.match(css,/\.swipe-exiting/);
 assert.match(css,/\.enter-from-left/);
 assert.match(css,/\.enter-from-right/);
});
