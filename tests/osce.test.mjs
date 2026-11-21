import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {isProcedureDeck,orderedProcedureCards,assertProcedureSequence} from '../shared/logic.js';
import {validateCard,validateDeckInput} from '../worker/validation.js';
import {callTool} from '../worker/index.js';
import {semanticHash} from '../worker/visualValidation.js';

const step=(n,opts={})=>({
 front:[{type:'text',text:`Apa yang harus diperagakan pada langkah ${n}?`}],
 back:[{type:'text',text:`Ucapkan dan peragakan langkah contoh ${n}; bukan instruksi klinis resmi.`}],
 clues:[],timerSeconds:20,tags:['OSCE','Contoh'],
 procedureStep:{order:n,checklistItem:`Butir tilik contoh ${n}`,phase:'Persiapan',critical:false,sourceDocument:'DEMO - bukan daftar tilik resmi',sourcePage:null},
 ...opts
});
const standard=()=>({front:[{type:'text',text:'Apa itu tilik?'}],back:[{type:'text',text:'Daftar langkah penilaian.'}],clues:[{atSecond:5,text:'Petunjuk 1'},{atSecond:10,text:'Petunjuk 2'},{atSecond:15,text:'Petunjuk 3'}]});
function db(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
 for(const f of ['0001.sql','0002_visual_validation.sql','0004_folders.sql'])sqlite.exec(readFileSync('migrations/'+f,'utf8'));
 return {sqlite,prepare(sql){return {bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)};}}},async batch(statements){sqlite.exec('BEGIN');try{const out=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
test('procedure steps keep source checklist item, safety flag, page, no mandatory clues',()=>{
 const validated=validateCard(step(1,{procedureStep:{order:1,checklistItem:'01 — Sapaan',phase:'Komunikasi',critical:true,sourceDocument:'Tilik Fakultas.pdf',sourcePage:4}}));
 assert.equal(validated.procedureStep.order,1);
 assert.equal(validated.procedureStep.sourcePage,4);
 assert.equal(validated.procedureStep.critical,true);
 assert.deepEqual(validated.clues,[]);
 assert.equal(validateCard(standard()).clues.length,3);
 assert.throws(()=>validateCard(step(1,{procedureStep:{order:1,checklistItem:'a',sourceDocument:'a',critical:'yes'}})),/critical/);
 assert.throws(()=>validateCard(step(1,{procedureStep:{order:1,checklistItem:'a',sourceDocument:'a',critical:false,sourcePage:-1}})),/source page/);
});
test('checklist must be entirely sequential and cannot mix with theory cards',()=>{
 assert.equal(assertProcedureSequence([step(1),step(2)]),'procedure');
 assert.equal(validateDeckInput({title:'Tilik',cards:[step(1),step(2)]}).cards.length,2);
 assert.throws(()=>validateDeckInput({title:'Gap',cards:[step(1),step(3)]}),/consecutive/);
 assert.throws(()=>validateDeckInput({title:'Mix',cards:[step(1),standard()]}),/mix/);
 assert.throws(()=>validateDeckInput({title:'Not from 1',cards:[step(2)]}),/expected 1/);
 assert.equal(isProcedureDeck([step(1),step(2)]),true);
 assert.equal(isProcedureDeck([standard()]),false);
 assert.deepEqual(orderedProcedureCards([step(2),step(1)]).map(c=>c.procedureStep.order),[1,2]);
});
test('SQLite/MCP persists procedural deck and preserves existing cards, revision, owner isolation',async()=>{
 const DB=db(),env={DB};
 const created=await callTool('create_deck',env,'alice',{operationId:'osce-create',title:'OSCE contoh',cards:[step(1),step(2)]});
 const first=await callTool('get_deck',env,'alice',{deckId:created.deckId});
 assert.equal(first.cards.length,2);assert.equal(first.cards[1].procedureStep.order,2);assert.deepEqual(first.cards[0].clues,[]);
 assert.equal((await callTool('create_deck',env,'alice',{operationId:'osce-create',title:'OSCE contoh',cards:[step(1),step(2)]})).deckId,created.deckId);
 await assert.rejects(callTool('get_deck',env,'bob',{deckId:created.deckId}),/Deck not found/);
 await assert.rejects(callTool('append_cards',env,'alice',{operationId:'bad-osce-gap',deckId:created.deckId,expectedRevision:1,cards:[step(4)]}),/consecutive/);
 await assert.rejects(callTool('append_cards',env,'alice',{operationId:'bad-osce-mix',deckId:created.deckId,expectedRevision:1,cards:[standard()]}),/mix/);
 const added=await callTool('append_cards',env,'alice',{operationId:'osce-append',deckId:created.deckId,expectedRevision:1,cards:[step(3)]});
 assert.equal(added.revision,2);
 const full=await callTool('get_deck',env,'alice',{deckId:created.deckId});assert.deepEqual(full.cards.map(c=>c.procedureStep.order),[1,2,3]);
 await assert.rejects(callTool('update_card',env,'alice',{operationId:'bad-osce-update',deckId:created.deckId,expectedRevision:2,cardId:full.cards[1].id,card:step(9)}),/order cannot change/);
 await assert.rejects(callTool('delete_card',env,'alice',{operationId:'bad-osce-delete',deckId:created.deckId,expectedRevision:2,cardId:full.cards[1].id}),/Deleting a checklist step/);
 const edited=await callTool('update_card',env,'alice',{operationId:'osce-edit',deckId:created.deckId,expectedRevision:2,cardId:full.cards[1].id,card:step(2,{back:[{type:'text',text:'Peragakan, lalu lihat ulang demonstrasi sumber.'}]})});assert.equal(edited.revision,3);
 const after=await callTool('get_deck',env,'alice',{deckId:created.deckId});assert.equal(after.cards[1].id,full.cards[1].id);assert.equal(after.cards.length,3);
});
test('OSCE does not bypass image approval or rewrite normal deck rules',async()=>{
 const DB=db(),env={DB};
 const imageCard=step(1,{back:[{type:'text',text:'Action'},{type:'image',assetId:'fake',alt:'Wrong item'}]});
 await assert.rejects(callTool('create_deck',env,'alice',{operationId:'osce-image',title:'OSCE',cards:[imageCard]}),/Images must be added after card creation/);
 assert.throws(()=>validateCard({...standard(),clues:[]}),/Exactly three clues/);
 const created=await callTool('create_deck',env,'alice',{operationId:'normal-create',title:'Normal',cards:[standard()]});
 await assert.rejects(callTool('append_cards',env,'alice',{operationId:'normal-add-osce',deckId:created.deckId,expectedRevision:1,cards:[step(1)]}),/Cannot mix/);
});

test('changing OSCE source, safety flag or step rubric invalidates visual evidence hash, ordinary cards stay backward compatible',async()=>{
 const a=validateCard(step(1));
 const h=await semanticHash(a);
 assert.notEqual(h,await semanticHash({...a,procedureStep:{...a.procedureStep,sourceDocument:'Changed tilik.pdf'}}));
 assert.notEqual(h,await semanticHash({...a,procedureStep:{...a.procedureStep,critical:true}}));
 assert.notEqual(h,await semanticHash({...a,procedureStep:{...a.procedureStep,checklistItem:'Different rubric'}}));
 const normal=validateCard(standard());
 const plain={front:normal.front,back:normal.back};
 assert.equal(await semanticHash(normal),await semanticHash(plain));
});
