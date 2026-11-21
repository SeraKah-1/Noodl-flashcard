import {validateCard,validateDeckInput,validateReview,validateProvenance,validateVisualReview} from './validation.js';
import {assertAllApprovedMedia,storePendingImage,fetchAllowedImage,getOwnerMedia,mediaSummary,listOwnerMedia,serveOwnerMedia,approveOwnerMedia,rejectOwnerMedia,issueMediaReviewChallenge,identifyImage} from './media.js';
import {replayReviews} from '../shared/logic.js';
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
async function deckWithCards(db,owner,id){const row=await ownedDeck(db,owner,id);const cards=(await db.prepare('SELECT id,position,content_json FROM cards WHERE owner_id=? AND deck_id=? ORDER BY position').bind(owner,id).all()).results.map(x=>({id:x.id,position:x.position,...JSON.parse(x.content_json)}));return {id:row.id,title:row.title,description:row.description,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,cards};}
async function listDecks(db,owner){return (await db.prepare('SELECT id,title,description,revision,created_at,updated_at,(SELECT COUNT(*) FROM cards WHERE cards.deck_id=decks.id AND cards.owner_id=?) AS cardCount FROM decks WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200').bind(owner,owner).all()).results.map(row=>({id:row.id,title:row.title,description:row.description,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,cardCount:row.cardCount}));}
async function reviewHistory(db,owner){return (await db.prepare('SELECT * FROM reviews WHERE owner_id=? ORDER BY reviewed_at ASC LIMIT 5000').bind(owner).all()).results.map(r=>({id:r.id,deckId:r.deck_id,cardId:r.card_id,rating:r.rating,answerRevealed:!!r.revealed,cluesSeen:JSON.parse(r.clues_json),elapsedMs:r.elapsed_ms,timedOut:!!r.timed_out,reviewedAt:r.reviewed_at,undoneAt:r.undone_at}));}
async function createDeck(env,owner,args){
 const opId=required(args.operationId,'operationId',120);
 const prior=await opReceipt(env.DB,owner,opId);if(prior)return prior;
 const input=validateDeckInput(args),id=uuid(),cards=input.cards.map((c,i)=>({id:uuid(),position:i,...c})),time=now();
 await assertAllApprovedMedia(env,owner,cards);
 const result={deckId:id,revision:1,cardCount:cards.length,createdAt:time};
 return uniqueWrite(env,owner,opId,result,{build:r=>[
  env.DB.prepare(`INSERT INTO decks(id,owner_id,title,description,revision,created_at,updated_at) SELECT ?,?,?,?,1,?,? WHERE ${nonceGuard}`).bind(id,owner,input.title,input.description,time,time,owner,r.id,r.nonce),
  ...cards.map(c=>env.DB.prepare(`INSERT INTO cards(id,owner_id,deck_id,position,content_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${nonceGuard}`).bind(c.id,owner,id,c.position,JSON.stringify(c),time,time,owner,r.id,r.nonce))
 ]});
}
async function appendCards(env,owner,args){
 const id=required(args.deckId,'deckId'),opId=required(args.operationId,'operationId',120);
 const prev=await opReceipt(env.DB,owner,opId);if(prev)return prev;
 const row=await ownedDeck(env.DB,owner,id);
 if(row.revision!==args.expectedRevision)fail('Revision changed',409);
 if(!Array.isArray(args.cards)||args.cards.length<1||args.cards.length>100)fail('Append requires 1..100 cards');
 const cards=args.cards.map(validateCard);await assertAllApprovedMedia(env,owner,cards);
 const oldCount=(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id=? AND deck_id=?').bind(owner,id).first()).n;
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
 const existing=await env.DB.prepare('SELECT id,position FROM cards WHERE id=? AND owner_id=? AND deck_id=?').bind(cardId,owner,id).first();if(!existing)fail('Card not found',404);
 if(remove){const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards WHERE owner_id=? AND deck_id=?').bind(owner,id).first()).n;if(count<=1)fail('Deck must keep at least one card');}
 const card=remove?null:validateCard(args.card);if(card)await assertAllApprovedMedia(env,owner,[card]);
 const time=now(),result={deckId:id,cardId,revision:row.revision+1,deleted:remove};
 return uniqueWrite(env,owner,opId,result,{condition:[`WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)`,[owner,id,row.revision]],build:r=>[
  env.DB.prepare(`UPDATE decks SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${nonceGuard}`).bind(time,id,owner,row.revision,owner,r.id,r.nonce),
  remove?env.DB.prepare(`DELETE FROM cards WHERE id=? AND owner_id=? AND deck_id=? AND ${nonceGuard}`).bind(cardId,owner,id,owner,r.id,r.nonce):
   env.DB.prepare(`UPDATE cards SET content_json=?,updated_at=? WHERE id=? AND owner_id=? AND deck_id=? AND ${nonceGuard}`).bind(JSON.stringify({id:cardId,position:existing.position,...card}),time,cardId,owner,id,owner,r.id,r.nonce)
 ]});
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
async function importMediaFile(env,owner,args){
 const id=required(args.operationId,'operationId',120),prev=await opReceipt(env.DB,owner,id);if(prev)return prev;
 const file=args.file;if(!file||typeof file!=='object'||!/^file_[A-Za-z0-9_-]+$/.test(file.file_id))fail('A host-transferred file_id is required');
 const provenance=validateProvenance(args.provenance),report=validateVisualReview(args.visualReview);
 const result=await fetchAllowedImage(file.download_url,env.ALLOWED_TRANSFER_HOSTS);
 const saved=await storePendingImage(env,owner,result.bytes,provenance,report);
 // Store receipt. Image remains pending until separately approved in real preview UI.
 try{await env.DB.prepare('INSERT INTO operations(owner_id,id,result_json,nonce,created_at) VALUES(?,?,?,?,?)').bind(owner,id,JSON.stringify(saved),uuid(),now()).run();}catch(err){const old=await opReceipt(env.DB,owner,id);if(old)return old;throw err;}
 return saved;
}
async function importMediaUrl(env,owner,args){
 const id=required(args.operationId,'operationId',120),prev=await opReceipt(env.DB,owner,id);if(prev)return prev;
 const provenance=validateProvenance(args.provenance),report=validateVisualReview(args.visualReview);
 if(provenance.kind!=='web')fail('External URLs require web provenance and permitted license');
 const url=required(args.url,'url',2000);if(new URL(url).hostname!==new URL(provenance.origin).hostname)fail('Provenance source host differs from image host');
 const result=await fetchAllowedImage(url,env.ALLOWED_IMAGE_HOSTS);
 const saved=await storePendingImage(env,owner,result.bytes,provenance,report);
 try{await env.DB.prepare('INSERT INTO operations(owner_id,id,result_json,nonce,created_at) VALUES(?,?,?,?,?)').bind(owner,id,JSON.stringify(saved),uuid(),now()).run();}catch(err){const old=await opReceipt(env.DB,owner,id);if(old)return old;throw err;}
 return saved;
}
async function snapshot(env,owner){
 const decks=await listDecks(env.DB,owner);
 const all=await Promise.all(decks.map(d=>deckWithCards(env.DB,owner,d.id)));
 return {ownerId:owner,decks:all,reviews:await reviewHistory(env.DB,owner),media:await listOwnerMedia(env,owner)};
}
const schema={type:'string'},str=(description)=>({...schema,description});
const tool=(name,description,properties={},required=[],options={})=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!!options.readOnly,destructiveHint:!!options.destructive,idempotentHint:true},_meta:{ui:{visibility:options.appOnly?['app']:['model','app'],...(options.opens?{resourceUri:'ui://noodl-flashcards/workspace'}:{})},...(options.fileParam?{'openai/fileParams':['file']}:{})}});
const op={operationId:str('Unique idempotency key. Reuse only for exact retry.')},deckFields={deckId:str('Owned deck ID'),expectedRevision:{type:'integer',minimum:1}};
const imageFileSchema={type:'object',properties:{download_url:schema,file_id:schema,mime_type:schema,file_name:schema},required:['download_url','file_id'],additionalProperties:false};
export const TOOLS=[
 tool('get_capabilities','List supported flashcard creation, timer, clues, storage, image-review and media limits.',{},[],{readOnly:true}),
 tool('list_decks','List private flashcard decks for the current ChatGPT account.',{},[],{readOnly:true}),
 tool('get_deck','Read full flashcard deck including all cards and source references.',{deckId:schema},['deckId'],{readOnly:true}),
 tool('create_deck','Create a deck with 1..100 flashcards. ChatGPT writes three progressive clues for every card. Images must already be APPROVED.',{...op,title:schema,description:schema,cards:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:true}}},['operationId','title','cards'],{opens:true}),
 tool('append_cards','Append 1..100 validated cards; the current deck revision is required.',{...op,...deckFields,cards:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:true}}},['operationId','deckId','expectedRevision','cards']),
 tool('update_card','Replace a card using the latest deck revision.',{...op,...deckFields,cardId:schema,card:{type:'object',additionalProperties:true}},['operationId','deckId','expectedRevision','cardId','card'],{destructive:true}),
 tool('delete_card','Delete a card. A deck must keep at least one card.',{...op,...deckFields,cardId:schema},['operationId','deckId','expectedRevision','cardId'],{destructive:true}),
 tool('rename_deck','Change title/description without overwriting cards.',{...op,...deckFields,title:schema,description:schema},['operationId','deckId','expectedRevision','title']),
 tool('delete_deck','Soft-delete one deck. Does not delete other decks or unrelated media.',{...op,...deckFields},['operationId','deckId','expectedRevision'],{destructive:true}),
 tool('open_deck','Show interactive flashcard player inside ChatGPT.',{deckId:schema},['deckId'],{readOnly:true,opens:true}),
 tool('list_due_cards','Get real SRS due cards and next-review details.',{},[],{readOnly:true}),
 tool('record_review','Save explicit self-reported card rating; pre-reveal swipes are NOT evidence of correct answers.',{...op,deckId:schema,cardId:schema,rating:{type:'integer',minimum:0,maximum:3},answerRevealed:{type:'boolean'},cluesSeen:{type:'array',items:{type:'integer'}},elapsedMs:{type:'integer'},timedOut:{type:'boolean'}},['operationId','deckId','cardId','rating','answerRevealed','cluesSeen','elapsedMs','timedOut']),
 tool('undo_review','Undo an existing review event without deleting historical evidence.',{...op,reviewId:schema},['operationId','reviewId'],{destructive:true}),
 tool('import_media_file','Transfer an actual image file from ChatGPT. The image is quarantined until visual preview and account-user approval. For slides/PDF ChatGPT must FIRST extract a real PNG/JPEG/WebP crop and inspect it.',{...op,file:imageFileSchema,provenance:{type:'object',additionalProperties:true},visualReview:{type:'object',additionalProperties:true}},['operationId','file','provenance','visualReview'],{fileParam:true}),
 tool('import_media_url','Import an image only from an explicitly allowlisted HTTPS host, with reusable license and source metadata; review required before attaching.',{...op,url:schema,provenance:{type:'object',additionalProperties:true},visualReview:{type:'object',additionalProperties:true}},['operationId','url','provenance','visualReview']),
 tool('list_media','List current user media, including whether approved or pending.',{},[],{readOnly:true}),
 tool('app_snapshot','Embedded UI reads private decks and review events.',{},[],{readOnly:true,appOnly:true}),
 tool('app_begin_media_review','Get short-lived preview challenge for a pending image; only call from the visible media preview after image.decode().',{mediaId:schema},['mediaId'],{appOnly:true,readOnly:true}),
 tool('app_approve_media','Embedded UI action AFTER full-size image loads and all human visual checks are checked.',{mediaId:schema,attestation:{type:'object',additionalProperties:true}},['mediaId','attestation'],{appOnly:true}),
 tool('app_reject_media','Embedded UI rejects/quarantines a bad image; removes object storage bytes.',{mediaId:schema},['mediaId'],{appOnly:true,destructive:true})
];
export async function callTool(name,env,owner,args={}){
 switch(name){
  case 'get_capabilities':return {version:'0.1.0',content:'flashcards only',aiProviderCalls:false,imageTypes:['image/png','image/jpeg','image/webp'],maxImageBytes:4_000_000,mediaApproval:'human_preview_required',preRevealSwipe:true,timerSeconds:20,clueSeconds:[5,10,15],decks:true};
  case 'list_decks':return {decks:await listDecks(env.DB,owner)};
  case 'get_deck':return await deckWithCards(env.DB,owner,required(args.deckId,'deckId'));
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
  case 'import_media_file':return await importMediaFile(env,owner,args);
  case 'import_media_url':return await importMediaUrl(env,owner,args);
  case 'list_media':return {media:await listOwnerMedia(env,owner)};
  case 'app_snapshot':return await snapshot(env,owner);
  case 'app_begin_media_review':return await issueMediaReviewChallenge(env,owner,args.mediaId);
  case 'app_approve_media':return await approveOwnerMedia(env,owner,args.mediaId,args.attestation);
  case 'app_reject_media':return await rejectOwnerMedia(env,owner,args.mediaId);
  default:fail(`Unknown tool ${name}`,404);
 }
}
function resultSuccess(data){return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
function resultError(error){return {isError:true,content:[{type:'text',text:String(error?.message||error)}]};}
export async function handleMcp(req,env){
 const owner=identity(req,env),rpc=await parseBody(req);
 if(!rpc||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')fail('Invalid MCP JSON-RPC');
 const id=rpc.id??null;let result;
 switch(rpc.method){
  case 'server/discover':result={supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}}};break;
  case 'initialize':result={protocolVersion:'2025-11-25',capabilities:{tools:{},resources:{}},serverInfo:{name:'noodl-flashcards',version:'0.1.0'}};break;
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
   else {try{result=resultSuccess(await callTool(name,env,owner,rpc.params?.arguments||{}));}catch(e){result=resultError(e);}}
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
 if(req.method==='GET'&&path==='/api/media')return replyJson({media:await listOwnerMedia(env,owner)});
 const m=path.match(/^\/api\/media\/([a-f0-9-]{36})(?:\/(approve|reject|challenge))?$/i);
 if(m){
  if(req.method==='GET'&&!m[2])return serveOwnerMedia(env,owner,m[1]);
  if(req.method==='GET'&&m[2]==='challenge')return replyJson(await issueMediaReviewChallenge(env,owner,m[1]));
  if(req.method==='POST'&&m[2]==='approve')return replyJson(await approveOwnerMedia(env,owner,m[1],await parseBody(req)));
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
