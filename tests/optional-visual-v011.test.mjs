import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {callTool,TOOLS} from '../worker/index.js';
import {validateCard} from '../worker/validation.js';
import {imageReferences,frontImageIds,knownFrontMediaReady,mediaRequirementOf} from '../shared/mediaPolicy.js';

const sample=()=>({front:[{type:'text',text:'Apa fungsi insulin?'}],back:[{type:'text',text:'Mengatur metabolisme glukosa.'}],clues:[{atSecond:5,text:'Hormon'},{atSecond:10,text:'Pankreas'},{atSecond:15,text:'Sel beta'}],timerSeconds:20,tags:[]});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001.sql','0002_visual_validation.sql','0003_chunked_media_upload.sql','0004_folders.sql','0005_deep_cards.sql','0006_retire_media_approval.sql'])sqlite.exec(readFileSync('migrations/'+name,'utf8'));
 const DB={prepare(sql){return {bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)}}}},async batch(stmts){sqlite.exec('BEGIN');try{const rows=stmts.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const storage=new Map();const MEDIA={async put(key,b){storage.set(key,new Uint8Array(b))},async get(key){const bytes=storage.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),body:new Blob([bytes]).stream()}:null},async head(key){return storage.has(key)?{size:storage.get(key).byteLength}:null},async delete(key){storage.delete(key)}};
 return {DB,MEDIA,storage,sqlite};
}
const raw=readFileSync('tests/fixtures/axon-sample.png');
const source={kind:'slide',origin:'SKILL_LAB_Atlas_Ilustrasi.pdf',sourcePage:6,description:'diagram neuron'};
const sourceReport={sourcePage:6,observedLabels:['axon','myelin'],supportedClaim:'This source labels the myelin sheath.',evidenceNote:'The original source page has the axon with a visible myelin label.',result:'pass'};
const visualReport={inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:['axon','myelin'],supportedClaim:'The stored picture shows an axon and myelin.',countercheck:'Image labels are visible and not mirrored or missing.',problems:[],recommendation:'pass'};
const review=(deckId,cardId,operationId)=>({deckId,cardId,operationId,rating:3,answerRevealed:false,cluesSeen:[],elapsedMs:1000,timedOut:false});

test('legacy text-only cards remain valid, optional media is not required',()=>{
 const normal=validateCard(sample());assert(!('mediaRequirement' in normal));assert.equal(mediaRequirementOf(normal),'optional');assert.deepEqual(imageReferences(normal),[]);
 for(const kind of ['none','optional','required_for_question'])assert.equal(validateCard({...sample(),mediaRequirement:kind}).mediaRequirement,kind);
 assert.throws(()=>validateCard({...sample(),mediaRequirement:'mandatory_for_every_card'}),/mediaRequirement/);
 assert.equal(knownFrontMediaReady(normal,[]),true);
 assert.equal(knownFrontMediaReady({...normal,mediaRequirement:'required_for_question'},[]),false);
});

test('media collector covers front, back, and backPages without requiring any of them',()=>{
 const c={...sample(),front:[{type:'text',text:'Question'},{type:'image',assetId:'front1',alt:'X-ray'}],back:[{type:'text',text:'Answer'},{type:'image',assetId:'back1',alt:'Annotated X-ray'}],backPages:[{id:'normal',kind:'normal',title:'Normal',blocks:[{type:'image',assetId:'page1',alt:'Clinical chart'}]}]};
 assert.deepEqual(imageReferences(c).map(x=>[x.assetId,x.side,x.pageId]),[['front1','front',null],['back1','back',null],['page1','back','normal']]);
 assert.deepEqual(frontImageIds(c),['front1']);
 assert.equal(knownFrontMediaReady({...c,mediaRequirement:'required_for_question'},[{id:'front1',status:'approved'}]),true);
 assert.equal(knownFrontMediaReady({...c,mediaRequirement:'required_for_question'},[{id:'back1',status:'approved'}]),false);
 assert.equal(knownFrontMediaReady({...c,mediaRequirement:'optional'},[]),true);
});

test('SQLite: text-only/optional cards save & review with no media bucket',async()=>{
 const env=fixture(),c1=sample(),c2={...sample(),mediaRequirement:'optional'};
 const deck=await callTool('create_deck',env,'alice',{operationId:'plain-create',title:'Plain and optional',cards:[c1,c2]});
 const current=await callTool('get_deck',env,'alice',{deckId:deck.deckId});
 for(let i=0;i<2;i++){
  const cardId=current.cards[i].id;
  const status=await callTool('get_card_media_status',env,'alice',{deckId:deck.deckId,cardId});
  assert.equal(status.ready,true);assert.deepEqual(status.missingImageIds,[]);
  const saved=await callTool('record_review',env,'alice',review(deck.deckId,cardId,'review-plain-'+i));assert.equal(saved.recorded,true);
 }
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n,2);
});

test('SQLite: explicitly required visual without front asset stays editable, blocks review, and does not write fake progress',async()=>{
 const env=fixture(),deck=await callTool('create_deck',env,'alice',{operationId:'missing-create',title:'Missing visual',cards:[{...sample(),mediaRequirement:'required_for_question'}]});
 const cardId=(await callTool('get_deck',env,'alice',{deckId:deck.deckId})).cards[0].id;
 const status=await callTool('get_card_media_status',env,'alice',{deckId:deck.deckId,cardId});
 assert.equal(status.ready,false);assert.equal(status.reason,'no_front_image_attached');
 await assert.rejects(callTool('record_review',env,'alice',review(deck.deckId,cardId,'review-forbidden')),/Required question image unavailable/);
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n,0);
 await assert.rejects(callTool('get_card_media_status',env,'bob',{deckId:deck.deckId,cardId}),/Deck not found/);
});

