/** Pure flashcard domain utilities. This module runs in browser, Worker, and Node tests. */
export const CLUE_SECONDS = Object.freeze([5,10,15]);
export const MAX_CARDS = 1000;
export function dueClues(seconds) {
  if(!Number.isFinite(seconds)) return [];
  return CLUE_SECONDS.filter(t => seconds >= t);
}
export function dragRating(offsetX,offsetY,velocityX) {
  if (![offsetX,offsetY,velocityX].every(Number.isFinite)) return null;
  const dx=Math.abs(offsetX),dy=Math.abs(offsetY);
  if(dx<22 || dx<dy*1.4) return null;
  if(dx>=92 || (dx>=40 && Math.abs(velocityX)>=800)) return offsetX<0?0:3;
  return null;
}
export function nextSrs(state,rating,date) {
  if (!Number.isInteger(rating)||rating<0||rating>3) throw Error('Invalid rating');
  const current=state||{ease:2.5,intervalDays:0,repetitions:0};
  let {ease,intervalDays,repetitions}=current;
  if(rating===0){repetitions=0;intervalDays=0;ease=Math.max(1.3,ease-.2);}
  else if(rating===1){repetitions=0;intervalDays=1;ease=Math.max(1.3,ease-.15);}
  else {
    intervalDays=repetitions===0?1:repetitions===1?6:Math.max(1,Math.round(intervalDays*ease));
    repetitions++;
    ease=Math.min(3,Math.max(1.3,ease+(rating===3?.1:-.05)));
  }
  // Again is due shortly, but represents a specific event, never a correct/incorrect exam score.
  const dueAt=new Date(new Date(date).getTime()+(rating===0?10*60_000:intervalDays*86400_000)).toISOString();
  return {ease:Number(ease.toFixed(3)),intervalDays,repetitions,dueAt};
}
export function replayReviews(events,cardId,now=new Date().toISOString()) {
  const active=events.filter(e=>e.cardId===cardId&&!e.undoneAt).sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt)||a.id.localeCompare(b.id));
  let state=null;
  for(const e of active)state=nextSrs(state,e.rating,e.reviewedAt);
  return {state:state||{ease:2.5,intervalDays:0,repetitions:0,dueAt:now},reviewCount:active.length,due:!state||state.dueAt<=now};
}
export function normalizeTimer(value) {
  return Number.isInteger(value)&&value>=10&&value<=120?value:20;
}
/** Live clock accumulates only active foreground time; no interval-based drift. */
export class CardClock {
  constructor(durationSeconds=20){this.durationMs=normalizeTimer(durationSeconds)*1000;this.elapsedMs=0;this.runningSince=null;}
  resume(now){if(this.runningSince===null&&this.elapsedMs<this.durationMs)this.runningSince=now;}
  pause(now){if(this.runningSince!==null){this.elapsedMs=Math.min(this.durationMs,this.elapsedMs+Math.max(0,now-this.runningSince));this.runningSince=null;}}
  elapsed(now){return Math.min(this.durationMs,this.elapsedMs+(this.runningSince===null?0:Math.max(0,now-this.runningSince)));}
  seconds(now){return Math.floor(this.elapsed(now)/1000);}
  expired(now){return this.elapsed(now)>=this.durationMs;}
  restart(now){this.elapsedMs=0;this.runningSince=now;}
}
