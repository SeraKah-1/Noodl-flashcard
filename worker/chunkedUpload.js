import {storePendingImage,identifyImage} from './media.js';
import {validateProvenance} from './validation.js';

export const CHUNK_BYTES=96*1024;
const MAX_BYTES=4_000_000;
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
function validName(value,label,max=250){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Invalid ${label}`);return value.trim();}
function decodeBase64(data){
 if(typeof data!=='string'||data.length<4||data.length>4*Math.ceil(CHUNK_BYTES/3)||data.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw Error('Invalid base64 chunk');
 let binary;try{binary=atob(data);}catch{throw Error('Invalid base64 chunk');}
 if(binary.length<1||binary.length>CHUNK_BYTES)throw Error('Image chunk exceeds 96 KiB');
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function ownedUpload(env,owner,uploadId){
 const row=await env.DB.prepare('SELECT * FROM media_uploads WHERE id=? AND owner_id=?').bind(uploadId,owner).first();
 if(!row)throw Error('Upload not found; begin a new upload');
 if(row.expires_at<=now())throw Error('Upload expired; begin a new upload');
 return row;
}
export async function beginChunkedUpload(env,owner,args){
 if(!env.DB||!env.MEDIA)throw Error('Media database and storage required');
 if(!Number.isInteger(args.byteLength)||args.byteLength<24||args.byteLength>MAX_BYTES)throw Error('Image must be 24 bytes to 4 MB');
 if(!['image/png','image/jpeg','image/webp'].includes(args.mimeType))throw Error('Only PNG, JPEG and WebP are allowed');
 const filename=validName(args.fileName,'file name');
 const provenance=validateProvenance(args.provenance);
 // Remove abandoned staged chunks for this account and cap concurrent staging to reduce D1 abuse.
 await env.DB.prepare('DELETE FROM media_uploads WHERE owner_id=? AND expires_at<?').bind(owner,now()).run();
 const active=await env.DB.prepare('SELECT COUNT(*) AS n FROM media_uploads WHERE owner_id=?').bind(owner).first();
 if(active.n>=8)throw Error('Too many simultaneous uploads; finish or let expired uploads clear');
 const id=uuid(),expiresAt=new Date(Date.now()+30*60_000).toISOString();
 await env.DB.prepare(`INSERT INTO media_uploads(id,owner_id,expected_bytes,mime_hint,filename,provenance_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
  .bind(id,owner,args.byteLength,args.mimeType,filename,JSON.stringify(provenance),expiresAt,now()).run();
 return {uploadId:id,chunkBytes:CHUNK_BYTES,expectedBytes:args.byteLength,expiresAt};
}
export async function appendChunkedUpload(env,owner,args){
 const uploadId=validName(args.uploadId,'upload ID',100);
 if(!Number.isInteger(args.index)||args.index<0||args.index>1000)throw Error('Invalid chunk index');
 const bytes=decodeBase64(args.base64);
 const row=await ownedUpload(env,owner,uploadId);
 if(args.index<row.next_index){
  const old=await env.DB.prepare('SELECT data_base64 FROM media_upload_chunks WHERE upload_id=? AND owner_id=? AND chunk_index=?').bind(uploadId,owner,args.index).first();
  if(old?.data_base64===args.base64)return {uploadId,nextIndex:row.next_index,receivedBytes:row.received_bytes,replayed:true};
  throw Error('Chunk replay differs from previous content');
 }
 if(args.index!==row.next_index)throw Error(`Out of order: expected chunk ${row.next_index}`);
 if(row.received_bytes+bytes.length>row.expected_bytes)throw Error('Chunk exceeds declared upload length');
 // D1 batch provides an atomic progression; a concurrent stale writer fails the uniqueness constraint.
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO media_upload_chunks(upload_id,owner_id,chunk_index,data_base64,chunk_bytes)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM media_uploads WHERE id=? AND owner_id=? AND next_index=? AND expires_at>? AND received_bytes+?<=expected_bytes)`)
   .bind(uploadId,owner,args.index,args.base64,bytes.length,uploadId,owner,args.index,now(),bytes.length),
  env.DB.prepare(`UPDATE media_uploads SET next_index=next_index+1,received_bytes=received_bytes+?
    WHERE id=? AND owner_id=? AND next_index=? AND expires_at>? AND received_bytes+?<=expected_bytes`)
   .bind(bytes.length,uploadId,owner,args.index,now(),bytes.length)
 ]);
 const updated=await ownedUpload(env,owner,uploadId);
 if(updated.next_index!==args.index+1)throw Error('Upload concurrency conflict');
 return {uploadId,nextIndex:updated.next_index,receivedBytes:updated.received_bytes,expectedBytes:updated.expected_bytes};
}
export async function finishChunkedUpload(env,owner,args){
 const uploadId=validName(args.uploadId,'upload ID',100);
 const row=await ownedUpload(env,owner,uploadId);
 if(row.received_bytes!==row.expected_bytes||row.next_index===0)throw Error('Upload incomplete');
 const list=(await env.DB.prepare('SELECT chunk_index,data_base64,chunk_bytes FROM media_upload_chunks WHERE upload_id=? AND owner_id=? ORDER BY chunk_index').bind(uploadId,owner).all()).results;
 if(list.length!==row.next_index)throw Error('Missing upload chunks');
 const image=new Uint8Array(row.expected_bytes);let offset=0;
 for(let i=0;i<list.length;i++){
  if(list[i].chunk_index!==i)throw Error('Missing upload chunk');
  const chunk=decodeBase64(list[i].data_base64);
  if(chunk.length!==list[i].chunk_bytes||offset+chunk.length>image.length)throw Error('Corrupted upload chunk');
  image.set(chunk,offset);offset+=chunk.length;
 }
 if(offset!==image.length)throw Error('Uploaded bytes mismatch');
 const info=identifyImage(image);
 if(info.mime!==row.mime_hint)throw Error('Image MIME differs from actual data');
 const provenance=JSON.parse(row.provenance_json);
 const media=await storePendingImage(env,owner,image,provenance,{observation:'An actual image file was uploaded from the Noodl app. Source and visual relevance are not yet approved.',legible:false,relevant:false});
 await env.DB.prepare('DELETE FROM media_uploads WHERE id=? AND owner_id=?').bind(uploadId,owner).run();
 return media;
}
export async function purgeExpiredUploads(env,owner){
 const result=await env.DB.prepare('DELETE FROM media_uploads WHERE owner_id=? AND expires_at<?').bind(owner,now()).run();
 return {purged:result.meta?.changes??0};
}