test('real PNG in front: upload, inspect, check A/B, attach, review; missing stored file blocks next review',async()=>{
 const env=fixture(),image=await callTool('import_media_bytes',env,'alice',{operationId:'image-upload',base64:raw.toString('base64'),mimeType:'image/png',fileName:'slide-06.png',provenance:source});
 const deck=await callTool('create_deck',env,'alice',{operationId:'image-deck',title:'Radiology ident',cards:[{...sample(),mediaRequirement:'required_for_question'}]});
 const card=(await callTool('get_deck',env,'alice',{deckId:deck.deckId})).cards[0];
 const created=await callTool('create_visual_candidate',env,'alice',{deckId:deck.deckId,cardId:card.id,mediaId:image.id,side:'front'});
 await callTool('submit_source_check',env,'alice',{bindingId:created.bindingId,report:sourceReport});
 await callTool('submit_visual_check',env,'alice',{bindingId:created.bindingId,report:visualReport});
 const attach=await callTool('attach_visual_to_card',env,'alice',{operationId:'attach-front',bindingId:created.bindingId,expectedRevision:1});assert.equal(attach.attached,true);
 const after=await callTool('get_deck',env,'alice',{deckId:deck.deckId});assert.equal(after.cards[0].front[1].assetId,image.id);
 assert.equal((await callTool('get_card_media_status',env,'alice',{deckId:deck.deckId,cardId:card.id})).ready,true);
 const ok=await callTool('record_review',env,'alice',review(deck.deckId,card.id,'image-review-good'));assert.equal(ok.recorded,true);
 const mediaKey=env.sqlite.prepare('SELECT storage_key FROM media WHERE id=?').get(image.id).storage_key;
 env.storage.delete(mediaKey);
 const unavailable=await callTool('get_card_media_status',env,'alice',{deckId:deck.deckId,cardId:card.id});assert.equal(unavailable.ready,false);assert.deepEqual(unavailable.missingImageIds,[image.id]);
 await assert.rejects(callTool('record_review',env,'alice',review(deck.deckId,card.id,'image-review-missing')),/Required question image unavailable/);
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n,1);
});

test('MCP exposes explicit visual policy and diagnostics; no mandatory global image flag',async()=>{
 const status=TOOLS.find(t=>t.name==='get_card_media_status');assert(status);assert.deepEqual(status.inputSchema.required,['deckId','cardId']);
 const caps=await callTool('get_capabilities',fixture(),'alice',{});assert.equal(caps.version,'0.11.0');assert.equal(caps.visualCards.imagesOptional,true);
 assert.equal(caps.visualCards.reviewBlockedWhenMissing,true);assert.equal(caps.visualCards.frontAndBack,true);
});

test('due queue lists blocked required-image questions separately, not as learnable due cards',async()=>{
 const env=fixture(),r=await callTool('create_deck',env,'alice',{operationId:'due-queue',title:'Visual incomplete plus text',cards:[sample(),{...sample(),mediaRequirement:'required_for_question'}]});
 const deck=await callTool('get_deck',env,'alice',{deckId:r.deckId});
 const due=await callTool('list_due_cards',env,'alice',{});
 assert.equal(due.total,2);assert.equal(due.due.length,1);assert.equal(due.blockedMedia.length,1);
 assert.equal(due.due[0].cardId,deck.cards[0].id);assert.equal(due.blockedMedia[0].cardId,deck.cards[1].id);
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n,0);
});

test('targeted MCP media policy edit preserves attached front image, two checks and review IDs',async()=>{
 const env=fixture();const media=await callTool('import_media_bytes',env,'alice',{operationId:'image-upload-edit',base64:raw.toString('base64'),mimeType:'image/png',fileName:'slide-06.png',provenance:source});
 const result=await callTool('create_deck',env,'alice',{operationId:'new-edit-policy',title:'Policy edit card',cards:[sample()]});
 const current=await callTool('get_deck',env,'alice',{deckId:result.deckId}),c=current.cards[0];
 const cand=await callTool('create_visual_candidate',env,'alice',{deckId:result.deckId,cardId:c.id,mediaId:media.id,side:'front'});
 await callTool('submit_source_check',env,'alice',{bindingId:cand.bindingId,report:sourceReport});
 await callTool('submit_visual_check',env,'alice',{bindingId:cand.bindingId,report:visualReport});
 await callTool('attach_visual_to_card',env,'alice',{operationId:'attach-for-policy',bindingId:cand.bindingId,expectedRevision:1});
 const pre=await callTool('record_review',env,'alice',review(result.deckId,c.id,'before-policy'));
 assert(pre.recorded);
 const patched=await callTool('patch_card_content',env,'alice',{deckId:result.deckId,cardId:c.id,expectedRevision:2,operationId:'policy-change',edits:[{op:'set_media_requirement',mediaRequirement:'required_for_question'}]});
 assert.equal(patched.revision,3);
 const after=await callTool('get_deck',env,'alice',{deckId:result.deckId});
 assert.equal(after.cards[0].mediaRequirement,'required_for_question');assert(after.cards[0].front.some(b=>b.assetId===media.id));
 assert.equal(env.sqlite.prepare('SELECT status FROM visual_bindings WHERE id=?').get(cand.bindingId).status,'attached');
 assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n,1);
 assert.equal((await callTool('get_card_media_status',env,'alice',{deckId:result.deckId,cardId:c.id})).ready,true);
 await assert.rejects(callTool('patch_card_content',env,'alice',{deckId:result.deckId,cardId:c.id,expectedRevision:2,operationId:'stale-policy',edits:[{op:'set_media_requirement',mediaRequirement:'none'}]}),/Revision changed/);
});
