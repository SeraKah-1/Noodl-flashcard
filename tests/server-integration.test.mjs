import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {callTool} from '../worker/index.js';
function memoryD1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');sqlite.exec(readFileSync('migrations/0001.sql','utf8'));
 const prepare=sql=>({bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args),sql,args};}});
 return {prepare,async batch(statements){sqlite.exec('BEGIN');try{const output=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return output;}catch(e){sqlite.exec('ROLLBACK');throw e;}},sqlite};
}
const card=i=>({front:[{type:'text',text:'Question '+i}],back:[{type:'text',text:'Answer '+i}],clues:[{atSecond:5,text:'First helpful hint'},{atSecond:10,text:'Second helpful hint'},{atSecond:15,text:'Third helpful hint'}],timerSeconds:20,tags:[]});
test('real SQLite: create, retry, revision-guarded append and account isolation',async()=>{
 const DB=memoryD1(),env={DB};const args={operationId:'op-create-1',title:'New deck',cards:[card(1)]};
 const a=await callTool('create_deck',env,'alice',args);
 const retry=await callTool('create_deck',env,'alice',args);assert.deepEqual(a,retry);
 const b=await callTool('get_deck',env,'alice',{deckId:a.deckId});assert.equal(b.cards.length,1);
 await assert.rejects(callTool('get_deck',env,'bob',{deckId:a.deckId}),/Deck not found/);
 const more=await callTool('append_cards',env,'alice',{deckId:a.deckId,expectedRevision:1,operationId:'op-add-1',cards:[card(2)]});assert.equal(more.revision,2);
 await assert.rejects(callTool('append_cards',env,'alice',{deckId:a.deckId,expectedRevision:1,operationId:'op-stale-1',cards:[card(3)]}),/Revision changed/);
 const c=await callTool('get_deck',env,'alice',{deckId:a.deckId});assert.equal(c.cards.length,2);
 const review=await callTool('record_review',env,'alice',{deckId:a.deckId,cardId:c.cards[0].id,operationId:'op-review-1',rating:3,answerRevealed:false,elapsedMs:4700,cluesSeen:[],timedOut:false});assert.equal(review.reviewId,'op-review-1');
 const due=await callTool('list_due_cards',env,'alice',{});assert.equal(due.total,2);assert.equal(due.due.length,1);
 const undo=await callTool('undo_review',env,'alice',{operationId:'op-undo-1',reviewId:'op-review-1'});assert.equal(undo.undone,true);
 const due2=await callTool('list_due_cards',env,'alice',{});assert.equal(due2.due.length,2);
 await assert.rejects(callTool('undo_review',env,'bob',{operationId:'evil-undo',reviewId:'op-review-1'}),/Review not found/);
});
test('cannot create card referencing unapproved media in real DB',async()=>{
 const DB=memoryD1(),env={DB};
 DB.sqlite.prepare(`INSERT INTO media(id,owner_id,storage_key,mime,width,height,bytes,hash,status,provenance_json,visual_review_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('fake-image','alice','a','image/png',300,200,100,'hash','pending','{"kind":"manual","origin":"slide.png"}','{"observation":"pending"}','2026-11-21');
 await assert.rejects(callTool('create_deck',env,'alice',{operationId:'create-with-pending',title:'A',cards:[{...card(1),front:[{type:'image',assetId:'fake-image',alt:'Diagram of axon'}]}]}),/requires real preview/);
 DB.sqlite.prepare(`UPDATE media SET status='approved' WHERE id='fake-image'`).run();
 const result=await callTool('create_deck',env,'alice',{operationId:'create-with-pending',title:'A',cards:[{...card(1),front:[{type:'image',assetId:'fake-image',alt:'Diagram of axon'}]}]});assert.equal(result.cardCount,1);
 await assert.rejects(callTool('create_deck',env,'bob',{operationId:'cross-image',title:'B',cards:[{...card(1),front:[{type:'image',assetId:'fake-image',alt:'Diagram of axon'}]}]}),/Image not found/);
});
