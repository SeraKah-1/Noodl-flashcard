import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {beginChunkedUpload,appendChunkedUpload,finishChunkedUpload,CHUNK_BYTES} from '../worker/chunkedUpload.js';
import {TOOLS,callTool} from '../worker/index.js';
import {readOwnerMediaChunk} from '../worker/media.js';
function mockEnv(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const n of ['0001.sql','0002_visual_validation.sql','0003_chunked_media_upload.sql','0005_deep_cards.sql'])sqlite.exec(readFileSync('migrations/'+n,'utf8'));
 const DB={prepare:sql=>({bind(...args){return{first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args),sql,args}}}),async batch(stmts){sqlite.exec('BEGIN');try{const r=stmts.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const stored=new Map(),MEDIA={put:async(k,data)=>{stored.set(k,new Uint8Array(data));},get:async(k,options)=>{const data=stored.get(k);if(!data)return null;const selected=options?.range?data.slice(options.range.offset,options.range.offset+options.range.length):data;return {body:selected,arrayBuffer:async()=>selected.buffer.slice(selected.byteOffset,selected.byteOffset+selected.byteLength)};},delete:async k=>stored.delete(k)};
 return {DB,MEDIA,sqlite,stored};
}
function png(size=500){const b=new Uint8Array(size);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,1,44,0,0,0,200]);return b;}
const b64=data=>Buffer.from(data).toString('base64');
const src={kind:'slide',origin:'Serologi Tifoid slide 6',sourcePage:6};
test('chunk importer reassembles actual file, quarantines image, and preserves owner',async()=>{
 const env=mockEnv(),bytes=png(CHUNK_BYTES+128);
 const start=await beginChunkedUpload(env,'alice',{byteLength:bytes.length,mimeType:'image/png',fileName:'slide06.png',provenance:src});
 assert.equal(start.chunkBytes,CHUNK_BYTES);
 const a=await appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:0,base64:b64(bytes.slice(0,CHUNK_BYTES))});assert.equal(a.nextIndex,1);
 const same=await appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:0,base64:b64(bytes.slice(0,CHUNK_BYTES))});assert.equal(same.replayed,true);
 await assert.rejects(appendChunkedUpload(env,'bob',{uploadId:start.uploadId,index:1,base64:b64(bytes.slice(CHUNK_BYTES))}),/not found/);
 await assert.rejects(finishChunkedUpload(env,'alice',{uploadId:start.uploadId}),/incomplete/);
 await appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:1,base64:b64(bytes.slice(CHUNK_BYTES))});
 const out=await finishChunkedUpload(env,'alice',{uploadId:start.uploadId});
 assert.equal(out.status,'pending');assert.equal(out.width,300);assert.equal(out.bytes,bytes.length);assert.equal(out.provenance.sourcePage,6);
 assert.equal(env.stored.size,1);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM media_uploads').get().n,0);
 const fetched=await callTool('list_media',env,'alice',{});assert.equal(fetched.media.length,1);
 const chunks=[];for(let index=0;index<2;index++)chunks.push(await readOwnerMediaChunk(env,'alice',out.id,index));
 assert.deepEqual(Buffer.concat(chunks.map(c=>Buffer.from(c.base64,'base64'))),Buffer.from(bytes));
 await assert.rejects(readOwnerMediaChunk(env,'bob',out.id,0),/not found/);
 const other=await callTool('list_media',env,'bob',{});assert.equal(other.media.length,0);
});
test('chunk importer rejects spoofed bytes, corrupted base64, oversized, wrong order and MIME mismatch',async()=>{
 const env=mockEnv();
 await assert.rejects(beginChunkedUpload(env,'alice',{byteLength:4_000_001,mimeType:'image/png',fileName:'x',provenance:src}),/4 MB/);
 const start=await beginChunkedUpload(env,'alice',{byteLength:500,mimeType:'image/jpeg',fileName:'slide.png',provenance:src});
 await assert.rejects(appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:1,base64:b64(png(500))}),/Out of order/);
 await assert.rejects(appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:0,base64:'SGVsbG8$'}),/Invalid base64/);
 await appendChunkedUpload(env,'alice',{uploadId:start.uploadId,index:0,base64:b64(png(500))});
 await assert.rejects(finishChunkedUpload(env,'alice',{uploadId:start.uploadId}),/MIME differs/);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);
});
test('real MCP registry supplies no-host-file upload alternative and keeps it app-only',()=>{
 for(const name of ['app_begin_media_upload','app_upload_media_chunk','app_finish_media_upload','app_get_media_chunk']){
  const t=TOOLS.find(t=>t.name===name);assert(t,`${name} missing`);assert.deepEqual(t._meta.ui.visibility,['app']);
 }
 const importFile=TOOLS.find(t=>t.name==='import_media_file');assert.deepEqual(importFile._meta['openai/fileParams'],['file']);
});
