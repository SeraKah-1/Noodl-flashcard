import {imageReferences,frontImageIds,mediaRequirementOf} from '../shared/mediaPolicy.js';
import {validateProvenance,validateVisualReview} from './validation.js';
const MAX_BYTES=4_000_000;
const MAX_PIXELS=12_000_000;
const MAX_EDGE=4096;
export function identifyImage(input) {
 const b=input instanceof Uint8Array?input:new Uint8Array(input);
 if(b.length<24||b.length>MAX_BYTES)throw Error('Image size outside 24 bytes..4 MB');
 let mime='',width=0,height=0;
 if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10){
  mime='image/png';
  if(String.fromCharCode(...b.slice(12,16))!=='IHDR')throw Error('Invalid PNG header');
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);width=v.getUint32(16);height=v.getUint32(20);
 }else if(b[0]===255&&b[1]===216){
  mime='image/jpeg';
  let offset=2;
  while(offset+9<b.length){
   if(b[offset]!==255){offset++;continue;}
   const marker=b[offset+1];
   if(marker===0xd9||marker===0xda)break;
   if(marker===0xff||marker===0x00){offset++;continue;}
   const size=b[offset+2]*256+b[offset+3];if(size<2||offset+size+2>b.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    height=b[offset+5]*256+b[offset+6];width=b[offset+7]*256+b[offset+8];break;
   }
   offset+=size+2;
  }
 }else if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'){
  mime='image/webp';
  const kind=String.fromCharCode(...b.slice(12,16));
  if(kind==='VP8X'&&b.length>=30){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
  else if(kind==='VP8 '&&b.length>=30){width=(b[26]|(b[27]<<8))&0x3fff;height=(b[28]|(b[29]<<8))&0x3fff;}
  else if(kind==='VP8L'&&b.length>=25){width=1+(((b[22]&0x3f)<<8)|b[21]);height=1+(((b[24]&0xf)<<10)|(b[23]<<2)|((b[22]&0xc0)>>6));}
 }
 if(!mime)throw Error('Only PNG, JPEG, and WebP are permitted; SVG, GIF and HTML are rejected');
 if(!width||!height||width<32||height<32||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)throw Error('Image dimensions are invalid or unsafe');
 return {mime,width,height,bytes:b.length};
}
export function allowRemoteUrl(raw,hosts){
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error('Only plain HTTPS URLs are allowed');
 const h=url.hostname.toLowerCase();
 if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(h)||h.includes(':'))throw Error('Private or numeric host blocked');
 const allowed=String(hosts||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!allowed.some(entry=>entry.startsWith('*.')?(h.endsWith(entry.slice(1))&&h.length>entry.length-1):h===entry))throw Error(`Host ${h} is not explicitly permitted`);
 return url;
}
async function readLimited(response){
 if(!response.ok)throw Error('Image fetch failed');
 const size=Number(response.headers.get('content-length')||0);
 if(size>MAX_BYTES)throw Error('Image too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty image response');
 const chunks=[];let total=0;
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BYTES){await reader.cancel();throw Error('Image exceeds 4 MB');}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function fetchAllowedImage(urlString,hosts,fetcher=fetch){
 const url=allowRemoteUrl(urlString,hosts);
 const response=await fetcher(url.toString(),{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'image/png,image/jpeg,image/webp'}});
 const bytes=await readLimited(response);
 const info=identifyImage(bytes);
 const declared=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
 if(declared && !['application/octet-stream','binary/octet-stream',info.mime].includes(declared))throw Error('Declared content type does not match actual image');
 return {bytes,info};
}
const uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
export async function storePendingImage(env,owner,bytes,provenanceInput,visualReviewInput={observation:'Media bytes validated on ingestion. Content relevance still requires separate source and visual checks.',legible:false,relevant:false}){
 if(!env.MEDIA||!env.DB)throw Error('D1 and R2 bindings are required');
 const info=identifyImage(bytes),provenance=validateProvenance(provenanceInput),visualReview=validateVisualReview(visualReviewInput);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 const id=uuid(),key=`private/${encodeURIComponent(owner)}/${id}`;
 await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:info.mime},customMetadata:{owner,id,hash}});
 try{
  await env.DB.prepare(`INSERT INTO media(id,owner_id,storage_key,mime,width,height,bytes,hash,status,provenance_json,visual_review_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(id,owner,key,info.mime,info.width,info.height,info.bytes,hash,'approved',JSON.stringify(provenance),JSON.stringify(visualReview),now()).run();
 }catch(error){await env.MEDIA.delete(key);throw error;}
 return {id,status:'approved',...info,sha256:hash,provenance,visualReview,integrityChecked:true,cardRelevanceChecked:false};
}
export async function acceptPendingMediaIntegrity(env,owner,id){
 const row=await getOwnerMedia(env,owner,id);
 if(row.status==='rejected')throw Error('Rejected image cannot be accepted');
 if(row.status==='approved')return mediaSummary(row);
 const object=await env.MEDIA.get(row.storage_key);if(!object)throw Error('Image bytes missing from storage');
 const bytes=new Uint8Array(await object.arrayBuffer());const actual=identifyImage(bytes);
 const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hex!==row.hash||actual.bytes!==row.bytes||actual.mime!==row.mime||actual.width!==row.width||actual.height!==row.height)throw Error('Media bytes failed integrity checks');
 await env.DB.prepare("UPDATE media SET status='approved',reviewed_at=? WHERE owner_id=? AND id=? AND status='pending'").bind(now(),owner,id).run();
 return {...mediaSummary(await getOwnerMedia(env,owner,id)),integrityChecked:true,cardRelevanceChecked:false};
}

export async function getOwnerMedia(env,owner,id){
 const row=await env.DB.prepare('SELECT * FROM media WHERE id=? AND owner_id=?').bind(id,owner).first();
 if(!row)throw Error('Image not found in this account');return row;
}
export function mediaSummary(row){return {id:row.id,status:row.status,mime:row.mime,width:row.width,height:row.height,bytes:row.bytes,sha256:row.hash,provenance:JSON.parse(row.provenance_json),visualReview:JSON.parse(row.visual_review_json),approval:row.approval_json?JSON.parse(row.approval_json):null};}
export async function listOwnerMedia(env,owner){const rows=await env.DB.prepare('SELECT * FROM media WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').bind(owner).all();return rows.results.map(mediaSummary);}
// Authenticated MCP fallback for embedded views where the browser cannot fetch a private /api/media URL.
// Small ranged R2 reads avoid returning a multi-megabyte image in a single tool response.
export async function readOwnerMediaChunk(env,owner,id,index){
 if(!Number.isInteger(index)||index<0||index>1000)throw Error('Invalid media chunk index');
 const row=await getOwnerMedia(env,owner,id);
 if(row.status==='rejected')throw Error('Rejected image unavailable');
 const chunkBytes=96*1024,offset=index*chunkBytes;
 if(offset>=row.bytes)throw Error('Media chunk outside image');
 const length=Math.min(chunkBytes,row.bytes-offset);
 const object=await env.MEDIA.get(row.storage_key,{range:{offset,length}});
 if(!object)throw Error('Image data missing');
 const bytes=new Uint8Array(await object.arrayBuffer());
 if(bytes.byteLength!==length)throw Error('R2 returned truncated image chunk');
 let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
 return {mediaId:id,index,chunkCount:Math.ceil(row.bytes/chunkBytes),chunkBytes,bytes:row.bytes,mime:row.mime,sha256:row.hash,base64:btoa(binary)};
}
export async function readMediaForModel(env,owner,id){
 const row=await getOwnerMedia(env,owner,id);
 if(row.status==='rejected')throw Error('Rejected image cannot be inspected');
 const object=await env.MEDIA.get(row.storage_key);if(!object)throw Error('Stored media is missing');
 const bytes=new Uint8Array(await object.arrayBuffer());const parsed=identifyImage(bytes);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==row.hash||parsed.mime!==row.mime||parsed.bytes!==row.bytes||parsed.width!==row.width||parsed.height!==row.height)throw Error('Image integrity mismatch');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {mediaId:id,mime:row.mime,sha256:row.hash,width:row.width,height:row.height,provenance:JSON.parse(row.provenance_json),base64:btoa(binary)};
}
export async function serveOwnerMedia(env,owner,id){
 const row=await getOwnerMedia(env,owner,id);
 const object=await env.MEDIA.get(row.storage_key);if(!object)throw Error('Image data missing');
 return new Response(object.body,{headers:{'Content-Type':row.mime,'Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
}
export async function rejectOwnerMedia(env,owner,id){
 const row=await getOwnerMedia(env,owner,id);
 if(row.status==='approved')throw Error('Approved image is in use; detach it before removal');
 await env.DB.prepare(`UPDATE media SET status='rejected', reviewed_at=? WHERE owner_id=? AND id=?`).bind(now(),owner,id).run();
 await env.MEDIA.delete(row.storage_key);
 return {id,status:'rejected'};
}
export async function assertAllApprovedMedia(env,owner,cards){
 const ids=new Set(cards.flatMap(card=>imageReferences(card).map(b=>b.assetId)));
 for(const id of ids){const row=await getOwnerMedia(env,owner,id);if(row.status!=='approved')throw Error(`Image ${id} must pass stored-byte integrity validation`);}
}
/** A question image is optional on legacy cards, but an explicitly required visual must be real.
 * This is enforced again at review-write time; clients cannot bypass it by sending a rating.
 */
export async function cardVisualReadiness(env,owner,card){
 const requirement=mediaRequirementOf(card),ids=frontImageIds(card);
 if(requirement!=='required_for_question')return {requirement,ready:true,requiredImageIds:[],missingImageIds:[]};
 const missing=[];
 for(const id of ids){
  let row;
  try{row=await getOwnerMedia(env,owner,id);}catch{missing.push(id);continue;}
  if(row.status!=='approved'){missing.push(id);continue;}
  const object=await env.MEDIA.head(row.storage_key);
  if(!object)missing.push(id);
 }
 const ready=ids.length>0&&missing.length===0;
 return {requirement,ready,requiredImageIds:ids,missingImageIds:missing,reason:ready?null:ids.length?'media_missing_or_unapproved':'no_front_image_attached'};
}
