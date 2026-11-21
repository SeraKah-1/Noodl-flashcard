import {CLUE_SECONDS, MAX_CARDS,normalizeTimer} from '../shared/logic.js';
function assert(condition,message){if(!condition)throw new Error(message);}
function txt(value,label,max=500){assert(typeof value==='string'&&value.trim().length>0&&value.length<=max,`Invalid ${label}`);return value.trim();}
function optTxt(value,label,max=500){if(value===undefined||value===null)return '';assert(typeof value==='string'&&value.length<=max,`Invalid ${label}`);return value.trim();}
export function validateBlock(block){
 assert(block&&typeof block==='object'&&!Array.isArray(block),'Invalid content block');
 switch(block.type){
  case 'text':return {type:'text',text:txt(block.text,'text',1600)};
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
export function validateCard(input){
 assert(input&&typeof input==='object','Invalid card');
 const side=(arr,label)=>{assert(Array.isArray(arr)&&arr.length>0&&arr.length<=8,`Invalid ${label} blocks`);return arr.map(validateBlock);};
 const front=side(input.front,'front'),back=side(input.back,'back');
 const clues=Array.isArray(input.clues)?input.clues:[];
 assert(clues.length===3,'Exactly three clues are required');
 const byTime=[...clues].sort((a,b)=>a.atSecond-b.atSecond);
 assert(byTime.every((c,i)=>c.atSecond===CLUE_SECONDS[i]),'Clues must be at 5, 10, and 15 seconds');
 const clueTexts=byTime.map((c,i)=>({atSecond:CLUE_SECONDS[i],text:txt(c.text,'clue',180)}));
 const tags=Array.isArray(input.tags)?input.tags:[];
 assert(tags.length<=10,'Too many tags');
 return {front,back,clues:clueTexts,timerSeconds:normalizeTimer(input.timerSeconds),tags:tags.map(v=>txt(v,'tag',40))};
}
export function validateDeckInput(input){
 assert(input&&typeof input==='object','Missing deck');
 const title=txt(input.title,'title',120),description=optTxt(input.description,'description',400);
 assert(Array.isArray(input.cards)&&input.cards.length>=1&&input.cards.length<=Math.min(MAX_CARDS,100),'New deck requires 1..100 cards');
 return {title,description,cards:input.cards.map(validateCard)};
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
 if(input.kind==='web')assert(['CC0','CC-BY','CC-BY-SA','PUBLIC_DOMAIN','EXPLICIT_PERMISSION'].includes(license),'Web media requires documented reusable license');
 return {kind:input.kind,origin,sourcePage,license,attribution:optTxt(input.attribution,'attribution',300),description:optTxt(input.description,'description',500)};
}
export function validateVisualReview(input){
 assert(input&&typeof input==='object','A visual review report is required');
 assert(typeof input.observation==='string'&&input.observation.trim().length>=12&&input.observation.length<=1200,'Describe what was actually seen, not only a verdict');
 assert(typeof input.legible==='boolean','Legibility observation is required');
 assert(typeof input.relevant==='boolean','Relevance observation is required');
 return {observation:input.observation.trim(),legible:input.legible,relevant:input.relevant,reviewer:'model_claim_unverified'};
}
