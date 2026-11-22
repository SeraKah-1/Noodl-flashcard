import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {callTool, TOOLS} from '../worker/index.js';
import {readMediaForModel} from '../worker/media.js';
import {createCandidate} from '../worker/visualValidation.js';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const filename of ['0001.sql','0002_visual_validation.sql','0003_chunked_media_upload.sql','0004_folders.sql','0005_deep_cards.sql'])sqlite.exec(readFileSync('migrations/'+filename,'utf8'));
 const DB={prepare(q){return {bind(...args){return{sql:q,args,first:async()=>sqlite.prepare(q).get(...args),all:async()=>({results:sqlite.prepare(q).all(...args)}),run:async()=>sqlite.prepare(q).run(...args)}}}},async batch(commands){sqlite.exec('BEGIN');try{const result=commands.map(c=>sqlite.prepare(c.sql).run(...c.args));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const storage=new Map();const MEDIA={put:async(key,bytes)=>storage.set(key,new Uint8Array(bytes)),get:async(key,options)=>{const full=storage.get(key);if(!full)return null;const b=options?.range?full.slice(options.range.offset,options.range.offset+options.range.length):full;return {arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),body:new Blob([b]).stream()}},delete:async(key)=>storage.delete(key)};
 return {sqlite,DB,MEDIA,storage};
}
const src={kind:'slide',origin:'Clinical skills atlas.pdf',sourcePage:6,description:'Labels for original diagram'};
const raw=new Uint8Array(readFileSync('tests/fixtures/axon-sample.png'));
const input=(operationId='first')=>({operationId,base64:Buffer.from(raw).toString('base64'),mimeType:'image/png',fileName:'slide-06.png',provenance:src});
const card={front:[{type:'text',text:'Where does the myelin sheath appear?'}],back:[{type:'text',text:'The myelin sheath surrounds the axon.'}],clues:[{atSecond:5,text:'Clue one'},{atSecond:10,text:'Clue two'},{atSecond:15,text:'Clue three'}],timerSeconds:20,tags:[]};
const sourceReport={sourcePage:6,observedLabels:['myelin','axon'],supportedClaim:'The original figure identifies the axon and the sheath.',evidenceNote:'I checked the page number and the visible labels in the original source slide.',result:'pass'};
const visualReport={inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:['myelin','axon'],supportedClaim:'The diagram visibly marks an axon surrounded by myelin.',countercheck:'The myelin arrow points to the outer sheath and the axon is distinct.',problems:[],recommendation:'pass'};

test('direct MCP base64 import is first class, with no host ID, no approval, owner isolation and idempotent retry',async()=>{
 const env=fixture();const t=TOOLS.find(t=>t.name==='import_media_bytes');assert(t);assert(!TOOLS.some(t=>t.name==='import_media_file'||t._meta?.['openai/fileParams']));
 const a=await callTool('import_media_bytes',env,'alice',input());
 assert.equal(a.status,'approved');assert.equal(a.integrityChecked,true);assert.equal(a.cardRelevanceChecked,false);
 assert.equal(env.storage.size,1);assert.deepEqual(Buffer.from((await readMediaForModel(env,'alice',a.id)).base64,'base64'),Buffer.from(raw));
 assert.deepEqual(await callTool('import_media_bytes',env,'alice',input()),a);assert.equal(env.storage.size,1);
 assert.equal((await callTool('list_media',env,'bob',{})).media.length,0);
 await assert.rejects(readMediaForModel(env,'bob',a.id),/not found/);
 const caps=await callTool('get_capabilities',env,'alice',{});assert.equal(caps.requiresHostTransferredFileId,false);assert.equal(caps.manualApprovalRequired,false);
});
test('direct import rejects malformed and oversized Base64, MIME spoof and empty content, without writes',async()=>{
 const env=fixture();
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('bad1'),base64:'no-image!!!'}),/Invalid base64/);
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('bad2'),mimeType:'image/jpeg'}),/MIME/);
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('bad3'),base64:Buffer.alloc(256*1024+1,0).toString('base64')}),/Invalid base64|256 KiB/);
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('bad4'),base64:Buffer.from('<script>alert(1)</script>').toString('base64')}),/Image|PNG|JPEG|WebP/);
 assert.equal(env.storage.size,0);assert.equal((await callTool('list_media',env,'alice',{})).media.length,0);
});
test('direct bytes can complete full card-specific visual pipeline without any human approval callback',async()=>{
 const env=fixture();const media=await callTool('import_media_bytes',env,'alice',input('visual-upload'));
 const create=await callTool('create_deck',env,'alice',{operationId:'create-deck',title:'OSCE',cards:[card]});
 const {deckId}=create;const deck=await callTool('get_deck',env,'alice',{deckId});
 const c=await callTool('create_visual_candidate',env,'alice',{deckId,cardId:deck.cards[0].id,mediaId:media.id});
 await assert.rejects(callTool('attach_visual_to_card',env,'alice',{operationId:'too-early',bindingId:c.bindingId,expectedRevision:deck.revision}),/Both source and visual/);
 await callTool('submit_source_check',env,'alice',{bindingId:c.bindingId,report:sourceReport});
 await callTool('submit_visual_check',env,'alice',{bindingId:c.bindingId,report:visualReport});
 const done=await callTool('attach_visual_to_card',env,'alice',{operationId:'attach',bindingId:c.bindingId,expectedRevision:deck.revision});assert.equal(done.attached,true);
 const after=await callTool('get_deck',env,'alice',{deckId});assert.equal(after.cards.length,1);assert(after.cards[0].back.some(b=>b.type==='image'&&b.assetId===media.id));
});
test('legacy pending bytes are upgraded upon candidate creation, no manual acceptance needed',async()=>{
 const env=fixture(),media=await callTool('import_media_bytes',env,'alice',input());
 const {deckId}=await callTool('create_deck',env,'alice',{operationId:'d-legacy',title:'Legacy deck',cards:[card]});
 const deck=await callTool('get_deck',env,'alice',{deckId});
 env.sqlite.prepare("UPDATE media SET status='pending' WHERE id=?").run(media.id);
 const c=await createCandidate(env,'alice',{deckId,cardId:deck.cards[0].id,mediaId:media.id});assert.equal(c.status,'candidate');
 assert.equal(env.sqlite.prepare('SELECT status FROM media WHERE id=?').get(media.id).status,'approved');
 env.sqlite.prepare("UPDATE media SET status='pending', hash='BAD' WHERE id=?").run(media.id);
 await assert.rejects(createCandidate(env,'alice',{deckId,cardId:deck.cards[0].id,mediaId:media.id}),/integrity checks/);
});
test('v0.10 migration retires challenge tables, preserves history and promotes double-checked candidates only',async()=>{
 const env=fixture();const media=await callTool('import_media_bytes',env,'alice',input());
 const {deckId}=await callTool('create_deck',env,'alice',{operationId:'d-migration',title:'History',cards:[card]});
 const deck=await callTool('get_deck',env,'alice',{deckId});
 const candidate=await callTool('create_visual_candidate',env,'alice',{deckId,cardId:deck.cards[0].id,mediaId:media.id});
 await callTool('submit_source_check',env,'alice',{bindingId:candidate.bindingId,report:sourceReport});
 await callTool('submit_visual_check',env,'alice',{bindingId:candidate.bindingId,report:visualReport});
 env.sqlite.prepare("UPDATE visual_bindings SET status='awaiting_user_approval' WHERE id=?").run(candidate.bindingId);
 env.sqlite.prepare("UPDATE media SET status='pending' WHERE id=?").run(media.id);
 env.sqlite.exec(readFileSync('migrations/0006_retire_media_approval.sql','utf8'));
 assert.equal(env.sqlite.prepare('SELECT status FROM visual_bindings WHERE id=?').get(candidate.bindingId).status,'approved_for_card');
 assert.equal(env.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='media_review_challenges'").get(),undefined);
 assert.equal(env.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='visual_approval_challenges'").get(),undefined);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS count FROM cards').get().count,1);
 const done=await callTool('attach_visual_to_card',env,'alice',{operationId:'finish-legacy',bindingId:candidate.bindingId,expectedRevision:1});assert.equal(done.attached,true);
 assert.equal(env.sqlite.prepare('SELECT status FROM media WHERE id=?').get(media.id).status,'approved');
});
test('embedded UI cannot invoke host-transfer branch and uses direct MCP chunks',()=>{
 const src=readFileSync('public/app.js','utf8');
 assert(!src.includes('window.openai.uploadFile('));assert(!src.includes('window.openai.getFileDownloadUrl('));
 assert(!src.includes("hostCall('import_media_file'"));
 assert.match(src,/if\(state\.backend==='embedded'\)return chunkUploadViaMcp\(file\)/);
});

test('idempotency keys cannot be reused with another image MIME, source, or byte payload',async()=>{
 const env=fixture();const a=await callTool('import_media_bytes',env,'alice',input('fixed-key'));
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('fixed-key'),provenance:{...src,sourcePage:7}}),/Operation ID already used/);
 const next=Uint8Array.from(raw);next[next.length-1]^=1;
 await assert.rejects(callTool('import_media_bytes',env,'alice',{...input('fixed-key'),base64:Buffer.from(next).toString('base64')}),/Operation ID already used/);
 assert.equal((await callTool('list_media',env,'alice',{})).media.length,1);assert.equal(a.id,(await callTool('list_media',env,'alice',{})).media[0].id);
});
