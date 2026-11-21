import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateCard} from '../worker/validation.js';
import {semanticHash} from '../worker/visualValidation.js';
import {callTool} from '../worker/index.js';
const clues=[5,10,15].map((atSecond,i)=>({atSecond,text:`Petunjuk ${i+1}`}));
const valid=(extra={})=>({front:[{type:'text',text:'Pertanyaan'}],back:[{type:'text',text:'Jawaban inti'}],clues,timerSeconds:20,...extra});
function db(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
 for(const f of ['0001.sql','0002_visual_validation.sql','0004_folders.sql'])sqlite.exec(readFileSync('migrations/'+f,'utf8'));
 return {sqlite,prepare(sql){return {bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}}},async batch(statements){sqlite.exec('BEGIN');try{const out=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
test('old cards stay identical; new long answer and sections are never silently truncated',()=>{
 const old=validateCard(valid());assert.equal(old.back[0].text,'Jawaban inti');assert.equal(old.explanation,undefined);
 const long='AWAL_TEXT\n'+'Penjelasan detail yang harus tetap utuh. '.repeat(175)+'\nAKHIR_TEXT';
 const card=validateCard(valid({front:[{type:'text',text:long}],back:[{type:'text',text:long}],explanation:{sections:[{heading:'Mekanisme',blocks:[{type:'text',text:long},{type:'math',latex:'x+y=z'}]}]}}));
 assert.equal(card.front[0].text,long);assert.equal(card.back[0].text,long);assert.equal(card.explanation.sections[0].blocks[0].text,long);
 assert.equal(card.explanation.sections[0].heading,'Mekanisme');
 assert.throws(()=>validateCard(valid({back:[{type:'text',text:'x'.repeat(10001)}]})),/Invalid text/);
 assert.throws(()=>validateCard(valid({explanation:{sections:[{heading:'A',blocks:[{type:'text',text:'x'.repeat(10001)}]}]}})),/Invalid text/);
});
test('explanation rejects image bypass and preserves per-card double approval',()=>{
 assert.throws(()=>validateCard(valid({explanation:{sections:[{heading:'Diagram',blocks:[{type:'image',assetId:'unapproved',alt:'Hidden'}]}]}})),/Put verified images on the card back/);
 assert.equal(validateCard(valid({back:[{type:'image',assetId:'fake',alt:'Structurally valid, server must gate attachment'}]})).back[0].type,'image'); // server gates actual attachment
});
test('changing explanation changes card-specific verification hash',async()=>{
 const a=validateCard(valid({explanation:{sections:[{heading:'Analisis',blocks:[{type:'text',text:'Alasan lama'}]}]}}));
 const b=validateCard(valid({explanation:{sections:[{heading:'Analisis',blocks:[{type:'text',text:'Alasan baru'}]}]}}));
 assert.notEqual(await semanticHash(a),await semanticHash(b));
 assert.equal(await semanticHash(validateCard(valid())),await semanticHash(valid()));
});
test('MCP stores and updates layered content through existing deck tools',async()=>{
 const DB=db(),env={DB};const layer=valid({explanation:{sections:[{heading:'Cara kerja',blocks:[{type:'text',text:'Detail '+ 'A'.repeat(4500)}]},{heading:'Catatan klinis',blocks:[{type:'text',text:'Catatan penting'}]}]}});
 const created=await callTool('create_deck',env,'alice',{operationId:'layer-create',title:'Long Deck',cards:[layer]});
 const fresh=await callTool('get_deck',env,'alice',{deckId:created.deckId});
 assert.equal(fresh.cards[0].explanation.sections[0].blocks[0].text.length,4507);
 const updated={...layer,back:[{type:'text',text:'Jawaban lebih jelas'}]};
 await callTool('update_card',env,'alice',{operationId:'layer-edit',deckId:created.deckId,expectedRevision:1,cardId:fresh.cards[0].id,card:updated});
 const after=await callTool('get_deck',env,'alice',{deckId:created.deckId});
 assert.equal(after.cards[0].id,fresh.cards[0].id);
 assert.equal(after.cards[0].explanation.sections.length,2);
 assert.equal(after.cards[0].back[0].text,'Jawaban lebih jelas');
});
