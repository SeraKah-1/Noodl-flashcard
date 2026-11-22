import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {callTool,TOOLS} from '../worker/index.js';

function setup(existing=false){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync('migrations/0001.sql','utf8'));
 if(existing){
  sqlite.prepare(`INSERT INTO decks(id,owner_id,title,description,revision,created_at,updated_at) VALUES ('legacy','alice','Existing 64 flashcards','preserve',6,'2026-11-21','2026-11-21')`).run();
  sqlite.prepare(`INSERT INTO cards(id,owner_id,deck_id,position,content_json,created_at,updated_at) VALUES ('card-old','alice','legacy',0,'{}','2026-11-21','2026-11-21')`).run();
  sqlite.prepare(`INSERT INTO reviews(id,owner_id,deck_id,card_id,rating,revealed,clues_json,elapsed_ms,timed_out,reviewed_at) VALUES ('review-old','alice','legacy','card-old',3,1,'[]',5000,0,'2026-11-21')`).run();
 }
 sqlite.exec(readFileSync('migrations/0002_visual_validation.sql','utf8'));
 sqlite.exec(readFileSync('migrations/0003_chunked_media_upload.sql','utf8'));
 sqlite.exec(readFileSync('migrations/0004_folders.sql','utf8'));
 sqlite.exec(readFileSync('migrations/0005_deep_cards.sql','utf8'));
 const prepare=sql=>({bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)}}});
 const DB={prepare,async batch(statements){sqlite.exec('BEGIN');try{const r=statements.map(x=>sqlite.prepare(x.sql).run(...x.args));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {env:{DB},sqlite};
}
const card={front:[{type:'text',text:'Apa itu Salmonella Typhi?'}],back:[{type:'text',text:'Bakteri penyebab tifoid.'}],clues:[{atSecond:5,text:'Bakteri'},{atSecond:10,text:'Salmonella'},{atSecond:15,text:'Typhi'}],timerSeconds:20,tags:[]};
const create=(env,owner,operationId,name,parentId=null)=>callTool('create_folder',env,owner,{operationId,name,parentId});

test('MCP folder contracts exist, not just UI buttons',()=>{
 const names=TOOLS.map(x=>x.name);for(const name of ['list_folders','create_folder','rename_folder','move_folder','delete_folder','move_deck_to_folder'])assert(names.includes(name),name);
 assert(TOOLS.find(x=>x.name==='create_deck').inputSchema.properties.folderId);
});

test('new folders support nesting, idempotency, owner isolation, and duplicate detection',async()=>{
 const {env}=setup();
 const root=await create(env,'alice','create-a','Blok 9');
 assert.deepEqual(await create(env,'alice','create-a','Blok 9'),root);
 const child=await create(env,'alice','create-b','Mikrobiologi',root.folderId);
 const list=await callTool('list_folders',env,'alice',{});
 assert.equal(list.folders.length,2);assert.equal(list.folders.find(x=>x.id===child.folderId).parentId,root.folderId);
 assert.deepEqual((await callTool('list_folders',env,'bob',{})).folders,[]);
 await assert.rejects(create(env,'bob','other-owner','Pharmacology',root.folderId),/Folder not found/);
 await assert.rejects(create(env,'alice','dup-1','  BLoK  9  '),/already exists/);
 await assert.rejects(create(env,'alice','slash-1','Bad/Name'),/Invalid folder name/);
});

test('create and move decks into nested folders without losing card identity or reviews',async()=>{
 const {env,sqlite}=setup();const root=await create(env,'alice','f1','Blok 9');
 const child=await create(env,'alice','f2','Serologi',root.folderId);
 const deck=await callTool('create_deck',env,'alice',{operationId:'d1',title:'Serologi Tifoid',folderId:child.folderId,cards:[card]});
 const a=await callTool('get_deck',env,'alice',{deckId:deck.deckId});assert.equal(a.folderId,child.folderId);
 const review=await callTool('record_review',env,'alice',{deckId:a.id,cardId:a.cards[0].id,operationId:'r1',rating:3,answerRevealed:true,cluesSeen:[],elapsedMs:4000,timedOut:false});
 const moved=await callTool('move_deck_to_folder',env,'alice',{operationId:'d2',deckId:a.id,expectedRevision:a.revision,folderId:null});
 assert.equal(moved.folderId,null);assert.equal(moved.revision,a.revision+1);
 const after=await callTool('get_deck',env,'alice',{deckId:a.id});assert.equal(after.cards[0].id,a.cards[0].id);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reviews WHERE id=?').get(review.reviewId).n,1);
 await assert.rejects(callTool('move_deck_to_folder',env,'alice',{operationId:'d3',deckId:a.id,expectedRevision:a.revision,folderId:child.folderId}),/revision changed/);
 await assert.rejects(callTool('create_deck',env,'bob',{operationId:'evil',title:'Cross account',folderId:child.folderId,cards:[card]}),/Folder not found/);
});

test('folder rename and moves prevent nesting cycles and sibling name collisions',async()=>{
 const {env}=setup(),root=await create(env,'alice','r1','Root A'),other=await create(env,'alice','r2','Root B');
 const child=await create(env,'alice','c1','Child',root.folderId),sub=await create(env,'alice','c2','Sub',child.folderId);
 await assert.rejects(callTool('move_folder',env,'alice',{operationId:'cycle',folderId:root.folderId,expectedRevision:1,parentId:sub.folderId}),/inside itself/);
 await assert.rejects(callTool('move_folder',env,'alice',{operationId:'self',folderId:child.folderId,expectedRevision:1,parentId:child.folderId}),/inside itself/);
 const renamed=await callTool('rename_folder',env,'alice',{operationId:'rename1',folderId:child.folderId,expectedRevision:1,name:'Mikrobiologi'});
 assert.equal(renamed.revision,2);
 await assert.rejects(callTool('rename_folder',env,'alice',{operationId:'rename2',folderId:child.folderId,expectedRevision:1,name:'Outdated'}),/revision changed/);
 const moved=await callTool('move_folder',env,'alice',{operationId:'move1',folderId:child.folderId,expectedRevision:2,parentId:other.folderId});
 assert.equal(moved.parentId,other.folderId);
 const sibling=await create(env,'alice','sib1','Mikrobiologi',root.folderId);
 await assert.rejects(callTool('move_folder',env,'alice',{operationId:'namecollision',folderId:sibling.folderId,expectedRevision:1,parentId:other.folderId}),/already exists/);
});

test('delete a folder safely moves child folders/decks to parent; soft-delete and retry preserve history',async()=>{
 const {env,sqlite}=setup(true);
 const root=await create(env,'alice','root','Blok 9');const child=await create(env,'alice','child','Serologi',root.folderId);
 const grandchild=await create(env,'alice','grandchild','Widal',child.folderId);
 const before=await callTool('move_deck_to_folder',env,'alice',{operationId:'movedeck',deckId:'legacy',expectedRevision:6,folderId:child.folderId});
 const response=await callTool('delete_folder',env,'alice',{operationId:'deletefolder',folderId:child.folderId,expectedRevision:1});
 assert.equal(response.movedDecks,1);assert.equal(response.movedSubfolders,1);
 assert.deepEqual(await callTool('delete_folder',env,'alice',{operationId:'deletefolder',folderId:child.folderId,expectedRevision:1}),response);
 const deck=await callTool('get_deck',env,'alice',{deckId:'legacy'});assert.equal(deck.folderId,root.folderId);assert.equal(deck.revision,before.revision+1);
 const folders=(await callTool('list_folders',env,'alice',{})).folders;
 assert(!folders.some(x=>x.id===child.folderId));assert.equal(folders.find(x=>x.id===grandchild.folderId).parentId,root.folderId);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cards').get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,1);
 assert.equal(sqlite.prepare('SELECT deleted_at FROM decks WHERE id=?').get('legacy').deleted_at,null);
});

test('folder deletion aborts rather than overwrite a child sharing name with its target sibling',async()=>{
 const {env,sqlite}=setup();const x=await create(env,'alice','x','X'),a=await create(env,'alice','a','Shared',x.folderId);
 await create(env,'alice','b','Shared');
 await assert.rejects(callTool('delete_folder',env,'alice',{operationId:'abort',folderId:x.folderId,expectedRevision:1}),/already exists/);
 assert.equal(sqlite.prepare('SELECT deleted_at FROM folders WHERE id=?').get(x.folderId).deleted_at,null);
 assert.equal((await callTool('list_folders',env,'alice',{})).folders.find(x=>x.id===a.folderId).parentId,x.folderId);
});

test('existing v0.4 schema can migrate in place and preserve unfiled 64-card deck and review',()=>{
 const {sqlite}=setup(true);
 const folderId=sqlite.prepare('SELECT folder_id FROM decks WHERE id=?').get('legacy');assert.equal(folderId.folder_id,null);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM cards WHERE deck_id=?').get('legacy').n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reviews WHERE deck_id=?').get('legacy').n,1);
});
