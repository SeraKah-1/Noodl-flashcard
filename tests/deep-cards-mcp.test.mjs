import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {callTool} from '../worker/index.js';
import {validateCard} from '../worker/validation.js';
import {backPagesFor,nextBackPage} from '../shared/logic.js';
import {storePendingImage} from '../worker/media.js';
import {semanticHash} from '../worker/visualValidation.js';

const clues=[5,10,15].map(atSecond=>({atSecond,text:'Bantuan langkah '+atSecond}));
const sourceReport={sourcePage:6,observedLabels:['Myelin sheath','Axon'],supportedClaim:'Myelin is located around the axon.',evidenceNote:'The source slide shows both the axon and the labeled surrounding sheath.',result:'pass'};
const visualReport={inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:['axon','myelin'],supportedClaim:'An image shows myelin covering an axon.',countercheck:'The arrow to the sheath is visible and labels are not cropped out of the final PNG.',problems:[],recommendation:'pass'};
const card=(extra={})=>({front:[{type:'text',text:'Apa fungsi mielin?'}],back:[{type:'text',text:'Mempercepat konduksi.'}],backPages:[
 {id:'technique',kind:'procedure',title:'Prosedur dan penjelasan',blocks:[{type:'text',text:'Perhatikan letak nodus Ranvier.'}]},
 {id:'normal',kind:'normal',title:'Temuan normal',blocks:[{type:'text',text:'Penghantaran impuls efisien.'}],sourceRefs:[{kind:'slide',origin:'sumber.pdf',sourcePage:6}]},
 {id:'abnormal',kind:'abnormal',title:'Temuan abnormal',blocks:[{type:'text',text:'Kerusakan mielin dapat memperlambat impuls.'}]}
],clues,timerSeconds:20,tags:['demo'],...extra});
function env(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
 for(const name of ['0001.sql','0002_visual_validation.sql','0003_chunked_media_upload.sql','0004_folders.sql','0005_deep_cards.sql'])sqlite.exec(readFileSync('migrations/'+name,'utf8'));
 const DB={prepare(q){return{bind(...args){return{q,args,first:async()=>sqlite.prepare(q).get(...args),all:async()=>({results:sqlite.prepare(q).all(...args)}),run:async()=>sqlite.prepare(q).run(...args)}}}},async batch(statements){sqlite.exec('BEGIN');try{const res=statements.map(x=>sqlite.prepare(x.q||x.sql).run(...x.args));sqlite.exec('COMMIT');return res;}catch(err){sqlite.exec('ROLLBACK');throw err;}}};
 const data=new Map();const MEDIA={put:async(k,b)=>data.set(k,Uint8Array.from(b)),get:async k=>data.has(k)?{body:new Blob([data.get(k)]).stream()}:null,delete:async k=>data.delete(k)};
 return {DB,MEDIA,sqlite};
}
async function prepare(){const service=env();const {deckId}=await callTool('create_deck',service,'alice',{operationId:'init-deep',title:'OSCE Sample',cards:[card(),card({front:[{type:'text',text:'Kartu kedua'}],backPages:undefined})]});const deck=await callTool('get_deck',service,'alice',{deckId});return {service,deckId,deck};}

test('valid backPages preserve front and concise back, allow 12 deep pages and source references',()=>{
 const c=validateCard(card());assert.equal(c.backPages.length,3);assert.deepEqual(c.backPages[1].sourceRefs,[{kind:'slide',origin:'sumber.pdf',sourcePage:6}]);
 assert.equal(backPagesFor(c).length,4);assert.equal(backPagesFor(c)[0].id,'_answer');assert.equal(nextBackPage(0,-1,c),0);assert.equal(nextBackPage(0,1,c),1);assert.equal(nextBackPage(3,1,c),3);
 assert.throws(()=>validateCard(card({backPages:Array.from({length:13},(_,i)=>({...card().backPages[0],id:'p-'+i}))})),/1..12/);
 assert.throws(()=>validateCard(card({backPages:[card().backPages[0],card().backPages[0]]})),/Duplicate/);
 assert.throws(()=>validateCard(card({backPages:[{...card().backPages[0],kind:'made-up'}]})),/kind/);
 assert.throws(()=>validateCard(card({backPages:[{...card().backPages[0],sourceRefs:[{kind:'web',origin:'http://insecure.example'}]}]})),/HTTPS/);
});

