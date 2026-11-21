// Account-scoped hierarchical folders. Folder deletion never deletes a deck,
// card, review, media object, or descendant folder. All updates are atomic.
const id=()=>crypto.randomUUID();
const stamp=()=>new Date().toISOString();
const forbiddenName=/[/\\\u0000-\u001f\u007f]/;
const assertId=(value,key='id')=>{
 if(typeof value!=='string'||!value.trim()||value.length>200)throw Error(`Invalid ${key}`);
 return value.trim();
};
function folderName(input){
 if(typeof input!=='string')throw Error('Folder name is required');
 const value=input.trim().replace(/\s+/g,' ');
 if(!value||value.length>72||forbiddenName.test(value)||value==='.'||value==='..')throw Error('Invalid folder name');
 return value;
}
const folderKey=name=>name.toLowerCase();
function parentValue(input){
 if(input===undefined||input===null||input==='')return null;
 return assertId(input,'parentFolderId');
}
function checkRevision(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Valid expectedRevision is required');return value;}
function err(message,status=400){const e=new Error(message);e.status=status;throw e;}
async function receipt(db,owner,operationId){
 const row=await db.prepare('SELECT result_json FROM operations WHERE owner_id=? AND id=?').bind(owner,operationId).first();
 return row?JSON.parse(row.result_json):null;
}
async function commit(env,owner,operationId,result,condition,bindings,mutations){
 const op=assertId(operationId,'operationId');
 const prev=await receipt(env.DB,owner,op);if(prev)return prev;
 const marker=id(),now=stamp();
 const sql=`INSERT INTO operations(owner_id,id,result_json,nonce,created_at) SELECT ?,?,?,?,? WHERE (${condition}) ON CONFLICT(owner_id,id) DO NOTHING`;
 const gate='EXISTS(SELECT 1 FROM operations WHERE owner_id=? AND id=? AND nonce=?)';
 await env.DB.batch([
  env.DB.prepare(sql).bind(owner,op,JSON.stringify(result),marker,now,...bindings),
  ...mutations(gate,[owner,op,marker])
 ]);
 const saved=await receipt(env.DB,owner,op);
 if(!saved)err('Folder changed; refresh and retry',409);
 return saved;
}
async function ownedFolder(db,owner,folderId){
 const row=await db.prepare('SELECT * FROM folders WHERE owner_id=? AND id=? AND deleted_at IS NULL').bind(owner,folderId).first();
 if(!row)err('Folder not found',404);
 return row;
}
async function folderAncestors(db,owner,parentId){
 const ancestors=[],seen=new Set();let cursor=parentId;
 while(cursor){
  if(seen.has(cursor)||ancestors.length>=8)err('Folder nesting limit or cycle detected');
  seen.add(cursor);const node=await ownedFolder(db,owner,cursor);ancestors.push(node);cursor=node.parent_id;
 }
 return ancestors;
}
async function checkSiblingName(db,owner,parentId,name,excludeId=null){
 const existing=await db.prepare('SELECT id FROM folders WHERE owner_id=? AND parent_key=? AND name_key=? AND deleted_at IS NULL').bind(owner,parentId||'',folderKey(name)).first();
 if(existing&&existing.id!==excludeId)err('Folder with this name already exists here',409);
}
export async function listFolders(db,owner){
 const rows=(await db.prepare('SELECT id,parent_id,name,revision,created_at,updated_at FROM folders WHERE owner_id=? AND deleted_at IS NULL ORDER BY name_key,id LIMIT 1001').bind(owner).all()).results;
 if(rows.length>1000)err('Too many folders',400);
 return rows.map(x=>({id:x.id,parentId:x.parent_id,name:x.name,revision:x.revision,createdAt:x.created_at,updatedAt:x.updated_at}));
}
export async function requireFolder(db,owner,value){
 const folderId=parentValue(value);
 if(folderId)await ownedFolder(db,owner,folderId);
 return folderId;
}
export async function createFolder(env,owner,args){
 const operationId=assertId(args.operationId,'operationId');const prev=await receipt(env.DB,owner,operationId);if(prev)return prev;
 const parentId=parentValue(args.parentId),name=folderName(args.name),now=stamp(),folderId=id();
 if(parentId){const parents=await folderAncestors(env.DB,owner,parentId);if(parents.length>=6)err('Maximum 6 folder levels');}
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM folders WHERE owner_id=? AND deleted_at IS NULL').bind(owner).first();
 if(count.n>=1000)err('Maximum 1000 folders');
 await checkSiblingName(env.DB,owner,parentId,name);
 return commit(env,owner,operationId,{folderId,parentId,name,revision:1},
  parentId?'EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND deleted_at IS NULL)':'1=1',
  parentId?[owner,parentId]:[],(gate,g)=>[
   env.DB.prepare(`INSERT INTO folders(id,owner_id,parent_id,parent_key,name,name_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`)
   .bind(folderId,owner,parentId,parentId||'',name,folderKey(name),now,now,...g)
  ]);
}
export async function renameFolder(env,owner,args){
 const operationId=assertId(args.operationId,'operationId');const prev=await receipt(env.DB,owner,operationId);if(prev)return prev;
 const folderId=assertId(args.folderId,'folderId'),expectedRevision=checkRevision(args.expectedRevision),name=folderName(args.name);
 const row=await ownedFolder(env.DB,owner,folderId);if(row.revision!==expectedRevision)err('Folder revision changed',409);
 await checkSiblingName(env.DB,owner,row.parent_id,name,folderId);
 const now=stamp();return commit(env,owner,operationId,{folderId,name,revision:row.revision+1},
  'EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)',[owner,folderId,expectedRevision],
  (gate,g)=>[env.DB.prepare(`UPDATE folders SET name=?,name_key=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=? AND ${gate}`)
   .bind(name,folderKey(name),now,owner,folderId,expectedRevision,...g)]);
}
export async function moveFolder(env,owner,args){
 const operationId=assertId(args.operationId,'operationId');const prev=await receipt(env.DB,owner,operationId);if(prev)return prev;
 const folderId=assertId(args.folderId,'folderId'),expectedRevision=checkRevision(args.expectedRevision),parentId=parentValue(args.parentId);
 const row=await ownedFolder(env.DB,owner,folderId);if(row.revision!==expectedRevision)err('Folder revision changed',409);
 if(row.parent_id===parentId)return commit(env,owner,operationId,{folderId,parentId,revision:row.revision},'1=1',[],()=>[]);
 const ancestorList=await folderAncestors(env.DB,owner,parentId);
 if(ancestorList.some(x=>x.id===folderId))err('Cannot move a folder inside itself or its descendants');
 // Each subtree node is checked to prevent exceeding max 6 levels after move.
 const all=await listFolders(env.DB,owner);
 const depths=new Map();const children=new Map();for(const f of all){const arr=children.get(f.parentId)||[];arr.push(f.id);children.set(f.parentId,arr);}
 const walk=(target,depth)=>{if(depth>6)err('Maximum 6 folder levels');if(depths.has(target))err('Folder cycle detected');depths.set(target,depth);for(const child of children.get(target)||[])walk(child,depth+1);};
 walk(folderId,ancestorList.length+1);
 await checkSiblingName(env.DB,owner,parentId,row.name,folderId);
 const now=stamp();return commit(env,owner,operationId,{folderId,parentId,revision:row.revision+1},
  'EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)'+(parentId?' AND EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND deleted_at IS NULL)':''),[owner,folderId,expectedRevision,...(parentId?[owner,parentId]:[])],
  (gate,g)=>[env.DB.prepare(`UPDATE folders SET parent_id=?,parent_key=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=? AND ${gate}`)
   .bind(parentId,parentId||'',now,owner,folderId,expectedRevision,...g)]);
}
export async function deleteFolder(env,owner,args){
 const operationId=assertId(args.operationId,'operationId');const prev=await receipt(env.DB,owner,operationId);if(prev)return prev;
 const folderId=assertId(args.folderId,'folderId'),expectedRevision=checkRevision(args.expectedRevision);
 const row=await ownedFolder(env.DB,owner,folderId);if(row.revision!==expectedRevision)err('Folder revision changed',409);
 // Children and decks are reparented to this folder's own parent, never deleted.
 const childRows=(await env.DB.prepare('SELECT id,name,name_key FROM folders WHERE owner_id=? AND parent_id=? AND deleted_at IS NULL').bind(owner,folderId).all()).results;
 for(const child of childRows)await checkSiblingName(env.DB,owner,row.parent_id,child.name,child.id);
 const now=stamp(),count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM decks WHERE owner_id=? AND folder_id=? AND deleted_at IS NULL').bind(owner,folderId).first()).n;
 const condition='EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)';
 return commit(env,owner,operationId,{folderId,deleted:true,movedDecks:count,movedSubfolders:childRows.length,parentId:row.parent_id},condition,[owner,folderId,expectedRevision],(gate,g)=>[
  env.DB.prepare(`UPDATE folders SET deleted_at=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=? AND ${gate}`).bind(now,now,owner,folderId,expectedRevision,...g),
  env.DB.prepare(`UPDATE folders SET parent_id=?,parent_key=?,revision=revision+1,updated_at=? WHERE owner_id=? AND parent_id=? AND deleted_at IS NULL AND ${gate}`).bind(row.parent_id,row.parent_id||'',now,owner,folderId,...g),
  env.DB.prepare(`UPDATE decks SET folder_id=?,revision=revision+1,updated_at=? WHERE owner_id=? AND folder_id=? AND deleted_at IS NULL AND ${gate}`).bind(row.parent_id,now,owner,folderId,...g)
 ]);
}
export async function moveDeckToFolder(env,owner,args){
 const operationId=assertId(args.operationId,'operationId');const prev=await receipt(env.DB,owner,operationId);if(prev)return prev;
 const deckId=assertId(args.deckId,'deckId'),expectedRevision=checkRevision(args.expectedRevision),folderId=parentValue(args.folderId);
 const row=await env.DB.prepare('SELECT id,revision,folder_id FROM decks WHERE owner_id=? AND id=? AND deleted_at IS NULL').bind(owner,deckId).first();
 if(!row)err('Deck not found',404);if(row.revision!==expectedRevision)err('Deck revision changed',409);
 await requireFolder(env.DB,owner,folderId);
 const increment=row.folder_id===folderId?0:1,now=stamp();
 return commit(env,owner,operationId,{deckId,folderId,revision:row.revision+increment},
  'EXISTS(SELECT 1 FROM decks WHERE owner_id=? AND id=? AND revision=? AND deleted_at IS NULL)'+(folderId?' AND EXISTS(SELECT 1 FROM folders WHERE owner_id=? AND id=? AND deleted_at IS NULL)':''),
  [owner,deckId,expectedRevision,...(folderId?[owner,folderId]:[])],
  (gate,g)=>increment?[env.DB.prepare(`UPDATE decks SET folder_id=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=? AND ${gate}`).bind(folderId,now,owner,deckId,expectedRevision,...g)]:[]);
}
