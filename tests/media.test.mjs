import test from 'node:test';import assert from 'node:assert/strict';
import {identifyImage,allowRemoteUrl,fetchAllowedImage} from '../worker/media.js';
const png=new Uint8Array(40);png.set([137,80,78,71,13,10,26,10],0);png.set([0,0,0,13,73,72,68,82],8);png.set([0,0,1,44,0,0,0,200],16);
test('valid header yields real dimensions',()=>{assert.deepEqual(identifyImage(png),{mime:'image/png',width:300,height:200,bytes:40})});
test('image sniffing rejects spoofed HTML and SVG',()=>{const svg=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');assert.throws(()=>identifyImage(svg),/Only PNG/);});
test('decompression bombs rejected before storing',()=>{const p=new Uint8Array(png);p.set([0,0,16,0,0,0,16,0],16);assert.throws(()=>identifyImage(p),/dimensions/);});
test('network allowlist is fail-closed and exact by default',()=>{const host='images.example.org';assert.equal(allowRemoteUrl('https://images.example.org/photo.png',host).hostname,host);assert.throws(()=>allowRemoteUrl('https://images.example.org.evil.com/x',host),/not explicitly/);assert.throws(()=>allowRemoteUrl('https://127.0.0.1/p.png',host),/blocked/);assert.throws(()=>allowRemoteUrl('http://images.example.org/p',host),/HTTPS/);assert.throws(()=>allowRemoteUrl('https://images.example.org/p', ''),/not explicitly/);});
test('remote importer does not follow redirects and validates signature',async()=>{
 let seen;
 const fake=async(url,init)=>{seen=init;return new Response(png,{headers:{'content-type':'image/png'}})};
 const r=await fetchAllowedImage('https://images.example.org/test.png','images.example.org',fake);
 assert.equal(r.info.width,300);assert.equal(seen.redirect,'error');
});