test('MCP can read exact card, paginated content, and search inside deep pages',async()=>{
 const {service,deckId,deck}=await prepare();
 const full=await callTool('get_card_content',service,'alice',{deckId,cardId:deck.cards[0].id});assert.equal(full.deckRevision,1);assert.equal(full.card.backPages[2].title,'Temuan abnormal');
 await assert.rejects(callTool('get_card_content',service,'bob',{deckId,cardId:deck.cards[0].id}),/Deck not found/);
 const page1=await callTool('list_card_contents',service,'alice',{deckId,offset:0,limit:1});assert.equal(page1.total,2);assert.equal(page1.nextOffset,1);assert.equal(page1.cards[0].backPageCount,3);
 const page2=await callTool('list_card_contents',service,'alice',{deckId,offset:1,limit:10,includeContent:true});assert.equal(page2.cards.length,1);assert.equal(page2.cards[0].front[0].text,'Kartu kedua');
 const search=await callTool('search_card_contents',service,'alice',{deckId,query:'Kerusakan mielin'});assert.equal(search.matches.length,1);assert.equal(search.matches[0].id,deck.cards[0].id);
 const isolated=await callTool('search_card_contents',service,'bob',{query:'Kerusakan mielin'});assert.equal(isolated.matches.length,0);
});

test('MCP patch targets only one deep page, retains other pages and card identity/review',async()=>{
 const {service,deckId,deck}=await prepare();const cardId=deck.cards[0].id;
 await callTool('record_review',service,'alice',{operationId:'review-deep',deckId,cardId,rating:3,answerRevealed:true,cluesSeen:[5],elapsedMs:3000,timedOut:false});
 const args={deckId,cardId,expectedRevision:1,operationId:'edit-normal',edits:[{op:'upsert_back_page',page:{...card().backPages[1],title:'Temuan normal — edit MCP',blocks:[{type:'text',text:'Teks normal revisi tanpa menimpa halaman abnormal.'}]}}]};
 const result=await callTool('patch_card_content',service,'alice',args);assert.equal(result.revision,2);
 assert.deepEqual(await callTool('patch_card_content',service,'alice',args),result);
 await assert.rejects(callTool('patch_card_content',service,'alice',{...args,edits:[{op:'replace_back',blocks:[{type:'text',text:'Bahaya'}]}]}),/Operation ID reused/);
 const after=await callTool('get_card_content',service,'alice',{deckId,cardId});assert.equal(after.card.id,cardId);assert.equal(after.card.back[0].text,'Mempercepat konduksi.');assert.equal(after.card.backPages[0].title,'Prosedur dan penjelasan');assert.equal(after.card.backPages[1].title,'Temuan normal — edit MCP');assert.equal(after.card.backPages[2].title,'Temuan abnormal');
 await assert.rejects(callTool('patch_card_content',service,'alice',{...args,operationId:'stale-edit'}),/Revision changed/);
 const due=await callTool('list_due_cards',service,'alice',{});const reviewed=due.due.find(x=>x.cardId===cardId);assert.equal(reviewed,undefined); // rated Easy is not immediately due
 assert.equal((await service.DB.prepare('SELECT COUNT(*) AS n FROM reviews WHERE card_id=?').bind(cardId).first()).n,1);
});

test('MCP patch supports insert/remove/reorder with strict page IDs and no direct image attachment',async()=>{
 const {service,deckId,deck}=await prepare();const cardId=deck.cards[0].id;
 const add=await callTool('patch_card_content',service,'alice',{operationId:'addpage',deckId,cardId,expectedRevision:1,edits:[{op:'upsert_back_page',atIndex:1,page:{id:'differential',kind:'differential',title:'Diagnosis banding',blocks:[{type:'text',text:'Temuan tunggal tidak memastikan penyakit tertentu.'}]}}]});
 assert.equal(add.revision,2);const a=(await callTool('get_card_content',service,'alice',{deckId,cardId})).card;assert.deepEqual(a.backPages.map(x=>x.id),['technique','differential','normal','abnormal']);
 await assert.rejects(callTool('patch_card_content',service,'alice',{operationId:'invalid-order',deckId,cardId,expectedRevision:2,edits:[{op:'reorder_back_pages',pageIds:['differential']}] }),/every existing page ID/);
 await assert.rejects(callTool('patch_card_content',service,'alice',{operationId:'image-bypass',deckId,cardId,expectedRevision:2,edits:[{op:'upsert_back_page',page:{id:'visual',kind:'visual',title:'Fake',blocks:[{type:'image',assetId:'pending',alt:'Tidak boleh'}]}}]}),/Images must be added after card creation|bypasses|Changing a card answer/);
 await callTool('patch_card_content',service,'alice',{operationId:'reorder',deckId,cardId,expectedRevision:2,edits:[{op:'reorder_back_pages',pageIds:['normal','abnormal','technique','differential']},{op:'remove_back_page',pageId:'differential'}]});
 assert.deepEqual((await callTool('get_card_content',service,'alice',{deckId,cardId})).card.backPages.map(p=>p.id),['normal','abnormal','technique']);
});

