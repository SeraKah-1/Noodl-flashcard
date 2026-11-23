import {imageReferences} from '../shared/mediaPolicy.js';
/**
 * Card-bound double visual inspection. A model report is an auditable CLAIM,
 * not proof that a model actually viewed pixels or verified medical science.
 * Validated media and two independent workflow stages gate attachment; no manual approval click.
 */
import {getOwnerMedia,acceptPendingMediaIntegrity} from './media.js';

const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
function error(s,status=400){const e=new Error(s);e.status=status;throw e}
function str(v,label,max=1600,min=1){if(typeof v!=='string'||v.trim().length<min||v.length>max)error(`Invalid ${label}`);return v.trim()}
async function digest(bytes){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
const enc=new TextEncoder();
function textBlock(b){return b.type==='image'?null:b;}
export function semanticContent(card){const content={front:(card.front||[]).map(textBlock).filter(Boolean),back:(card.back||[]).map(textBlock).filter(Boolean)};if(card.procedureStep)content.procedureStep=card.procedureStep;if(card.explanation)content.explanation=card.explanation;if(card.backPages)content.backPages=card.backPages.map(p=>({...p,blocks:(p.blocks||[]).map(textBlock).filter(Boolean)}));return content;}
export async function semanticHash(card){return digest(enc.encode(JSON.stringify(semanticContent(card))));}
async function cardRow(env,owner,deckId,cardId){
 const row=await env.DB.prepare('SELECT c.content_json,c.position,c.id AS card_id,d.revision AS deck_revision FROM cards c JOIN decks d ON d.id=c.deck_id AND d.owner_id=c.owner_id WHERE c.owner_id=? AND c.deck_id=? AND c.id=? AND d.deleted_at IS NULL').bind(owner,deckId,cardId).first();
 if(!row)error('Card not found in this account',404);return {...row,card:JSON.parse(row.content_json)};
}
async function bindingRow(env,owner,id){const row=await env.DB.prepare('SELECT * FROM visual_bindings WHERE id=? AND owner_id=?').bind(id,owner).first();if(!row)error('Visual candidate not found',404);return row;}
async function assertFresh(env,owner,b){
 const row=await cardRow(env,owner,b.deck_id,b.card_id);
 const currentHash=await semanticHash(row.card);
 let media=await getOwnerMedia(env,owner,b.media_id);
 // Historical pending media no longer require a human token: re-check the original R2 bytes automatically.
 if(media.status==='pending'){await acceptPendingMediaIntegrity(env,owner,b.media_id);media=await getOwnerMedia(env,owner,b.media_id);}
 if(currentHash!==b.card_content_sha256||media.hash!==b.media_sha256||media.status!=='approved'){
  await env.DB.prepare("UPDATE visual_bindings SET status='stale',updated_at=? WHERE id=? AND owner_id=? AND status NOT IN ('stale','rejected')").bind(now(),b.id,owner).run();
  error('Visual validation invalidated: card answer or source image changed',409);
 }
 return {row,media};
}
function sourceReport(input,media){
 const observedLabels=input?.observedLabels;
 if(!Array.isArray(observedLabels)||observedLabels.length<1||observedLabels.length>24||observedLabels.some(v=>typeof v!=='string'||v.trim().length<2||v.length>100))error('Source check must identify concrete visible labels or recognizable elements');
 const claim=str(input.supportedClaim,'source supportedClaim',800,15),note=str(input.evidenceNote,'source evidenceNote',1200,30);
 const sourcePage=media.provenance_json?JSON.parse(media.provenance_json).sourcePage:null;
 if(sourcePage!=null&&input.sourcePage!==sourcePage)error('Source page disagrees with stored media provenance');
 if(input.result!=='pass')error('Source check must pass; reject/rework candidates that fail');
 return {result:'pass',observedLabels:observedLabels.map(x=>x.trim()),sourcePage,sourceOrigin:JSON.parse(media.provenance_json).origin,supportedClaim:claim,evidenceNote:note,sourceIntegrity:'unverified_host_context'};
}
function visualReport(input){
 if(input?.inspectedView!=='final_stored_image')error('Visual check must inspect the final stored image, not a search thumbnail');
 if(input.readability!=='legible_at_phone_width')error('Unclear image must be recropped before approval');
 const labels=input.observedLabels;if(!Array.isArray(labels)||labels.length<1||labels.some(x=>typeof x!=='string'||x.trim().length<2||x.length>100))error('Visual check requires actual visible labels or objects');
 const claim=str(input.supportedClaim,'visual supportedClaim',800,15),countercheck=str(input.countercheck,'visual countercheck',800,20);
 if(input.recommendation!=='pass'||(input.problems?.length||0)>0)error('Visual needs rework or rejection');
 return {inspectedView:'final_stored_image',readability:'legible_at_phone_width',observedLabels:labels,supportedClaim:claim,countercheck,problems:[],recommendation:'pass'};
}
function summary(b){return {bindingId:b.id,deckId:b.deck_id,cardId:b.card_id,mediaId:b.media_id,status:b.status,side:b.side,pageId:b.page_id||null,mediaSha256:b.media_sha256,cardContentSha256:b.card_content_sha256,sourceCheckId:b.source_check_id,visualCheckId:b.visual_check_id,provenance:JSON.parse(b.provenance_json)};}
export async function createCandidate(env,owner,args){
 const deckId=str(args.deckId,'deckId',150),cardId=str(args.cardId,'cardId',150),mediaId=str(args.mediaId,'mediaId',150);
 const side=args.side||'back';if(!['front','back'].includes(side))error('Invalid visual side');
 const {card}=await cardRow(env,owner,deckId,cardId);
 const pageId=args.pageId||null;
 if(pageId&&(side!=='back'||!card.backPages?.some(p=>p.id===pageId)))error('Back page ID does not belong to the selected card');
 let media=await getOwnerMedia(env,owner,mediaId);
 // Legacy v0.8 media must not require any approval step. Validate actual R2 bytes on first use.
 if(media.status==='pending'){await acceptPendingMediaIntegrity(env,owner,mediaId);media=await getOwnerMedia(env,owner,mediaId);}
 if(media.status!=='approved')error('Media bytes must pass storage integrity validation first');
 const contentHash=await semanticHash(card);const id=uuid(),t=now();
 await env.DB.prepare('INSERT INTO visual_bindings(id,owner_id,deck_id,card_id,media_id,media_sha256,card_content_sha256,side,page_id,provenance_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,owner,deckId,cardId,mediaId,media.hash,contentHash,side,pageId,media.provenance_json,'candidate',t,t).run();
 return summary(await bindingRow(env,owner,id));
}
export async function submitSourceCheck(env,owner,args){
 const b=await bindingRow(env,owner,str(args.bindingId,'bindingId',150));
 if(b.status!=='candidate')error('Source check must run first on a candidate');
 const {media}=await assertFresh(env,owner,b);const report=sourceReport(args.report,media),checkId=uuid(),t=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO visual_checks(id,owner_id,binding_id,phase,media_sha256,card_content_sha256,report_json,actor_type,created_at,result) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .bind(checkId,owner,b.id,'source',b.media_sha256,b.card_content_sha256,JSON.stringify(report),'model_claim',t,'pass'),
  env.DB.prepare("UPDATE visual_bindings SET source_check_id=?,status='source_checked',updated_at=? WHERE id=? AND owner_id=? AND status='candidate'").bind(checkId,t,b.id,owner)
 ]);
 return {...summary(await bindingRow(env,owner,b.id)),sourceIntegrity:report.sourceIntegrity};
}
export async function submitVisualCheck(env,owner,args){
 const b=await bindingRow(env,owner,str(args.bindingId,'bindingId',150));
 if(b.status!=='source_checked'||!b.source_check_id)error('Second check requires successful source check');
 await assertFresh(env,owner,b);const report=visualReport(args.report),checkId=uuid(),t=now();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO visual_checks(id,owner_id,binding_id,phase,media_sha256,card_content_sha256,report_json,actor_type,created_at,result) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(checkId,owner,b.id,'visual',b.media_sha256,b.card_content_sha256,JSON.stringify(report),'model_claim',t,'pass'),
  env.DB.prepare("UPDATE visual_bindings SET visual_check_id=?,status='approved_for_card',updated_at=? WHERE id=? AND owner_id=? AND status='source_checked'").bind(checkId,t,b.id,owner)
 ]);
 return summary(await bindingRow(env,owner,b.id));
}
export async function listVisualCandidates(env,owner){
 const rows=(await env.DB.prepare("SELECT * FROM visual_bindings WHERE owner_id=? AND status IN ('candidate','source_checked','approved_for_card','attached','stale','rejected') ORDER BY created_at DESC LIMIT 250").bind(owner).all()).results;
 return rows.map(summary);
}
export async function inspectVisualBinding(env,owner,id){
 const b=await bindingRow(env,owner,id);const checks=(await env.DB.prepare('SELECT id,phase,actor_type,report_json,created_at,result FROM visual_checks WHERE owner_id=? AND binding_id=? ORDER BY created_at').bind(owner,id).all()).results;
 return {...summary(b),checks:checks.map(x=>({...x,report:JSON.parse(x.report_json),report_json:undefined})),imagePath:`/api/media/${b.media_id}`};
}
export async function attachCardVisual(env,owner,args){
 const id=str(args.bindingId,'bindingId',150),opId=str(args.operationId,'operationId',120);
 const previous=await env.DB.prepare('SELECT result_json FROM operations WHERE owner_id=? AND id=?').bind(owner,opId).first();
 if(previous){const receipt=JSON.parse(previous.result_json);if(receipt.bindingId!==id||receipt.revision-1!==args.expectedRevision)error('Operation ID already used for a different mutation',409);return receipt;}
 let b=await bindingRow(env,owner,id);
 if(b.status!=='approved_for_card')error('Both source and visual checks must pass before attachment');
 const {row,media}=await assertFresh(env,owner,b);
 if(row.deck_revision!==args.expectedRevision)error('Deck revision changed; refresh and retry',409);
 const checks=(await env.DB.prepare('SELECT id,phase,result,media_sha256,card_content_sha256 FROM visual_checks WHERE owner_id=? AND binding_id=? AND id IN (?,?)').bind(owner,id,b.source_check_id||'',b.visual_check_id||'').all()).results;
 if(!b.source_check_id||!b.visual_check_id||checks.length!==2||!['source','visual'].every(phase=>checks.some(x=>x.phase===phase&&x.result==='pass'&&x.media_sha256===media.hash&&x.card_content_sha256===b.card_content_sha256)))error('Both matching visual validation reports are required');
 const front=Array.isArray(row.card.front)?[...row.card.front]:[],back=Array.isArray(row.card.back)?[...row.card.back]:[];
 const backPages=(row.card.backPages||[]).map(p=>({...p,blocks:[...p.blocks]}));
 let side=b.side==='front'?front:back;
 if(b.page_id){const p=backPages.find(p=>p.id===b.page_id);if(!p)error('Approved page no longer exists',409);side=p.blocks;}
 if(!side.some(x=>x.type==='image'&&x.assetId===b.media_id))side.push({type:'image',assetId:b.media_id,alt:JSON.parse(media.provenance_json).description||'Sumber visual yang telah diperiksa'});
 const next={...row.card,front,back,...(row.card.backPages?{backPages}:{})};const at=now(),nonce=uuid();
 const receipt={bindingId:id,deckId:b.deck_id,cardId:b.card_id,mediaId:b.media_id,revision:row.deck_revision+1,attached:true};
 await env.DB.batch([
  env.DB.prepare("INSERT INTO operations(owner_id,id,result_json,nonce,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM cards WHERE owner_id=? AND id=? AND deck_id=? AND content_json=?) AND EXISTS(SELECT 1 FROM visual_bindings WHERE id=? AND owner_id=? AND status='approved_for_card') ON CONFLICT(owner_id,id) DO NOTHING")
   .bind(owner,opId,JSON.stringify(receipt),nonce,at,owner,b.deck_id,row.deck_revision,owner,b.card_id,b.deck_id,row.content_json,id,owner),
  env.DB.prepare('UPDATE cards SET content_json=?,updated_at=? WHERE id=? AND deck_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM operations WHERE owner_id=? AND id=? AND nonce=?)').bind(JSON.stringify(next),at,b.card_id,b.deck_id,owner,owner,opId,nonce),
  env.DB.prepare('UPDATE decks SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM operations WHERE owner_id=? AND id=? AND nonce=?)').bind(at,b.deck_id,owner,row.deck_revision,owner,opId,nonce),
  env.DB.prepare("UPDATE visual_bindings SET status='attached',updated_at=? WHERE id=? AND owner_id=? AND status='approved_for_card' AND EXISTS(SELECT 1 FROM operations WHERE owner_id=? AND id=? AND nonce=?)").bind(at,id,owner,owner,opId,nonce)
 ]);
 const saved=await env.DB.prepare('SELECT result_json FROM operations WHERE owner_id=? AND id=?').bind(owner,opId).first();if(!saved)error('Concurrent edit conflict, refresh deck',409);
 return JSON.parse(saved.result_json);
}
export async function assertNoUnapprovedImages(env,owner,deckId,cardId,newCard){
 const images=imageReferences(newCard);
 if(!images.length)return;
 if(!deckId||!cardId)error('Images must pass card-specific source and visual checks, not be inserted directly in create_deck/append_cards');
 const existing=await cardRow(env,owner,deckId,cardId);
 const hash=await semanticHash(newCard);
 if(hash!==(await semanticHash(existing.card)))error('Changing a card answer requires removing attached images and running new visual checks');
 const oldImages=imageReferences(existing.card);
 for(const image of images){
  const index=oldImages.findIndex(x=>x.assetId===image.assetId&&x.alt===image.alt&&x.pageId===image.pageId&&x.side===image.side);
  if(index<0)error('Direct media attachment bypasses card-specific visual validation');
  oldImages.splice(index,1);
  const binding=await env.DB.prepare("SELECT id FROM visual_bindings WHERE owner_id=? AND deck_id=? AND card_id=? AND media_id=? AND side=? AND COALESCE(page_id,'')=? AND status='attached' AND card_content_sha256=?").bind(owner,deckId,cardId,image.assetId,image.side,image.pageId||'',hash).first();
  if(!binding)error('Card image lacks an attached double-checked visual binding');
 }
}
export async function invalidateCardBindings(env,owner,deckId,cardId){
 await env.DB.prepare("UPDATE visual_bindings SET status='stale',updated_at=? WHERE owner_id=? AND deck_id=? AND card_id=? AND status NOT IN ('stale','rejected')").bind(now(),owner,deckId,cardId).run();
}
