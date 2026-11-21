import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {callTool} from '../worker/index.js';
import {storePendingImage,issueMediaReviewChallenge,approveOwnerMedia} from '../worker/media.js';
function env(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON;');sql.exec(readFileSync('migrations/0001.sql','utf8'));sql.exec(readFileSync('migrations/0002_visual_validation.sql','utf8'));
 const prepare=q=>({bind(...args){return {first:async()=>sql.prepare(q).get(...args),all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args),sql:q,args};}});
 const DB={prepare,async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>sql.prepare(s.sql).run(...s.args));sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const data=new Map(),MEDIA={put:async(k,b)=>data.set(k,b),get:async k=>data.has(k)?{body:new Blob([data.get(k)]).stream()}:null,delete:async k=>data.delete(k)};
 return {DB,MEDIA,sql};
}
const card=i=>({front:[{type:'text',text:'Which structure does this image show '+i+'?'}],back:[{type:'text',text:'The axon is covered by a myelin sheath.'}],clues:[{atSecond:5,text:'Nervous system'},{atSecond:10,text:'Axon structure'},{atSecond:15,text:'Insulating layer'}],timerSeconds:20,tags:[]});
const sourceReport={sourcePage:6,observedLabels:['Myelin sheath','Axon'],supportedClaim:'The sheath wraps around an axon.',evidenceNote:'Slide clearly shows the axon in the center and the labeled insulating myelin sheath around it.',result:'pass'};
const visualReport={inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:['Myelin','Axon'],supportedClaim:'The myelin sheath is positioned around an axon in this diagram.',countercheck:'Arrow direction matches the structure, labels are not cropped, and there is no opposing relation.',problems:[],recommendation:'pass'};
async function setup(){
 const service=env(),id=(await callTool('create_deck',service,'alice',{operationId:'make-deck',title:'Serology',cards:[card(1),card(2)]})).deckId;
 const deck=await callTool('get_deck',service,'alice',{deckId:id});
 const media=await storePendingImage(service,'alice',new Uint8Array(readFileSync('tests/fixtures/axon-sample.png')),{kind:'slide',origin:'neuro.pdf',sourcePage:6,description:'Axon diagram'},{observation:'Rendered PNG depicts the neuron axon and myelin sheath in the diagram.',legible:true,relevant:true});
 const ticket=await issueMediaReviewChallenge(service,'alice',media.id);
 await approveOwnerMedia(service,'alice',media.id,{challenge:ticket.challenge,imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'I viewed the full slide and can read myelin and axon labels on the diagram.'});
 return {service,id,deck,media};
}
test('B check, card approval, and attach are impossible before A check',async()=>{
 const {service,id,deck,media}=await setup();const b=await callTool('create_visual_candidate',service,'alice',{deckId:id,cardId:deck.cards[0].id,mediaId:media.id});
 await assert.rejects(callTool('submit_visual_check',service,'alice',{bindingId:b.bindingId,report:visualReport}),/source check/);
 await assert.rejects(callTool('app_begin_visual_approval',service,'alice',{bindingId:b.bindingId}),/Both source and visual/);
 await assert.rejects(callTool('attach_visual_to_card',service,'alice',{bindingId:b.bindingId,operationId:'preattach',expectedRevision:1}),/not approved/);
 await assert.rejects(callTool('submit_source_check',service,'bob',{bindingId:b.bindingId,report:sourceReport}),/not found/);
});
test('A rejects wrong source page and B rejects unreadable or unresolved problems',async()=>{
 const {service,id,deck,media}=await setup();const b=await callTool('create_visual_candidate',service,'alice',{deckId:id,cardId:deck.cards[0].id,mediaId:media.id});
 await assert.rejects(callTool('submit_source_check',service,'alice',{bindingId:b.bindingId,report:{...sourceReport,sourcePage:99}}),/Source page disagrees/);
 await callTool('submit_source_check',service,'alice',{bindingId:b.bindingId,report:sourceReport});
 await assert.rejects(callTool('submit_visual_check',service,'alice',{bindingId:b.bindingId,report:{...visualReport,readability:'tiny'}}),/Unclear image/);
 await assert.rejects(callTool('submit_visual_check',service,'alice',{bindingId:b.bindingId,report:{...visualReport,problems:['arrow wrong']}}),/needs rework/);
});
test('two checks + human preview + atomic attach maintain deck and forbid cross-card reuse',async()=>{
 const {service,id,deck,media}=await setup();const b=await callTool('create_visual_candidate',service,'alice',{deckId:id,cardId:deck.cards[0].id,mediaId:media.id});
 await callTool('submit_source_check',service,'alice',{bindingId:b.bindingId,report:sourceReport});
 const v=await callTool('submit_visual_check',service,'alice',{bindingId:b.bindingId,report:visualReport});assert.equal(v.status,'awaiting_user_approval');
 const audit=await callTool('get_card_visual_audit',service,'alice',{bindingId:b.bindingId});assert.equal(audit.checks.length,2);assert.equal(audit.checks[0].actor_type,'model_claim');assert.equal(audit.checks[0].report.sourceIntegrity,'unverified_host_context');
 const challenge=await callTool('app_begin_visual_approval',service,'alice',{bindingId:b.bindingId});
 await assert.rejects(callTool('app_approve_card_visual',service,'alice',{bindingId:b.bindingId,challenge:'invalid',imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'I checked the source and all the visible labels carefully.'}),/challenge/);
 const approved=await callTool('app_approve_card_visual',service,'alice',{bindingId:b.bindingId,challenge:challenge.challenge,imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'I checked the source slide and final PNG, and the visual supports the card answer.'});assert.equal(approved.status,'approved_for_card');
 await assert.rejects(callTool('attach_visual_to_card',service,'alice',{bindingId:b.bindingId,operationId:'bad-revision',expectedRevision:0}),/Deck revision changed/);
 const written=await callTool('attach_visual_to_card',service,'alice',{bindingId:b.bindingId,operationId:'attach-visual',expectedRevision:1});assert.equal(written.revision,2);
 assert.deepEqual(await callTool('attach_visual_to_card',service,'alice',{bindingId:b.bindingId,operationId:'attach-visual',expectedRevision:1}),written);
 await assert.rejects(callTool('attach_visual_to_card',service,'alice',{bindingId:b.bindingId,operationId:'attach-visual',expectedRevision:2}),/Operation ID already used/);
 const after=await callTool('get_deck',service,'alice',{deckId:id});assert.equal(after.cards.length,2);assert.equal(after.cards[0].back.find(x=>x.type==='image').assetId,media.id);assert.equal(after.cards[1].back.some(x=>x.type==='image'),false);
 await assert.rejects(callTool('update_card',service,'alice',{deckId:id,expectedRevision:2,operationId:'bypass',cardId:deck.cards[1].id,card:{...card(2),back:[...card(2).back, {type:'image',assetId:media.id,alt:'Nope'}]}}),/bypasses card-specific/);
 const image=after.cards[0].back.find(block=>block.type==='image');
 await assert.rejects(callTool('update_card',service,'alice',{deckId:id,expectedRevision:2,operationId:'move-approved-image',cardId:deck.cards[0].id,card:{...card(1),front:[...card(1).front,image]}}),/bypasses card-specific/);
 const deleted=await callTool('delete_card',service,'alice',{deckId:id,expectedRevision:2,operationId:'delete-reviewed-card',cardId:deck.cards[0].id});
 assert.equal(deleted.deleted,true);
 const stale=await callTool('get_card_visual_audit',service,'alice',{bindingId:b.bindingId});
 assert.equal(stale.status,'stale');
 assert.equal(stale.checks.length,2);
});
test('changing answer makes old candidate stale and requires checking again',async()=>{
 const {service,id,deck,media}=await setup();const cardId=deck.cards[0].id,b=await callTool('create_visual_candidate',service,'alice',{deckId:id,cardId,mediaId:media.id});
 await callTool('update_card',service,'alice',{deckId:id,cardId,expectedRevision:1,operationId:'change-answer',card:{...card(1),back:[{type:'text',text:'Changed scientific answer requires new verification.'}]}});
 await assert.rejects(callTool('submit_source_check',service,'alice',{bindingId:b.bindingId,report:sourceReport}),/invalidated|Source check must run first/);
 const record=await callTool('get_card_visual_audit',service,'alice',{bindingId:b.bindingId});assert.equal(record.status,'stale');
});
