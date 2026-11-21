import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {storePendingImage,approveOwnerMedia,issueMediaReviewChallenge,getOwnerMedia,serveOwnerMedia} from '../worker/media.js';
import {callTool} from '../worker/index.js';
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('migrations/0001.sql','utf8'));
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
 const card={front:[{type:'image',assetId:id,alt:'Labeled axon and myelin'}],back:[{type:'text',text:'Axon and myelin sheath'}],clues:[{atSecond:5,text:'Neuron structure'},{atSecond:10,text:'Signal transmission'},{atSecond:15,text:'Myelin sheath'}],timerSeconds:20};
 const created=await callTool('create_deck',service,'alice',{operationId:'new-verified-deck',title:'Verified media deck',cards:[card]});assert.equal(created.cardCount,1);
 const data=await callTool('get_deck',service,'alice',{deckId:created.deckId});assert.equal(data.cards[0].front[0].assetId,id);
});
