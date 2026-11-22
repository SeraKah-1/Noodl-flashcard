import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {callTool,TOOLS,handleMcp} from '../worker/index.js';
import {storePendingImage,readMediaForModel} from '../worker/media.js';

function env(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001.sql','0002_visual_validation.sql','0003_chunked_media_upload.sql','0004_folders.sql','0005_deep_cards.sql'])sql.exec(readFileSync(`migrations/${name}`,'utf8'));
 const DB={prepare:q=>({bind(...args){return {sql:q,args,first:async()=>sql.prepare(q).get(...args),all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args)}}}),batch:async commands=>{sql.exec('BEGIN');try{const r=commands.map(c=>sql.prepare(c.sql).run(...c.args));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const files=new Map();const MEDIA={put:async(key,data)=>files.set(key,new Uint8Array(data)),get:async(key,options)=>{const b=files.get(key);if(!b)return null;const sub=options?.range?b.slice(options.range.offset,options.range.offset+options.range.length):b;return {arrayBuffer:async()=>sub.buffer.slice(sub.byteOffset,sub.byteOffset+sub.byteLength),body:new Blob([sub]).stream()};},delete:async key=>files.delete(key)};
 return {sql,DB,MEDIA,files,TRUSTED_SITES_PROXY:'true'};
}
const clues=[5,10,15].map(atSecond=>({atSecond,text:'Tanda '+atSecond}));
const cards=[0,1].map(i=>({front:[{type:'text',text:'Apa yang diperlihatkan pada mikrograf ini nomor '+i+'?'}],back:[{type:'text',text:'Lapisan mielin menyelubungi akson sehingga penghantaran impuls lebih efisien.'}],clues,timerSeconds:20,tags:[]}));
const sourceReport={sourcePage:6,observedLabels:['Myelin sheath','Axon'],supportedClaim:'Pada gambar tampak mielin dan akson yang diberi label.',evidenceNote:'Diagram sumber yang telah dibuka menampilkan arah label mielin ke lapisan dan label akson ke struktur pusat.',result:'pass'};
const visualReport={inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:['myelin','axon'],supportedClaim:'Gambar final memperlihatkan selubung mielin pada akson.',countercheck:'Pada gambar final teks dan arah panah dibaca kembali; tidak ada label yang terpotong.',problems:[],recommendation:'pass'};
async function setup(){const service=env();const png=new Uint8Array(readFileSync('tests/fixtures/axon-sample.png'));const a=await storePendingImage(service,'alice',png,{kind:'slide',origin:'neuro.pdf',sourcePage:6,description:'Diagram mielin'}, {observation:'File gambar diterima, menunggu pemeriksaan kesesuaian per kartu.',legible:false,relevant:false});const {deckId}=await callTool('create_deck',service,'alice',{operationId:'deck-create',title:'SKILL LAB',cards});const deck=await callTool('get_deck',service,'alice',{deckId});return {service,deck,a,png};}

test('manual approval tools are removed while double source/pixel checks remain',async()=>{
 const names=TOOLS.map(t=>t.name);for(const removed of ['app_approve_media','app_begin_media_review','app_begin_visual_approval','app_approve_card_visual'])assert(!names.includes(removed));
 for(const kept of ['inspect_media_image','begin_media_upload','upload_media_chunk','finish_media_upload','attach_verified_visuals_batch'])assert(names.includes(kept));
 const {service,a}=await setup();assert.equal(a.status,'approved');assert.equal(a.cardRelevanceChecked,false);
 const no=await callTool('list_media',service,'bob',{});assert.equal(no.media.length,0);
});
test('real byte image is returned by MCP as an image block with SHA-256 and owner isolation',async()=>{
 const {service,a,png}=await setup();const r=await readMediaForModel(service,'alice',a.id);assert.deepEqual(Buffer.from(r.base64,'base64'),Buffer.from(png));assert.equal(r.sha256,a.sha256);await assert.rejects(readMediaForModel(service,'bob',a.id),/not found/);
 const req=new Request('https://app.test/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'alice','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'inspect_media_image',arguments:{mediaId:a.id}}})});
 const res=await handleMcp(req,service),json=await res.json();assert.equal(json.result.content[0].type,'image');assert.equal(json.result.content[0].mimeType,'image/png');assert.equal(json.result.structuredContent.sha256,a.sha256);
});
test('batch can attach same real media to two cards without repeating manual approvals or losing review',async()=>{
 const {service,deck,a}=await setup();await callTool('record_review',service,'alice',{operationId:'review-1',deckId:deck.id,cardId:deck.cards[0].id,rating:2,answerRevealed:true,cluesSeen:[],elapsedMs:900,timedOut:false});
 const items=deck.cards.map(c=>({deckId:deck.id,cardId:c.id,mediaId:a.id,sourceReport,visualReport}));
 const result=await callTool('attach_verified_visuals_batch',service,'alice',{operationId:'batch-skills',items});assert.equal(result.attached,2,JSON.stringify(result));assert.equal(result.failed,0);
 const after=await callTool('get_deck',service,'alice',{deckId:deck.id});assert.equal(after.cards.length,2);assert.equal(after.revision,3);assert(after.cards.every(c=>c.back.some(b=>b.type==='image'&&b.assetId===a.id)));assert.equal(service.sql.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,1);
 const retry=await callTool('attach_verified_visuals_batch',service,'alice',{operationId:'batch-skills',items});assert.equal(retry.alreadyAttached,2);assert.equal(retry.attached,0);
});
test('batch rejects wrong page and omitted report while leaving unrelated card alone',async()=>{
 const {service,deck,a}=await setup();const result=await callTool('attach_verified_visuals_batch',service,'alice',{operationId:'bad-and-good',items:[{deckId:deck.id,cardId:deck.cards[0].id,mediaId:a.id,sourceReport:{...sourceReport,sourcePage:9},visualReport},{deckId:deck.id,cardId:deck.cards[1].id,mediaId:a.id,sourceReport,visualReport}]});assert.equal(result.failed,1);assert.equal(result.attached,1);
 const after=await callTool('get_deck',service,'alice',{deckId:deck.id});assert(!after.cards[0].back.some(b=>b.type==='image'));assert(after.cards[1].back.some(b=>b.type==='image'));
 await assert.rejects(callTool('update_card',service,'alice',{deckId:deck.id,cardId:after.cards[0].id,operationId:'no-bypass',expectedRevision:2,card:{...cards[0],back:[...cards[0].back,{type:'image',assetId:a.id,alt:'not checked'}]}}),/bypasses card-specific/);
});
test('legacy pending media are upgraded only when actual stored bytes pass integrity check',async()=>{
 const {service,a}=await setup();service.sql.prepare("UPDATE media SET status='pending' WHERE id=?").run(a.id);
 const r=await callTool('accept_legacy_media',service,'alice',{mediaId:a.id});assert.equal(r.status,'approved');
 service.sql.prepare("UPDATE media SET status='pending',hash='bad' WHERE id=?").run(a.id);
 await assert.rejects(callTool('accept_legacy_media',service,'alice',{mediaId:a.id}),/integrity checks/);
});
