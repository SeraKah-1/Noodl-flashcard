import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {storePendingImage,approveOwnerMedia,issueMediaReviewChallenge,getOwnerMedia,serveOwnerMedia} from '../worker/media.js';
import {callTool} from '../worker/index.js';
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001.sql','utf8'));db.exec(readFileSync('migrations/0002_visual_validation.sql','utf8'));db.exec(readFileSync('migrations/0004_folders.sql','utf8'));
 return {prepare(sql){return {bind(...args){return {sql,args,first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args),all:async()=>({results:db.prepare(sql).all(...args)})}}}},async batch(commands){db.exec('BEGIN');try{const r=commands.map(q=>db.prepare(q.sql).run(...q.args));db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};}
function env(){const data=new Map();return {DB:database(),MEDIA:{async put(key,bytes){data.set(key,Uint8Array.from(bytes))},async get(key){const d=data.get(key);return d?{body:new Blob([d]).stream()}:null},async delete(key){data.delete(key)}},data};}
test('real PNG requires human review challenge before it can enter a card',async()=>{
 const service=env(),file=new Uint8Array(readFileSync('tests/fixtures/axon-sample.png'));
 const media=await storePendingImage(service,'alice',file,{kind:'slide',origin:'neurons.pdf',sourcePage:2},{observation:'Axon and myelin labels observed on a rendered slide, but still pending account-user confirmation.',legible:true,relevant:true});
 assert.equal(media.status,'pending');
 const id=media.id;
 const image=await serveOwnerMedia(service,'alice',id);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/png/);
 await assert.rejects(serveOwnerMedia(service,'bob',id),/not found/);
 await assert.rejects(approveOwnerMedia(service,'alice',id,{imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'Image inspected from slide 2'}),/challenge/);
 const challenge=await issueMediaReviewChallenge(service,'alice',id);
 await assert.rejects(approveOwnerMedia(service,'alice',id,{imageRendered:true,sourceMatches:false,labelsLegible:true,contentRelevant:true,note:'Image inspected from slide 2',challenge:challenge.challenge}),/must be confirmed/);
 const attestation={imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'Image inspected. Axon and myelin labels are legible and matched to source slide 2.',challenge:challenge.challenge};
 const approved=await approveOwnerMedia(service,'alice',id,attestation);
 assert.equal(approved.status,'approved');
 assert.equal((await getOwnerMedia(service,'alice',id)).status,'approved');
 const card={front:[{type:'text',text:'Where is the axon myelin sheath?'}],back:[{type:'text',text:'Located around the axon of the neuron.'}],clues:[{atSecond:5,text:'Neuron structure'},{atSecond:10,text:'Signal transmission'},{atSecond:15,text:'Myelin sheath'}],timerSeconds:20};
 const created=await callTool('create_deck',service,'alice',{operationId:'new-verified-deck',title:'Verified media deck',cards:[card]});assert.equal(created.cardCount,1);
 const d=await callTool('get_deck',service,'alice',{deckId:created.deckId}),cardId=d.cards[0].id;
 const candidate=await callTool('create_visual_candidate',service,'alice',{deckId:created.deckId,cardId,mediaId:id});
 await assert.rejects(callTool('attach_visual_to_card',service,'alice',{operationId:'premature',bindingId:candidate.bindingId,expectedRevision:1}),/not approved/);
 await callTool('submit_source_check',service,'alice',{bindingId:candidate.bindingId,report:{sourcePage:2,observedLabels:['axon','myelin'],supportedClaim:'The myelin sheath surrounds axons.',evidenceNote:'The source page visibly labels the axon and myelin structure next to one another.',result:'pass'}});
 await callTool('submit_visual_check',service,'alice',{bindingId:candidate.bindingId,report:{inspectedView:'final_stored_image',observedLabels:['axon','myelin'],readability:'legible_at_phone_width',supportedClaim:'The figure shows the sheath around an axon.',countercheck:'The pointer to the myelin sheath is not cropped or reversed and is separate from the cell body.',problems:[],recommendation:'pass'}});
 const ticket=await callTool('app_begin_visual_approval',service,'alice',{bindingId:candidate.bindingId});
 await callTool('app_approve_card_visual',service,'alice',{bindingId:candidate.bindingId,challenge:ticket.challenge,imageRendered:true,sourceMatches:true,labelsLegible:true,contentRelevant:true,note:'Inspected exact final image; labels are legible and relevant to this specific card.'});
 const attached=await callTool('attach_visual_to_card',service,'alice',{operationId:'attach-axon',bindingId:candidate.bindingId,expectedRevision:1});assert.equal(attached.attached,true);
 const data=await callTool('get_deck',service,'alice',{deckId:created.deckId});assert.equal(data.cards[0].back[1].assetId,id);
});
