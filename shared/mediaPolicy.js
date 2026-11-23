/** Pure optional-media policy shared by the Worker and browser.
 * Legacy cards without mediaRequirement are valid and never gain a hidden dependency.
 */
export const MEDIA_REQUIREMENTS=Object.freeze(['none','optional','required_for_question']);
export function mediaRequirementOf(card){
 const value=card?.mediaRequirement;
 return MEDIA_REQUIREMENTS.includes(value)?value:'optional';
}
export function imageReferences(card){
 if(!card||typeof card!=='object')return [];
 const from=(blocks,side,pageId=null)=>Array.isArray(blocks)?blocks.filter(b=>b?.type==='image').map(b=>({assetId:b.assetId,alt:b.alt,side,pageId})):[];
 return [
  ...from(card.front,'front'),
  ...from(card.back,'back'),
  ...(Array.isArray(card.backPages)?card.backPages.flatMap(p=>from(p?.blocks,'back',p?.id??null)):[]),
  ...(Array.isArray(card.explanation?.sections)?card.explanation.sections.flatMap(p=>from(p?.blocks,'back',null)):[])
 ];
}
export function frontImageIds(card){return [...new Set(imageReferences(card).filter(r=>r.side==='front').map(r=>r.assetId))];}
export function knownFrontMediaReady(card,media=[]){
 if(mediaRequirementOf(card)!=='required_for_question')return true;
 const ids=frontImageIds(card);
 return ids.length>0&&ids.every(id=>media.some(m=>m.id===id&&m.status==='approved'));
}