test('per-page image gate: reject bypass, require A+B no human click, attach only approved target page',async()=>{
 const {service,deckId,deck}=await prepare();const cardId=deck.cards[0].id;
 const png=new Uint8Array(readFileSync('tests/fixtures/axon-sample.png'));
 const media=await storePendingImage(service,'alice',png,{kind:'slide',origin:'neuro.pdf',sourcePage:6,description:'Myelin diagram'},{observation:'Myelin diagram visible and the axon is labeled on the original PDF slide.',legible:true,relevant:true});
 await assert.rejects(callTool('create_visual_candidate',service,'alice',{deckId,cardId,mediaId:media.id,pageId:'missing'}),/Back page ID/);
 const binding=await callTool('create_visual_candidate',service,'alice',{deckId,cardId,mediaId:media.id,side:'back',pageId:'normal'});
 assert.equal(binding.pageId,'normal');
 await assert.rejects(callTool('attach_visual_to_card',service,'alice',{operationId:'direct-bypass',bindingId:binding.bindingId,expectedRevision:1}),/Both source and visual checks/);
 await callTool('submit_source_check',service,'alice',{bindingId:binding.bindingId,report:sourceReport});
 await callTool('submit_visual_check',service,'alice',{bindingId:binding.bindingId,report:visualReport});
 const attached=await callTool('attach_visual_to_card',service,'alice',{bindingId:binding.bindingId,expectedRevision:1,operationId:'page-attach'});assert.equal(attached.revision,2);
 const after=(await callTool('get_card_content',service,'alice',{deckId,cardId})).card;
 assert.equal(after.backPages[1].blocks.at(-1).assetId,media.id);assert.equal(after.back.some(b=>b.type==='image'),false);assert.equal(after.backPages[0].blocks.some(b=>b.type==='image'),false);
 await assert.rejects(callTool('patch_card_content',service,'alice',{operationId:'try-false-image-caption',deckId,cardId,expectedRevision:2,edits:[{op:'upsert_back_page',page:{...after.backPages[1],blocks:after.backPages[1].blocks.map(b=>b.type==='image'?{...b,alt:'Mislabeled or unverified clinical claim'}:b)}}]}),/bypasses|Changing a card answer/);
 await assert.rejects(callTool('patch_card_content',service,'alice',{operationId:'try-move-image',deckId,cardId,expectedRevision:2,edits:[{op:'upsert_back_page',page:{...after.backPages[0],blocks:[...after.backPages[0].blocks,{type:'image',assetId:media.id,alt:'Wrong page'}]}}]}),/bypasses|Changing a card answer/);
 // A content edit is allowed only with explicit detachment of affected visual; model cannot make stale approval look fresh.
 const revised=await callTool('patch_card_content',service,'alice',{operationId:'explicit-detach-edit',deckId,cardId,expectedRevision:2,edits:[{op:'detach_images',target:'page',pageId:'normal'},{op:'upsert_back_page',page:{...after.backPages[1],blocks:[{type:'text',text:'Corrected normal page requires fresh visual approval.'}]}}]});
 assert.equal(revised.revision,3);
 assert.equal((await callTool('get_card_content',service,'alice',{deckId,cardId})).card.backPages[1].blocks.some(b=>b.type==='image'),false);
 assert.equal((await callTool('get_card_visual_audit',service,'alice',{bindingId:binding.bindingId})).status,'stale');
});

test('concurrent or unrelated account mutations cannot alter another account\'s card',async()=>{
 const {service,deckId,deck}=await prepare();
 await assert.rejects(callTool('patch_card_content',service,'bob',{deckId,cardId:deck.cards[0].id,expectedRevision:1,operationId:'bob-edit',edits:[{op:'replace_back',blocks:[{type:'text',text:'Hijacked'}]}]}),/Deck not found/);
 await assert.rejects(callTool('patch_card_content',service,'alice',{deckId,cardId:deck.cards[0].id,expectedRevision:1,operationId:'order-edit',edits:[{op:'replace_procedure_step',procedureStep:{order:1,critical:false,checklistItem:'Wrong',sourceDocument:'No source'}}]}),/procedure card|normal card/);
});
