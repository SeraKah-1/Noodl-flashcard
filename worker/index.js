import {validateCard,validateDeckInput,validateReview,validateProvenance,validateVisualReview} from './validation.js';
import {assertProcedureSequence} from '../shared/logic.js';
import {storePendingImage,fetchAllowedImage,getOwnerMedia,mediaSummary,listOwnerMedia,serveOwnerMedia,readOwnerMediaChunk,rejectOwnerMedia,identifyImage,acceptPendingMediaIntegrity,readMediaForModel} from './media.js';
import {replayReviews} from '../shared/logic.js';
import {listFolders,requireFolder,createFolder,renameFolder,moveFolder,deleteFolder,moveDeckToFolder} from './folders.js';
import {beginChunkedUpload,appendChunkedUpload,finishChunkedUpload,purgeExpiredUploads} from './chunkedUpload.js';
import {createCandidate,submitSourceCheck,submitVisualCheck,listVisualCandidates,inspectVisualBinding,attachCardVisual,assertNoUnapprovedImages,invalidateCardBindings,semanticHash} from './visualValidation.js';
const uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function required(v,label,max=200){if(typeof v!=='string'||!v.trim()||v.length>max)fail(`Invalid ${label}`);return v.trim();}
function replyJson(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function identity(req,env){
 // Never accept a caller-supplied owner ID in a public Worker. Trusted Sites must strip/spoof-proof identity headers at ingress.
 if(env.TRUSTED_SITES_PROXY!=='true')fail('MCP requires trusted ChatGPT Sites hosting. Standalone browser uses local-only demo mode.',401);
 const id=req.headers.get('oai-authenticated-user-id');
 if(!id||id.length>200)fail('Authenticated ChatGPT Sites identity required',401);
 return id;
}
async function parseBody(req,maxBytes=2_000_000){
 const bytes=await req.arrayBuffer();if(bytes.byteLength>maxBytes)fail('Request too large',413);
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid JSON');}
}
async function opReceipt(db,owner,id){const row=await db.prepare('SELECT result_json FROM operations WHERE owner_id=? AND id=?').bind(owner,id).first();return row?JSON.parse(row.result_json):null;}
const mutationReceipt=(id,result,nonce,owner)=>({id,owner,nonce,result:JSON.stringify(result),at:now()});
const opInsert=(db,r,conditionSQL='WHERE 1=1',args=[])=>db.prepare(`INSERT INTO operations(owner_id,id,result_json,nonce,created_at) SELECT ?,?,?,?,? ${conditionSQL} ON CONFLICT(owner_id,id) DO NOTHING`).bind(r.owner,r.id,r.result,r.nonce,r.at,...args);
const nonceGuard='EXISTS(SELECT 1 FROM operations WHERE owner_id=? AND id=? AND nonce=?)';
async function uniqueWrite(env,owner,operationId,result,statements){
 required(operationId,'operationId',120);
 const prev=await opReceipt(env.DB,owner,operationId);if(prev)return prev;
 const r=mutationReceipt(operationId,result,uuid(),owner);
 await env.DB.batch([opInsert(env.DB,r,...(statements.condition||[])),...statements.build(r)]);
 const saved=await opReceipt(env.DB,owner,operationId);
 if(!saved)fail('Conflict: record revision changed',409);
 return saved;
}
async function ownedDeck(db,owner,id){const row=await db.prepare('SELECT * FROM decks WHERE id=? AND owner_id=? AND deleted_at IS NULL').bind(id,owner).first();if(!row)fail('Deck not found',404);return row;}
async function deckWithCards(db,owner,id){const row=await ownedDeck(db,owner,id);const cards=(await db.prepare('SELECT id,position,content_json FROM cards WHERE owner_id=? AND deck_id=? ORDER BY position').bind(owner,id).all()).results.map(x=>({id:x.id,position:x.position,...JSON.parse(x.content_json)}));return {id:row.id,title:row.title,description:row.description,folderId:row.folder_id??null,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,cards};}
async function listDecks(db,owner){return (await db.prepare('SELECT id,title,description,folder_id,revision,created_at,updated_at,(SELECT COUNT(*) FROM cards WHERE cards.deck_id=decks.id AND cards.owner_id=?) AS cardCount FROM decks WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200').bind(owner,owner).all()).results.map(row=>({id:row.id,title:row.title,description:row.description,folderId:row.folder_id??null,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,cardCount:row.cardCount}));}
async function reviewHistory(db,owner){return (await db.prepare('SELECT * FROM reviews WHERE owner_id=? ORDER BY reviewed_at ASC LIMIT 5000').bind(owner).all()).results.map(r=>({id:r.id,deckId:r.deck_id,cardId:r.card_id,rating:r.rating,answerRevealed:!!r.revealed,cluesSeen:JSON.parse(r.clues_json),elapsedMs:r.elapsed_ms,timedOut:!!r.timed_out,reviewedAt:r.reviewed_at,undoneAt:r.undone_at}));}
async function createDeck(env,owner,args){
 const opId=required(args.operationId,'operationId',120);
 const prior=await opReceipt(env.DB,owner,opId);if(prior)return prior;
 const folderId=await requireFolder(env.DB,owner,args.folderId);
 const input=validateDeckInput(args),id=uuid(),cards=input.cards.map((c,i)=>({id:uuid(),position:i,...c})),time=now();
 for(const card of cards) await assertNoUnapprovedImages(env,owner,null,null,card);
 const result={deckId:id,folderId,revision:1,cardCount:cards.length,createdAt:time};
 return uniqueWrite(env,owner,opId,result,{...(folderId?{condition:[`WHERE EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND deleted_at IS NULL)`,[owner,folderId]]}:{}),build:r=>[
  env.DB.prepare(`INSERT INTO decks(id,owner_id,title,description,folder_id,revision,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE ${nonceGuard}`).bind(id,owner,input.title,input.description,folderId,time,time,owner,r.id,r.nonce),
  ...cards.map(c=>env.DB.prepare(`INSERT INTO cards(id,owner_id,deck_id,position,content_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${nonceGuard}`).bind(c.id,owner,id,c.position,JSON.stringify(c),time,time,owner,r.id,r.nonce))
 ]});
}
async function appendCards(env,owner,args){
 const id=required(args.deckId,'deckId'),opId=required(args.operationId,'operationId',120);
 const prev=await opReceipt(env.DB,owner,opId);if(prev)return prev;
 const row=await ownedDeck(env.DB,owner,id);
 if(row.revision!==args.expectedRevision)fail('Revision changed',409);
 if(!Array.isArray(args.cards)||args.cards.length<1||args.cards.length>100)fail('Append requires 1..100 cards');
 const cards=args.cards.map(validateCard);for(const card of cards) await assertNoUnapprovedImages(env,owner,null,null,card);
 const oldCount=(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id=? AND deck_id=?').bind(owner,id).first()).n;
 const first=(await env.DB.prepare('SELECT content_json FROM cards WHERE owner_id=? AND deck_id=? ORDER BY position LIMIT 1').bind(owner,id).first());
 const existingProcedure=!!(first&&JSON.parse(first.content_json).procedureStep);
 const incomingProcedure=assertProcedureSequence(cards,existingProcedure?oldCount+1:1)==='procedure';
 if(existingProcedure!==incomingProcedure)fail('Cannot mix OSCE procedure steps with ordinary flashcards in one deck');
 if(!existingProcedure&&incomingProcedure)fail('Cannot append procedure steps to an ordinary deck');
 if(oldCount+cards.length>1000)fail('A deck can contain at most 1000 cards');
 const time=now(),newCards=cards.map((c,i)=>({id:uuid(),position:oldCount+i,...c}));
 const result={deckId:id,revision:row.revision+1,added:cards.length};
 return uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,id,row.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET revision=revision+1, updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(time,id,owner,row.revision,owner,r.id,r.nonce),
  ...newCards.map(c=>env.DB.prepare(`INSERT INTO cards(id,owner_id,deck_id,position,content_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${nonceGuard}`).bind(c.id,owner,id,c.position,JSON.stringify(c),time,time,owner,r.id,r.nonce))
 ]});
}
async function editCard(env,owner,args,remove=false){
 const id=required(args.deckId,'deckId'),cardId=required(args.cardId,'cardId'),opId=required(args.operationId,'operationId',120);
 const prev=await opReceipt(env.DB,owner,opId);if(prev)return prev;
 const row=await ownedDeck(env.DB,owner,id);if(row.revision!==args.expectedRevision)fail('Revision changed',409);
 const existing=await env.DB.prepare('SELECT id,position,content_json FROM cards WHERE id=? AND owner_id=? AND deck_id=?').bind(cardId,owner,id).first();if(!existing)fail('Card not found',404);
 const oldCard=JSON.parse(existing.content_json);
 if(remove&&oldCard.procedureStep)fail('Deleting a checklist step may silently omit a required action. Create a revised deck instead.');
 if(remove){const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id=? AND deck_id=?').bind(owner,id).first()).n;if(count<=1)fail('Deck must keep at least one card');}
 const card=remove?null:validateCard(args.card);
 if(card&&Boolean(card.procedureStep)!==Boolean(oldCard.procedureStep))fail('Cannot convert a checklist step into an ordinary card or vice versa');
 if(card?.procedureStep&&card.procedureStep.order!==oldCard.procedureStep.order)fail('Checklist step order cannot change through update_card');
 if(card)await assertNoUnapprovedImages(env,owner,id,cardId,card);
 const time=now(),result={deckId:id,cardId,revision:row.revision+1,deleted:remove};
 const resultWrite=await uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,id,row.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(time,id,owner,row.revision,owner,r.id,r.nonce),
  remove?env.DB.prepare(`DELETE FROM cards WHERE id=? AND owner_id=? AND deck_id=? AND ${nonceGuard}`).bind(cardId,owner,id,owner,r.id,r.nonce):
   env.DB.prepare(`UPDATE cards SET content_json=?,updated_at=? WHERE id=? AND owner_id=? AND deck_id=? AND ${nonceGuard}`).bind(JSON.stringify({id:cardId,position:existing.position,...card}),time,cardId,owner,id,owner,r.id,r.nonce)
 ]});
 if(remove||!card||await semanticHash(JSON.parse(existing.content_json))!==await semanticHash(card)||JSON.stringify((JSON.parse(existing.content_json).front||[]).filter(x=>x.type==='image'))!==JSON.stringify(card.front.filter(x=>x.type==='image'))||JSON.stringify((JSON.parse(existing.content_json).back||[]).filter(x=>x.type==='image'))!==JSON.stringify(card.back.filter(x=>x.type==='image'))) await invalidateCardBindings(env,owner,id,cardId);
 return resultWrite;
}
/** Read one exact, owner-scoped card without fetching a 1000-card deck. */
async function getCardContent(env,owner,args){
 const deckId=required(args.deckId,'deckId'),cardId=required(args.cardId,'cardId');
 const deck=await ownedDeck(env.DB,owner,deckId);
 const row=await env.DB.prepare('SELECT id,position,content_json,updated_at FROM cards WHERE id=? AND deck_id=? AND owner_id=?').bind(cardId,deckId,owner).first();
 if(!row)fail('Card not found',404);
 return {deckId,deckTitle:deck.title,deckRevision:deck.revision,card:{id:row.id,position:row.position,...JSON.parse(row.content_json)},cardUpdatedAt:row.updated_at};
}
function cardOutline(row){
 const c=JSON.parse(row.content_json);
 return {id:row.id,position:row.position,question:(c.front||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,280),answerPreview:(c.back||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,180),backPageCount:(c.backPages||[]).length,backPages:(c.backPages||[]).map(p=>({id:p.id,kind:p.kind,title:p.title,blockCount:p.blocks.length})),sourceStep:c.procedureStep?.order??null};
}
async function listCardContents(env,owner,args){
 const deckId=required(args.deckId,'deckId');const deck=await ownedDeck(env.DB,owner,deckId);
 const offset=Number.isInteger(args.offset)?args.offset:0,limit=Number.isInteger(args.limit)?args.limit:25;
 if(offset<0||offset>1000||limit<1||limit>100)fail('Invalid page range');
 const rows=(await env.DB.prepare('SELECT id,position,content_json FROM cards WHERE owner_id=? AND deck_id=? ORDER BY position LIMIT ? OFFSET ?').bind(owner,deckId,limit,offset).all()).results;
 const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id=? AND deck_id=?').bind(owner,deckId).first()).n;
 return {deckId,deckTitle:deck.title,deckRevision:deck.revision,total:count,offset,limit,nextOffset:offset+rows.length<count?offset+rows.length:null,cards:args.includeContent===true?rows.map(r=>({id:r.id,position:r.position,...JSON.parse(r.content_json)})):rows.map(cardOutline)};
}
async function searchCardContents(env,owner,args){
 const query=required(args.query,'query',120).toLocaleLowerCase(),limit=Number.isInteger(args.limit)?args.limit:30;
 if(limit<1||limit>50)fail('Invalid search limit');
 const deckId=args.deckId?required(args.deckId,'deckId'):null;
 if(deckId)await ownedDeck(env.DB,owner,deckId);
 const rows=(deckId?
  await env.DB.prepare('SELECT c.id,c.deck_id,c.position,c.content_json FROM cards c JOIN decks d ON d.id=c.deck_id AND d.owner_id=c.owner_id WHERE c.owner_id=? AND c.deck_id=? AND d.deleted_at IS NULL ORDER BY c.position LIMIT 1000').bind(owner,deckId).all():
  await env.DB.prepare('SELECT c.id,c.deck_id,c.position,c.content_json FROM cards c JOIN decks d ON d.id=c.deck_id AND d.owner_id=c.owner_id WHERE c.owner_id=? AND d.deleted_at IS NULL ORDER BY d.updated_at DESC,c.position LIMIT 5000').bind(owner).all()).results;
 const matches=[];
 for(const row of rows){
  const card=JSON.parse(row.content_json);
  const fields=[...(card.front||[]),...(card.back||[]),...(card.backPages||[]).flatMap(p=>[{type:'text',text:p.title},...p.blocks]),...(card.explanation?.sections||[]).flatMap(x=>x.blocks)].filter(b=>b.type==='text').map(b=>b.text);
  const match=fields.find(s=>s.toLocaleLowerCase().includes(query));
  if(match){const idx=match.toLocaleLowerCase().indexOf(query);matches.push({...cardOutline(row),deckId:row.deck_id,matchedText:match.slice(Math.max(0,idx-70),idx+query.length+120)});}
  if(matches.length>=limit)break;
 }
 return {query,matches,returned:matches.length,searchLimit:limit};
}
function applyCardEdits(existing,edits){
 if(!Array.isArray(edits)||!edits.length||edits.length>20)fail('Patch requires 1..20 targeted edits');
 const next=structuredClone(existing);
 for(const edit of edits){
  if(!edit||typeof edit!=='object'||typeof edit.op!=='string')fail('Invalid edit operation');
  switch(edit.op){
   case 'replace_front':next.front=edit.blocks;break;
   case 'replace_back':next.back=edit.blocks;break;
   case 'replace_explanation':if(edit.explanation===null)delete next.explanation;else next.explanation=edit.explanation;break;
   case 'replace_clues':next.clues=edit.clues;break;
   case 'replace_tags':next.tags=edit.tags;break;
   case 'replace_procedure_step':next.procedureStep=edit.procedureStep;break;
   case 'upsert_back_page':{
    const page=edit.page;const id=required(page?.id,'page.id',70);
    const pages=[...(next.backPages||[])],idx=pages.findIndex(p=>p.id===id);
    if(idx>=0)pages[idx]=page;else {
     const at=edit.atIndex===undefined?pages.length:edit.atIndex;
     if(!Number.isInteger(at)||at<0||at>pages.length)fail('Invalid new page position');pages.splice(at,0,page);
    }
    next.backPages=pages;break;
   }
   case 'remove_back_page':{
    const id=required(edit.pageId,'pageId',70),pages=[...(next.backPages||[])];
    const index=pages.findIndex(p=>p.id===id);if(index<0)fail('Back page not found');
    pages.splice(index,1);if(pages.length)next.backPages=pages;else delete next.backPages;break;
   }
   case 'reorder_back_pages':{
    const ids=edit.pageIds,pages=[...(next.backPages||[])];
    if(!Array.isArray(ids)||ids.length!==pages.length||new Set(ids).size!==ids.length||!pages.every(p=>ids.includes(p.id)))fail('Reordering must list every existing page ID exactly once');
    next.backPages=ids.map(id=>pages.find(p=>p.id===id));break;
   }
   case 'detach_images':{
    const target=edit.target;
    if(target==='front'||target==='back')next[target]=(next[target]||[]).filter(b=>b.type!=='image');
    else if(target==='all'){
     next.front=(next.front||[]).filter(b=>b.type!=='image');next.back=(next.back||[]).filter(b=>b.type!=='image');
     if(next.backPages)next.backPages=next.backPages.map(p=>({...p,blocks:p.blocks.filter(b=>b.type!=='image')}));
    }else if(target==='page'){
     const page=next.backPages?.find(p=>p.id===edit.pageId);if(!page)fail('Back page not found for detaching images');
     page.blocks=page.blocks.filter(b=>b.type!=='image');
    }else fail('Invalid image detach target');
    break;
   }
   default:fail('Unsupported patch action: '+edit.op);
  }
 }
 return next;
}
async function patchCardContent(env,owner,args){
 const deckId=required(args.deckId,'deckId'),cardId=required(args.cardId,'cardId'),opId=required(args.operationId,'operationId',120);
 const requestBytes=new TextEncoder().encode(JSON.stringify({deckId,cardId,expectedRevision:args.expectedRevision,edits:args.edits}));
 const requestHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',requestBytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const prior=await opReceipt(env.DB,owner,opId);
 if(prior){if(prior.requestHash!==requestHash)fail('Operation ID reused for a different edit',409);return prior;}
 const deck=await ownedDeck(env.DB,owner,deckId);
 if(deck.revision!==args.expectedRevision)fail('Revision changed; fetch card again before editing',409);
 const row=await env.DB.prepare('SELECT id,position,content_json FROM cards WHERE owner_id=? AND deck_id=? AND id=?').bind(owner,deckId,cardId).first();
 if(!row)fail('Card not found',404);
 const existing=JSON.parse(row.content_json);
 const candidate=applyCardEdits(existing,args.edits);
 const card=validateCard(candidate);
 if(Boolean(card.procedureStep)!==Boolean(existing.procedureStep))fail('Cannot change a procedure card into a normal card or vice versa');
 if(card.procedureStep?.order!==existing.procedureStep?.order)fail('Cannot change the order of a checklist step');
 await assertNoUnapprovedImages(env,owner,deckId,cardId,card);
 const changed=await semanticHash(existing)!==await semanticHash(card)||JSON.stringify(existing)!==JSON.stringify({...existing,...card});
 const result={deckId,cardId,revision:deck.revision+1,requestHash,edited:true,changedFields:[...new Set(args.edits.map(e=>e.op))],backPages:(card.backPages||[]).map(p=>({id:p.id,kind:p.kind,title:p.title}))};
 const time=now();const write=await uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,deckId,deck.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(time,deckId,owner,deck.revision,owner,r.id,r.nonce),
  env.DB.prepare(`UPDATE cards SET content_json=?,updated_at=? WHERE id=? AND deck_id=? AND owner_id=? AND ${nonceGuard}`).bind(JSON.stringify({id:cardId,position:row.position,...card}),time,cardId,deckId,owner,owner,r.id,r.nonce),
  ...(changed?[env.DB.prepare(`UPDATE visual_bindings SET status='stale',updated_at=? WHERE owner_id=? AND deck_id=? AND card_id=? AND status NOT IN ('stale','rejected') AND ${nonceGuard}`).bind(time,owner,deckId,cardId,owner,r.id,r.nonce)]:[])
 ]});
 return write;
}
async function renameDeck(env,owner,args){
 const id=required(args.deckId,'deckId'),opId=required(args.operationId,'operationId',120);const prior=await opReceipt(env.DB,owner,opId);if(prior)return prior;
 const row=await ownedDeck(env.DB,owner,id);if(row.revision!==args.expectedRevision)fail('Revision changed',409);
 const title=required(args.title,'title',120),description=typeof args.description==='string'?args.description.slice(0,400):row.description,time=now(),result={deckId:id,revision:row.revision+1};
 return uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,id,row.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET title=?,description=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(title,description,time,id,owner,row.revision,owner,r.id,r.nonce)
 ]});
}
async function deleteDeck(env,owner,args){
 const id=required(args.deckId,'deckId'),opId=required(args.operationId,'operationId',120);const prior=await opReceipt(env.DB,owner,opId);if(prior)return prior;
 const row=await ownedDeck(env.DB,owner,id);if(row.revision!==args.expectedRevision)fail('Revision changed',409);
 const time=now(),result={deckId:id,deleted:true,revision:row.revision+1};
 return uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,id,row.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET deleted_at=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(time,time,id,owner,row.revision,owner,r.id,r.nonce)
 ]});
}
async function recordReview(env,owner,args){
 const deckId=required(args.deckId,'deckId'),cardId=required(args.cardId,'cardId'),opId=required(args.operationId,'operationId',120);
 const prev=await opReceipt(env.DB,owner,opId);if(prev)return prev;
 await ownedDeck(env.DB,owner,deckId);
 const card=await env.DB.prepare('SELECT id FROM cards WHERE owner_id=? AND deck_id=? AND id=?').bind(owner,deckId,cardId).first();if(!card)fail('Card not found',404);
 const input=validateReview(args),time=now();const result={reviewId:opId,deckId,cardId,recorded:true};
 return uniqueWrite(env,owner,opId,result,{build:r=>[
  env.DB.prepare(`INSERT INTO reviews(id,owner_id,deck_id,card_id,rating,revealed,clues_json,elapsed_ms,timed_out,reviewed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${nonceGuard}`).bind(opId,owner,deckId,cardId,input.rating,Number(input.answerRevealed),JSON.stringify(input.cluesSeen),input.elapsedMs,Number(input.timedOut),time,owner,r.id,r.nonce)
 ]});
}
async function undoReview(env,owner,args){
 const id=required(args.reviewId,'reviewId'),opId=required(args.operationId,'operationId',120),prev=await opReceipt(env.DB,owner,opId);if(prev)return prev;
 const review=await env.DB.prepare('SELECT id,undone_at FROM reviews WHERE id=? AND owner_id=?').bind(id,owner).first();if(!review)fail('Review not found',404);
 const result={reviewId:id,undone:true};return uniqueWrite(env,owner,opId,result,{build:r=>[
  env.DB.prepare(`UPDATE reviews SET undone_at=COALESCE(undone_at,?) WHERE id=? AND owner_id=? AND ${nonceGuard}`).bind(now(),id,owner,owner,r.id,r.nonce)
 ]});
}
async function listDue(env,owner){
 const decks=await listDecks(env.DB,owner),reviews=await reviewHistory(env.DB,owner),rows=(await env.DB.prepare('SELECT id,deck_id,content_json FROM cards WHERE owner_id=? ORDER BY deck_id,position LIMIT 5000').bind(owner).all()).results;
 const valid=new Set(decks.map(d=>d.id));
 const cards=rows.filter(r=>valid.has(r.deck_id)).map(r=>({deckId:r.deck_id,cardId:r.id,...replayReviews(reviews,r.id),front:JSON.parse(r.content_json).front}));
 return {due:cards.filter(c=>c.due),total:cards.length};
}
// First-class MCP image ingestion: the bytes arrive inside this call, with no host file ID,
// download URL, transfer approval or ChatGPT-specific attachment handling.
// For larger files, begin_media_upload/upload_media_chunk/finish_media_upload is canonical.
async function importMediaBytes(env,owner,args){
 const opId=required(args.operationId,'operationId',120);
 const mime=required(args.mimeType,'mimeType',60);
 if(!['image/png','image/jpeg','image/webp'].includes(mime))fail('Only PNG, JPEG, and WebP are allowed');
 required(args.fileName,'fileName',250);
 const data=args.base64;
 if(typeof data!=='string'||data.length<32||data.length>4*Math.ceil(256*1024/3)||data.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))fail('Invalid base64 image; for larger images use begin_media_upload/upload_media_chunk/finish_media_upload');
 let binary;try{binary=atob(data);}catch{fail('Invalid base64 image')}
 if(binary.length>256*1024)fail('Direct MCP image limit is 256 KiB; use chunk tools for larger images');
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const identified=identifyImage(bytes);
 if(identified.mime!==mime)fail('Declared MIME does not match original image bytes');
 const source=validateProvenance(args.provenance);
 const currentSha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const previous=await opReceipt(env.DB,owner,opId);
 if(previous){
  if(previous.sha256!==currentSha||previous.mime!==mime||JSON.stringify(previous.provenance)!==JSON.stringify(source))fail('Operation ID already used with different image bytes or source',409);
  return previous;
 }
 const result=await storePendingImage(env,owner,bytes,source);
 try{await env.DB.prepare('INSERT INTO operations(owner_id,id,result_json,nonce,created_at) VALUES(?,?,?,?,?)').bind(owner,opId,JSON.stringify(result),uuid(),now()).run();}
 catch(err){const old=await opReceipt(env.DB,owner,opId);if(old)return old;throw err;}
 return result;
}
async function importMediaUrl(env,owner,args){
 const id=required(args.operationId,'operationId',120),prev=await opReceipt(env.DB,owner,id);if(prev)return prev;
 const provenance=validateProvenance(args.provenance),report=validateVisualReview(args.visualReview);
 if(provenance.kind!=='web')fail('External URLs require web provenance and permitted license');
 const url=required(args.url,'url',2000);
 const result=await fetchAllowedImage(url,env.ALLOWED_IMAGE_HOSTS);
 const saved=await storePendingImage(env,owner,result.bytes,{...provenance,imageUrl:url},report);
 try{await env.DB.prepare('INSERT INTO operations(owner_id,id,result_json,nonce,created_at) VALUES(?,?,?,?,?)').bind(owner,id,JSON.stringify(saved),uuid(),now()).run();}catch(err){const old=await opReceipt(env.DB,owner,id);if(old)return old;throw err;}
 return saved;
}
async function snapshot(env,owner){
 const decks=await listDecks(env.DB,owner);
 const all=await Promise.all(decks.map(d=>deckWithCards(env.DB,owner,d.id)));
 return {ownerId:owner,decks:all,folders:await listFolders(env.DB,owner),reviews:await reviewHistory(env.DB,owner),media:await listOwnerMedia(env,owner),visualBindings:await listVisualCandidates(env,owner)};
}
const schema={type:'string'},str=(description)=>({...schema,description});
const tool=(name,description,properties={},required=[],options={})=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!!options.readOnly,destructiveHint:!!options.destructive,idempotentHint:true},_meta:{ui:{visibility:options.appOnly?['app']:['model','app'],...(options.opens?{resourceUri:'ui://noodl-flashcards/workspace'}:{})},}});
const op={operationId:str('Unique idempotency key. Reuse only for exact retry.')},deckFields={deckId:str('Owned deck ID'),expectedRevision:{type:'integer',minimum:1}};
// Keep the actual server validation contract visible to every MCP tool client.
// The `type` alias is accepted for older callers, but new calls must prefer `kind`.
const provenanceSchema={
 type:'object',
 description:'Required image source. For a real picture from a PDF page use {kind:"slide",origin:"document.pdf",sourcePage:6}. Accepted kind: file, slide, web, generated, manual. Do NOT set kind:"pdf" or type:"pdf".',
 properties:{
  kind:{type:'string',enum:['file','slide','web','generated','manual'],description:'Canonical source category: slide for original slide/PDF page, file for an original local file, web for a licensed HTTPS image, generated for an AI-generated picture, manual for a user-supplied image.'},
  type:{type:'string',enum:['file','slide','web','generated','manual'],description:'Deprecated alias for kind; supported for backward compatibility only. Prefer kind.'},
  origin:{type:'string',minLength:1,maxLength:500,description:'Real original filename (e.g. SKILL_LAB_Atlas_Ilustrasi.pdf) or permitted HTTPS source URL. Never invent.'},
  sourcePage:{type:['integer','null'],minimum:1,maximum:10000,description:'Actual 1-based source PDF page / slide number when known; omit when unknown.'},
  license:{type:'string',maxLength:100,description:'For web sources, one of CC0, CC-BY, CC-BY-SA, PUBLIC_DOMAIN, EXPLICIT_PERMISSION; other source types may omit.'},
  licenseEvidenceUrl:{type:'string',maxLength:600,description:'For web sources, a real HTTPS URL with evidence of the license.'},
  imageUrl:{type:'string',maxLength:600},
  attribution:{type:'string',maxLength:300},
  description:{type:'string',maxLength:500}
 },
 required:['origin'],
 anyOf:[{required:['kind']},{required:['type']}],
 additionalProperties:true
};
export const TOOLS=[
 tool('get_capabilities','List supported flashcard creation, timer, clues, storage, automated image checks and media limits.',{},[],{readOnly:true}),
 tool('list_decks','List private flashcard decks for the current ChatGPT account.',{},[],{readOnly:true}),
 tool('list_folders','List the current account’s nested folders (including empty folders); deck contents are unchanged.',{},[],{readOnly:true}),
 tool('create_folder','Create a folder under a parent folder, or at root when parentId is omitted. Maximum six nesting levels.',{...op,name:schema,parentId:{type:['string','null']}},['operationId','name']),
 tool('rename_folder','Rename one folder with revision protection; cards and decks remain intact.',{...op,folderId:schema,expectedRevision:{type:'integer',minimum:1},name:schema},['operationId','folderId','expectedRevision','name']),
 tool('move_folder','Move a folder to root or another folder; rejects cycles and excessive nesting.',{...op,folderId:schema,expectedRevision:{type:'integer',minimum:1},parentId:{type:['string','null']}},['operationId','folderId','expectedRevision']),
 tool('delete_folder','Delete the folder shell only. Moves child folders and decks to its parent; never deletes cards or study history.',{...op,folderId:schema,expectedRevision:{type:'integer',minimum:1}},['operationId','folderId','expectedRevision'],{destructive:true}),
 tool('move_deck_to_folder','Move an existing deck to a selected folder or root without changing cards or review history.',{...op,...deckFields,folderId:{type:['string','null']}},['operationId','deckId','expectedRevision']),
 tool('get_deck','Read full flashcard deck including all cards and source references.',{deckId:schema},['deckId'],{readOnly:true}),
 tool('list_card_contents','Read an ordered, paginated deck outline or full card contents. Safe for long Deep Cards and 1000-card decks.',{deckId:schema,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},includeContent:{type:'boolean'}},['deckId'],{readOnly:true}),
 tool('get_card_content','Read exactly one card, all deep back pages, sources, content, and current deck revision.',{deckId:schema,cardId:schema},['deckId','cardId'],{readOnly:true}),
 tool('search_card_contents','Search owned card text, front/back, deep pages, and explanation without needing card IDs.',{query:schema,deckId:schema,limit:{type:'integer',minimum:1,maximum:50}},['query'],{readOnly:true}),
 tool('patch_card_content','Modify only requested card fields or specific Deep Card pages, preserve other contents and review IDs. Read get_card_content first and pass its deckRevision as expectedRevision. Never directly insert image blocks; use two-stage visual validation.',{...op,...deckFields,cardId:schema,edits:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:true}}},['operationId','deckId','expectedRevision','cardId','edits'],{destructive:true}),
 tool('create_deck','Create a deck with 1..100 flashcards, optionally inside folderId. For normal cards write three clues. Use back for the concise answer, optional explanation.sections[] for long explanations (each section has heading and blocks). Legacy long back text remains fully readable via the reader. For an OSCE checklist supply ordered procedureStep metadata on ALL cards; clues may be empty. Images must be attached with two source/pixel check reports; no human approval.',{...op,title:schema,description:schema,folderId:{type:['string','null']},cards:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:true}}},['operationId','title','cards'],{opens:true}),
 tool('append_cards','Append 1..100 validated cards in sequence; OSCE procedure steps must continue at the next position without gaps.',{...op,...deckFields,cards:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:true}}},['operationId','deckId','expectedRevision','cards']),
 tool('update_card','Replace a card using the latest deck revision; optional explanation.sections add long-form material without truncating back.',{...op,...deckFields,cardId:schema,card:{type:'object',additionalProperties:true}},['operationId','deckId','expectedRevision','cardId','card'],{destructive:true}),
 tool('delete_card','Delete a card. A deck must keep at least one card.',{...op,...deckFields,cardId:schema},['operationId','deckId','expectedRevision','cardId'],{destructive:true}),
 tool('rename_deck','Change title/description without overwriting cards.',{...op,...deckFields,title:schema,description:schema},['operationId','deckId','expectedRevision','title']),
 tool('delete_deck','Soft-delete one deck. Does not delete other decks or unrelated media.',{...op,...deckFields},['operationId','deckId','expectedRevision'],{destructive:true}),
 tool('open_deck','Show interactive flashcard player inside ChatGPT.',{deckId:schema},['deckId'],{readOnly:true,opens:true}),
 tool('list_due_cards','Get real SRS due cards and next-review details.',{},[],{readOnly:true}),
 tool('record_review','Save explicit self-reported card rating; pre-reveal swipes are NOT evidence of correct answers.',{...op,deckId:schema,cardId:schema,rating:{type:'integer',minimum:0,maximum:3},answerRevealed:{type:'boolean'},cluesSeen:{type:'array',items:{type:'integer'}},elapsedMs:{type:'integer'},timedOut:{type:'boolean'}},['operationId','deckId','cardId','rating','answerRevealed','cluesSeen','elapsedMs','timedOut']),
 tool('undo_review','Undo an existing review event without deleting historical evidence.',{...op,reviewId:schema},['operationId','reviewId'],{destructive:true}),
 tool('import_media_bytes','Import actual PNG/JPEG/WebP image bytes as Base64 directly through MCP, without host transfer, file_id, approval or URL. One call up to 256 KiB; use the three chunk tools for bigger images.',{...op,base64:schema,mimeType:schema,fileName:schema,provenance:provenanceSchema},['operationId','base64','mimeType','fileName','provenance']),
 tool('import_media_url','Import from allowed HTTPS host with license and source metadata. No manual approval, but per-card two-stage validation is required.',{...op,url:schema,provenance:provenanceSchema,visualReview:{type:'object',additionalProperties:true}},['operationId','url','provenance','visualReview']),
 tool('list_media','List account media, stored-byte integrity and source information.',{},[],{readOnly:true}),
 tool('begin_media_upload','Begin direct, host-independent MCP transfer of real image bytes. Canonical upload for files over 256 KiB; maximum 4 MB.',{byteLength:{type:'integer',minimum:24,maximum:4000000},mimeType:schema,fileName:schema,provenance:provenanceSchema},['byteLength','mimeType','fileName','provenance']),
 tool('upload_media_chunk','Upload an ordered base64 chunk from the REAL image bytes (up to 96 KiB per chunk). Do not invent or reconstruct file bytes.',{uploadId:schema,index:{type:'integer',minimum:0},base64:schema},['uploadId','index','base64']),
 tool('finish_media_upload','Verify chunk total, MIME signature, image dimensions; persist media, no approval form.',{uploadId:schema},['uploadId']),
 tool('app_begin_media_upload','Start direct image transfer over the Noodl MCP channel; host file APIs are not used.',{byteLength:{type:'integer',minimum:24,maximum:4000000},mimeType:schema,fileName:schema,provenance:provenanceSchema},['byteLength','mimeType','fileName','provenance'],{appOnly:true}),
 tool('app_upload_media_chunk','Receive one ordered 96 KiB base64 image chunk from the embedded Noodl UI, not from model text.',{uploadId:schema,index:{type:'integer',minimum:0},base64:schema},['uploadId','index','base64'],{appOnly:true}),
 tool('app_finish_media_upload','Assemble and validate the complete image, then store without manual approval.',{uploadId:schema},['uploadId'],{appOnly:true}),
 tool('app_get_media_chunk','Fallback: read a private image from R2 in safe sized chunks for embedded card/preview rendering.',{mediaId:schema,index:{type:'integer',minimum:0}},['mediaId','index'],{appOnly:true,readOnly:true}),
 tool('create_visual_candidate','Start card-specific source+visual validation for a stored image. Optionally set pageId for Deep Card back page. No user approval step.',{deckId:schema,cardId:schema,mediaId:schema,side:{type:'string',enum:['front','back']},pageId:schema},['deckId','cardId','mediaId']),
 tool('submit_source_check','Check A: record concrete slide/source observations. This is a model claim, not scientific certification.',{bindingId:schema,report:{type:'object',additionalProperties:true}},['bindingId','report']),
 tool('submit_visual_check','Check B: inspect the final stored image pixels and compare to exact card answer. Requires check A.',{bindingId:schema,report:{type:'object',additionalProperties:true}},['bindingId','report']),
 tool('list_visual_candidates','List card-specific visual validation states for this account.',{},[],{readOnly:true}),
 tool('get_card_visual_audit','Read both card-specific model inspection reports and hashes.',{bindingId:schema},['bindingId'],{readOnly:true}),
 tool('accept_legacy_media','Validate R2 bytes and move old pending media to storage-ready state (does not certify visual relevance).',{mediaId:schema},['mediaId']),
 tool('inspect_media_image','Return the actual stored image as MCP image content for visual inspection before source/check reports.',{mediaId:schema},['mediaId'],{readOnly:true}),
 tool('attach_verified_visuals_batch','Attach up to 40 card-bound images after two model review reports per image; partial failures reported, existing cards/reviews preserved. DO NOT submit reports without inspecting the actual stored pixels. No human approval click.',{...op,items:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:true}}},['operationId','items']),
 tool('attach_visual_to_card','Attach after source and final stored-image checks pass. Card revision and hashes must match; no human approval click.',{...op,bindingId:schema,expectedRevision:{type:'integer',minimum:1}},['operationId','bindingId','expectedRevision']),
 tool('app_snapshot','Embedded UI reads private decks and review events.',{},[],{readOnly:true,appOnly:true}),
 tool('app_reject_media','Embedded UI rejects/quarantines a bad image; removes object storage bytes.',{mediaId:schema},['mediaId'],{appOnly:true,destructive:true})
];
export async function callTool(name,env,owner,args={}){
 switch(name){
  case 'get_capabilities':return {version:'0.10.1',procedureDecks:{ordered:true,cardLevelSource:true,untimed:true,unhintedSequenceRecall:true,separateQuizEngine:false},folders:{nested:true,maximumDepth:6,safeDelete:true,mcpTools:true},layeredCards:{fullScroll:true,explanationSections:true,readerPanel:true,legacyBackPreserved:true},deepCards:{backPages:true,maximumExtraPages:12,backSwipeNavigates:true,visualValidationPerPage:true},mcpContentEditing:{getCard:true,paginatedDeck:true,search:true,patch:true,revisionGuarded:true},content:'flashcards only',aiProviderCalls:false,imageTypes:['image/png','image/jpeg','image/webp'],maxImageBytes:4_000_000,mediaApproval:'none_automated_integrity_and_two_model_reports',mediaIngest:'direct_mcp_bytes_or_chunks',requiresHostTransferredFileId:false,manualApprovalRequired:false,chunkBytes:98304,preRevealSwipe:true,timerSeconds:20,clueSeconds:[5,10,15],decks:true};
  case 'list_decks':return {decks:await listDecks(env.DB,owner)};
  case 'list_folders':return {folders:await listFolders(env.DB,owner)};
  case 'create_folder':return await createFolder(env,owner,args);
  case 'rename_folder':return await renameFolder(env,owner,args);
  case 'move_folder':return await moveFolder(env,owner,args);
  case 'delete_folder':return await deleteFolder(env,owner,args);
  case 'move_deck_to_folder':return await moveDeckToFolder(env,owner,args);
  case 'get_deck':return await deckWithCards(env.DB,owner,required(args.deckId,'deckId'));
  case 'list_card_contents':return await listCardContents(env,owner,args);
  case 'get_card_content':return await getCardContent(env,owner,args);
  case 'search_card_contents':return await searchCardContents(env,owner,args);
  case 'patch_card_content':return await patchCardContent(env,owner,args);
  case 'create_deck':return await createDeck(env,owner,args);
  case 'append_cards':return await appendCards(env,owner,args);
  case 'update_card':return await editCard(env,owner,args);
  case 'delete_card':return await editCard(env,owner,args,true);
  case 'rename_deck':return await renameDeck(env,owner,args);
  case 'delete_deck':return await deleteDeck(env,owner,args);
  case 'open_deck':await ownedDeck(env.DB,owner,required(args.deckId,'deckId'));return {view:'deck',deckId:args.deckId};
  case 'list_due_cards':return await listDue(env,owner);
  case 'record_review':return await recordReview(env,owner,args);
  case 'undo_review':return await undoReview(env,owner,args);
  case 'import_media_bytes':return await importMediaBytes(env,owner,args);
  case 'import_media_url':return await importMediaUrl(env,owner,args);
  case 'list_media':return {media:await listOwnerMedia(env,owner)};
  case 'accept_legacy_media':return await acceptPendingMediaIntegrity(env,owner,required(args.mediaId,'mediaId'));
  case 'attach_verified_visuals_batch':return await attachVerifiedVisualsBatch(env,owner,args);
  case 'begin_media_upload':
  case 'app_begin_media_upload':return await beginChunkedUpload(env,owner,args);
  case 'upload_media_chunk':
  case 'app_upload_media_chunk':return await appendChunkedUpload(env,owner,args);
  case 'finish_media_upload':
  case 'app_finish_media_upload':return await finishChunkedUpload(env,owner,args);
  case 'app_get_media_chunk':return await readOwnerMediaChunk(env,owner,required(args.mediaId,'mediaId'),args.index);
  case 'app_purge_expired_media_uploads':return await purgeExpiredUploads(env,owner);
  case 'create_visual_candidate':return await createCandidate(env,owner,args);
  case 'submit_source_check':return await submitSourceCheck(env,owner,args);
  case 'submit_visual_check':return await submitVisualCheck(env,owner,args);
  case 'list_visual_candidates':return {visualBindings:await listVisualCandidates(env,owner)};
  case 'get_card_visual_audit':return await inspectVisualBinding(env,owner,required(args.bindingId,'bindingId'));
  case 'attach_visual_to_card':return await attachCardVisual(env,owner,args);
  case 'app_snapshot':return await snapshot(env,owner);
  case 'app_reject_media':return await rejectOwnerMedia(env,owner,args.mediaId);
  default:fail(`Unknown tool ${name}`,404);
 }
}
export async function attachVerifiedVisualsBatch(env,owner,args){
 const batchId=required(args.operationId,'operationId',98);
 if(!Array.isArray(args.items)||args.items.length<1||args.items.length>40)fail('Batch needs 1..40 image/card mappings');
 const results=[];
 for(let i=0;i<args.items.length;i++){
  const item=args.items[i]||{};
  const record={index:i,deckId:item.deckId,cardId:item.cardId,mediaId:item.mediaId};
  try{
   const deckId=required(item.deckId,'deckId'),cardId=required(item.cardId,'cardId'),mediaId=required(item.mediaId,'mediaId');
   if(item.side && !['front','back'].includes(item.side))fail('Invalid side');
   if(item.pageId && typeof item.pageId!=='string')fail('Invalid pageId');
   // Retry is safe: skip an existing attached exact target, but never silently attach to a new location.
   const attached=await env.DB.prepare("SELECT id FROM visual_bindings WHERE owner_id=? AND deck_id=? AND card_id=? AND media_id=? AND side=? AND COALESCE(page_id,'')=? AND status='attached'")
    .bind(owner,deckId,cardId,mediaId,item.side||'back',item.pageId||'').first();
   if(attached){results.push({...record,ok:true,alreadyAttached:true,bindingId:attached.id});continue;}
   if(!item.sourceReport||!item.visualReport)fail('Two substantive inspection reports are required');
   await acceptPendingMediaIntegrity(env,owner,mediaId);
   const binding=await createCandidate(env,owner,{deckId,cardId,mediaId,side:item.side||'back',...(item.pageId?{pageId:item.pageId}:{})});
   await submitSourceCheck(env,owner,{bindingId:binding.bindingId,report:item.sourceReport});
   await submitVisualCheck(env,owner,{bindingId:binding.bindingId,report:item.visualReport});
   const current=await ownedDeck(env.DB,owner,deckId);
   const attachedResult=await attachCardVisual(env,owner,{bindingId:binding.bindingId,expectedRevision:current.revision,operationId:`${batchId}-${String(i).padStart(2,'0')}`});
   results.push({...record,ok:true,...attachedResult});
  }catch(e){results.push({...record,ok:false,error:String(e.message||e)});}
 }
 return {requested:args.items.length,attached:results.filter(r=>r.ok&&!r.alreadyAttached).length,alreadyAttached:results.filter(r=>r.alreadyAttached).length,failed:results.filter(r=>!r.ok).length,results};
}

