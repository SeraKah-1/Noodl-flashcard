import {CLUE_SECONDS, MAX_CARDS,normalizeTimer,assertProcedureSequence} from '../shared/logic.js';
function assert(condition,message){if(!condition)throw new Error(message);}
function txt(value,label,max=500){assert(typeof value==='string'&&value.trim().length>0&&value.length<=max,`Invalid ${label}`);return value.trim();}
function optTxt(value,label,max=500){if(value===undefined||value===null)return '';assert(typeof value==='string'&&value.length<=max,`Invalid ${label}`);return value.trim();}
export function validateBlock(block){
 assert(block&&typeof block==='object'&&!Array.isArray(block),'Invalid content block');
 switch(block.type){
  case 'text':return {type:'text',text:txt(block.text,'text',10000)};
  case 'math':return {type:'math',latex:txt(block.latex,'latex',500)};
  case 'image':return {type:'image',assetId:txt(block.assetId,'assetId',100),alt:txt(block.alt,'alt',280)};
  case 'embed':{
   const url=new URL(txt(block.url,'embed url',500));
   assert(url.protocol==='https:','Embed must use HTTPS');
   const host=url.hostname.toLowerCase();
   assert(['www.youtube-nocookie.com','www.youtube.com','youtu.be','player.vimeo.com','vimeo.com'].includes(host),'Embed provider not allowed');
   const provider=host.includes('youtu')?'youtube':'vimeo';
   return {type:'embed',provider,url:url.toString()};
  }
  default: throw Error('Unsupported block type');
 }
}
export function validateProcedureStep(value){
 assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid procedureStep');
 assert(Number.isInteger(value.order)&&value.order>=1&&value.order<=1000,'Invalid procedure step order');
 assert(typeof value.critical==='boolean','Procedure critical flag must be explicit');
 const checklistItem=txt(value.checklistItem,'checklist item',180);
 const phase=optTxt(value.phase,'procedure phase',70);
 const sourceDocument=txt(value.sourceDocument,'procedure source document',220);
 const sourcePage=value.sourcePage===undefined||value.sourcePage===null?null:value.sourcePage;
 assert(sourcePage===null||(Number.isInteger(sourcePage)&&sourcePage>=1&&sourcePage<=10000),'Invalid source page');
 return {order:value.order,checklistItem,phase,critical:value.critical,sourceDocument,sourcePage};
}
export function validateCard(input){
 assert(input&&typeof input==='object','Invalid card');
 const side=(arr,label)=>{assert(Array.isArray(arr)&&arr.length>0&&arr.length<=24,`Invalid ${label} blocks`);return arr.map(validateBlock);};
 const front=side(input.front,'front'),back=side(input.back,'back');
 const procedureStep=input.procedureStep===undefined?undefined:validateProcedureStep(input.procedureStep);
 let explanation;
 if(input.explanation!==undefined&&input.explanation!==null){
  const raw=input.explanation;
  assert(raw&&typeof raw==='object'&&!Array.isArray(raw),'Invalid explanation');
  assert(Array.isArray(raw.sections)&&raw.sections.length>=1&&raw.sections.length<=16,'Explanation needs 1..16 sections');
  explanation={sections:raw.sections.map((section,i)=>{
   assert(section&&typeof section==='object','Invalid explanation section');
   assert(Array.isArray(section.blocks)&&section.blocks.length>=1&&section.blocks.length<=20,'Explanation section needs 1..20 blocks');
   const blocks=section.blocks.map(validateBlock);
   assert(blocks.every(b=>b.type!=='image'),'Put verified images on the card back, not in explanation sections');
   return {heading:txt(section.heading,`section ${i+1} heading`,180),blocks};
  })};
 }
 let backPages;
 if(input.backPages!==undefined&&input.backPages!==null){
  assert(Array.isArray(input.backPages)&&input.backPages.length>=1&&input.backPages.length<=12,'Deep card requires 1..12 extra back pages');
  const ids=new Set();
  backPages=input.backPages.map((page,i)=>{
   assert(page&&typeof page==='object'&&!Array.isArray(page),'Invalid back page');
   const id=txt(page.id,`back page ${i+1} id`,70);
   assert(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id),'Invalid back page ID');
   assert(!ids.has(id),'Duplicate back page ID');ids.add(id);
   const kinds=['procedure','normal','abnormal','differential','visual','explanation','source'];
   assert(kinds.includes(page.kind),'Invalid back page kind');
   const blocks=side(page.blocks,'back page');
   const sourceRefs=(page.sourceRefs||[]);
   assert(Array.isArray(sourceRefs)&&sourceRefs.length<=8,'Too many back page source references');
   return {id,kind:page.kind,title:txt(page.title,'back page title',120),blocks,
    sourceRefs:sourceRefs.map(ref=>{
     assert(ref&&typeof ref==='object'&&!Array.isArray(ref),'Invalid source reference');
     const kind=ref.kind;
     assert(['slide','web','generated','note'].includes(kind),'Invalid source reference kind');
     const origin=txt(ref.origin,'source origin',500),sourcePage=ref.sourcePage??null;
     assert(sourcePage===null||(Number.isInteger(sourcePage)&&sourcePage>=1&&sourcePage<=10000),'Invalid source reference page');
     if(kind==='web'){const url=new URL(origin);assert(url.protocol==='https:','Web source reference must be HTTPS');}
     return {kind,origin,sourcePage};
    })};
  });
 }
 const totalText=[...front,...back,...(backPages||[]).flatMap(x=>x.blocks),...(explanation?.sections||[]).flatMap(x=>x.blocks)].reduce((n,b)=>n+(b.type==='text'?b.text.length:0),0);
 assert(totalText<=80000,'Card text exceeds 80000 characters');
 const clues=Array.isArray(input.clues)?input.clues:[];
 assert(procedureStep?(clues.length===0||clues.length===3):clues.length===3,procedureStep?'Procedure clues must be empty or exactly three':'Exactly three clues are required');
 const byTime=[...clues].sort((a,b)=>a.atSecond-b.atSecond);
 assert(byTime.every((c,i)=>c.atSecond===CLUE_SECONDS[i]),'Clues must be at 5, 10, and 15 seconds');
 const clueTexts=byTime.map((c,i)=>({atSecond:CLUE_SECONDS[i],text:txt(c.text,'clue',180)}));
 const tags=Array.isArray(input.tags)?input.tags:[];
 assert(tags.length<=10,'Too many tags');
 return {front,back,clues:clueTexts,timerSeconds:normalizeTimer(input.timerSeconds),tags:tags.map(v=>txt(v,'tag',40)),...(procedureStep?{procedureStep}:{}),...(explanation?{explanation}:{}),...(backPages?{backPages}:{})};
}
export function validateDeckInput(input){
 assert(input&&typeof input==='object','Missing deck');
 const title=txt(input.title,'title',120),description=optTxt(input.description,'description',400);
 assert(Array.isArray(input.cards)&&input.cards.length>=1&&input.cards.length<=Math.min(MAX_CARDS,100),'New deck requires 1..100 cards');
 const cards=input.cards.map(validateCard);
 assertProcedureSequence(cards);
 return {title,description,cards};
}
export function validateReview(value){
 assert(value&&typeof value==='object','Missing review');
 assert(Number.isInteger(value.rating)&&value.rating>=0&&value.rating<=3,'Rating 0..3 required');
 assert(typeof value.answerRevealed==='boolean','Reveal status required');
 assert(!value.answerRevealed && ![0,3].includes(value.rating) ? false : true,'Hidden card can only receive left/right self-rating');
 assert(Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=120000,'Invalid elapsed time');
 assert(typeof value.timedOut==='boolean','Timeout flag required');
 assert(Array.isArray(value.cluesSeen)&&value.cluesSeen.every(x=>CLUE_SECONDS.includes(x)),'Invalid cluesSeen');
 return {rating:value.rating,answerRevealed:value.answerRevealed,elapsedMs:value.elapsedMs,timedOut:value.timedOut,cluesSeen:[...new Set(value.cluesSeen)].sort((a,b)=>a-b)};
}
export function validateProvenance(input){
 assert(input&&typeof input==='object','Media provenance is required');
 assert(['file','slide','web','generated','manual'].includes(input.kind),'Invalid provenance type');
 const origin=txt(input.origin,'source origin',500);
 const sourcePage=input.sourcePage===undefined?null:Number(input.sourcePage);
 assert(sourcePage===null||(Number.isInteger(sourcePage)&&sourcePage>=1&&sourcePage<=10000),'Invalid source page');
 const license=optTxt(input.license,'license',100);
 let licenseEvidenceUrl='',imageUrl='';
 if(input.kind==='web'){
  assert(['CC0','CC-BY','CC-BY-SA','PUBLIC_DOMAIN','EXPLICIT_PERMISSION'].includes(license),'Web media requires documented reusable license');
  licenseEvidenceUrl=txt(input.licenseEvidenceUrl,'license evidence URL',600);
  const source=new URL(origin),evidence=new URL(licenseEvidenceUrl);
  assert(source.protocol==='https:'&&evidence.protocol==='https:','Web origin and license evidence must be HTTPS');
  imageUrl=optTxt(input.imageUrl,'image URL',600);
 }
 return {kind:input.kind,origin,sourcePage,license,licenseEvidenceUrl,imageUrl,attribution:optTxt(input.attribution,'attribution',300),description:optTxt(input.description,'description',500)};
}
export function validateVisualReview(input){
 assert(input&&typeof input==='object','A visual review report is required');
 assert(typeof input.observation==='string'&&input.observation.trim().length>=12&&input.observation.length<=1200,'Describe what was actually seen, not only a verdict');
 assert(typeof input.legible==='boolean','Legibility observation is required');
 assert(typeof input.relevant==='boolean','Relevance observation is required');
 return {observation:input.observation.trim(),legible:input.legible,relevant:input.relevant,reviewer:'model_claim_unverified'};
}