function resultSuccess(data){return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
function resultError(error){return {isError:true,content:[{type:'text',text:String(error?.message||error)}]};}
export async function handleMcp(req,env){
 const owner=identity(req,env),rpc=await parseBody(req);
 if(!rpc||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')fail('Invalid MCP JSON-RPC');
 const id=rpc.id??null;let result;
 switch(rpc.method){
  case 'server/discover':result={supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}}};break;
  case 'initialize':result={protocolVersion:'2025-11-25',capabilities:{tools:{},resources:{}},serverInfo:{name:'noodl-flashcards',version:'0.10.1'}};break;
  case 'notifications/initialized':return new Response(null,{status:202});
  case 'ping':result={};break;
  case 'tools/list':result={tools:TOOLS};break;
  case 'resources/list':result={resources:[{uri:'ui://noodl-flashcards/workspace',name:'Noodl Flashcards',mimeType:'text/html;profile=mcp-app'}]};break;
  case 'resources/read':{
   if(rpc.params?.uri!=='ui://noodl-flashcards/workspace')fail('Unknown resource',404);
   if(!env.ASSETS)fail('Assets binding missing',503);
   const url=new URL(req.url),html=await (await env.ASSETS.fetch(new Request(new URL('/index.html',url)))).text();
   result={contents:[{uri:rpc.params.uri,mimeType:'text/html;profile=mcp-app',text:html.replace('<head>','<head><base href="'+url.origin+'/">'),_meta:{ui:{csp:{connectDomains:[url.origin],resourceDomains:[url.origin],frameDomains:["https://www.youtube-nocookie.com","https://player.vimeo.com"]}},'openai/ui':{availableDisplayModes:['fullscreen','inline'],preferredDisplayMode:'fullscreen'}}}]};break;
  }
  case 'tools/call':{
   const name=rpc.params?.name;
   if(!TOOLS.some(t=>t.name===name))result=resultError(new Error('Tool not found'));
   else {try{if(name==='inspect_media_image'){const img=await readMediaForModel(env,owner,required(rpc.params?.arguments?.mediaId,'mediaId'));const {base64,...meta}=img;result={content:[{type:'image',data:base64,mimeType:img.mime},{type:'text',text:JSON.stringify(meta)}],structuredContent:meta};}else result=resultSuccess(await callTool(name,env,owner,rpc.params?.arguments||{}));}catch(e){result=resultError(e);}}
   break;
  }
  default:return replyJson({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}},200);
 }
 if(id===null)return new Response(null,{status:202});
 return replyJson({jsonrpc:'2.0',id,result});
}
export async function handleApi(req,env){
 const owner=identity(req,env),url=new URL(req.url),path=url.pathname;
 if(!env.DB)fail('D1 binding missing',503);
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
  const origin=req.headers.get('origin');if(origin&&origin!==url.origin)fail('Invalid origin',403);
 }
 if(req.method==='GET'&&path==='/api/snapshot')return replyJson(await snapshot(env,owner));
 if(req.method==='GET'&&path==='/api/folders')return replyJson({folders:await listFolders(env.DB,owner)});
 if(req.method==='POST'&&path==='/api/folders')return replyJson(await createFolder(env,owner,await parseBody(req)),201);
 if(req.method==='POST'&&path==='/api/folders/rename')return replyJson(await renameFolder(env,owner,await parseBody(req)));
 if(req.method==='POST'&&path==='/api/folders/move')return replyJson(await moveFolder(env,owner,await parseBody(req)));
 if(req.method==='POST'&&path==='/api/folders/delete')return replyJson(await deleteFolder(env,owner,await parseBody(req)));
 if(req.method==='POST'&&path==='/api/folders/move-deck')return replyJson(await moveDeckToFolder(env,owner,await parseBody(req)));
 if(req.method==='GET'&&path==='/api/media')return replyJson({media:await listOwnerMedia(env,owner)});
  if(req.method==='GET'&&path==='/api/visual')return replyJson({visualBindings:await listVisualCandidates(env,owner)});
  if(req.method==='POST'&&path==='/api/visual/candidates')return replyJson(await createCandidate(env,owner,await parseBody(req)),201);
  const visualPath=path.match(/^\/api\/visual\/([a-f0-9-]{36})(?:\/(audit|challenge|approve|attach))?$/i);
  if(visualPath){
   const bindingId=visualPath[1],verb=visualPath[2];
   if(req.method==='GET'&&verb==='audit')return replyJson(await inspectVisualBinding(env,owner,bindingId));
     if(req.method==='POST'&&verb==='attach')return replyJson(await attachCardVisual(env,owner,{...await parseBody(req),bindingId}));
  }
 const m=path.match(/^\/api\/media\/([a-f0-9-]{36})(?:\/(approve|reject|challenge))?$/i);
 if(m){
  if(req.method==='GET'&&!m[2])return serveOwnerMedia(env,owner,m[1]);
  if(req.method==='POST'&&m[2]==='reject')return replyJson(await rejectOwnerMedia(env,owner,m[1]));
 }
 if(req.method==='POST'&&path==='/api/media/upload'){
  const type=req.headers.get('content-type')||'';if(!type.startsWith('multipart/form-data'))fail('Expected multipart form',415);
  const len=Number(req.headers.get('content-length')||0);if(len>4_200_000)fail('Upload too big',413);
  const data=await req.formData(),file=data.get('file');if(!(file instanceof File)||file.size>4_000_000)fail('Invalid image file',400);
  const provenance=JSON.parse(String(data.get('provenance')||'{}'));
  const image=new Uint8Array(await file.arrayBuffer());
  return replyJson(await storePendingImage(env,owner,image,provenance),201);
 }
 if(req.method==='POST'&&path==='/api/review')return replyJson(await recordReview(env,owner,await parseBody(req)));
 if(req.method==='POST'&&path==='/api/review/undo')return replyJson(await undoReview(env,owner,await parseBody(req)));
 return replyJson({error:'Not found'},404);
}
export default {
 async fetch(req,env,ctx){
  const url=new URL(req.url);
  try{
   if(url.pathname==='/mcp'){
    if(req.method!=='POST')return replyJson({error:'POST required'},405);
    return await handleMcp(req,env);
   }
   if(url.pathname.startsWith('/api/'))return await handleApi(req,env);
   if(env.ASSETS)return env.ASSETS.fetch(req);
   return replyJson({error:'Static assets not deployed'},404);
  }catch(e){return replyJson({error:e.message||'Request failed'},e.status||400);}
 }
};
