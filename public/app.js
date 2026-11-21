import {CardClock,dueClues,dragRating,replayReviews} from '/shared/logic.js';
// For static hosting, shared logic is copied at /shared/logic.js by build/deployment.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const main=$('#main'),modalRoot=$('#modalRoot');
const uuid=()=>crypto.randomUUID();
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const defaults={sound:true,haptics:true,timer:true,clues:true,reducedMotion:false,showSource:true};
const state={route:'home',backend:'local',ownerId:'local',decks:[],reviews:[],media:[],visualBindings:[],queue:[],settings:{...defaults},session:null,modal:null,search:'',busy:false,prevReview:null,initialized:false};
let store=null,toastTimer=null,rafId=null;
const mediaFallbackPending=new Map(),mediaFallbackFailed=new Set();
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400);}
function clockMs(){return performance.now()}
function renderStatus(){const n=$('#syncStatus');n.textContent=state.backend==='embedded'?'ChatGPT MCP':state.backend==='web'?'Cloud sync':'Mode lokal';}
async function openStore(owner){
 const req=indexedDB.open('noodl-fc:'+encodeURIComponent(owner),1);
 return await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>req.result.createObjectStore('kv');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
}
async function dbGet(key){if(!store)return undefined;return new Promise((resolve,reject)=>{const tx=store.transaction('kv','readonly'),q=tx.objectStore('kv').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function dbSet(key,value){if(!store)return;return new Promise((resolve,reject)=>{const tx=store.transaction('kv','readwrite');tx.objectStore('kv').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function persist(){await dbSet('state',{decks:state.decks,reviews:state.reviews,media:state.backend==='local'?state.media:state.media.map(({dataUrl,...meta})=>meta),visualBindings:state.visualBindings,queue:state.queue,settings:state.settings});}
function demoDeck(){return {id:'demo-noodl',title:'Sistem Saraf — Demo',description:'Kartu contoh untuk menguji swipe, timer, clue, dan review.',revision:1,updatedAt:new Date().toISOString(),cards:[
 {id:'demo-1',front:[{type:'text',text:'Apa fungsi utama mielin pada akson neuron?'}],back:[{type:'text',text:'Meningkatkan kecepatan hantaran impuls melalui konduksi saltatori.'}],clues:[{atSecond:5,text:'Berhubungan dengan lapisan pembungkus akson.'},{atSecond:10,text:'Fokus pada kecepatan rambat sinyal.'},{atSecond:15,text:'Impuls melompat antar nodus Ranvier.'}],timerSeconds:20,tags:['Neuroanatomi']},
 {id:'demo-2',front:[{type:'text',text:'Bagian neuron apa yang biasanya menerima sinyal dari sel lain?'}],back:[{type:'text',text:'Dendrit; sinyal kemudian diintegrasikan menuju badan sel.'}],clues:[{atSecond:5,text:'Struktur berbentuk cabang.'},{atSecond:10,text:'Letaknya di sekitar soma.'},{atSecond:15,text:'Namanya dimulai dengan huruf D.'}],timerSeconds:20,tags:['Neuroanatomi']},
 {id:'demo-3',front:[{type:'text',text:'Neurotransmiter utama di sambungan neuromuskular adalah?'}],back:[{type:'text',text:'Asetilkolin (acetylcholine).'}],clues:[{atSecond:5,text:'Molekul pengantar sinyal ke otot.'},{atSecond:10,text:'Berikatan dengan reseptor nikotinik.'},{atSecond:15,text:'Disingkat ACh.'}],timerSeconds:20,tags:['Fisiologi']},
 {id:'demo-4',front:[{type:'text',text:'Di mana impuls saraf mulai dipicu pada sebagian besar neuron?'}],back:[{type:'text',text:'Segmen awal akson, dekat axon hillock.'}],clues:[{atSecond:5,text:'Bukan di ujung dendrit.'},{atSecond:10,text:'Berdekatan dengan badan sel.'},{atSecond:15,text:'Daerah pemicu potensial aksi di awal akson.'}],timerSeconds:20,tags:['Fisiologi']},
 {id:'demo-5',front:[{type:'text',text:'Apa fungsi sel Schwann pada sistem saraf perifer?'}],back:[{type:'text',text:'Membentuk mielin pada akson sistem saraf perifer dan membantu regenerasi.'}],clues:[{atSecond:5,text:'Termasuk sel glia.'},{atSecond:10,text:'Berkaitan dengan mielin di saraf perifer.'},{atSecond:15,text:'Bukan oligodendrosit.'}],timerSeconds:20,tags:['Neuroanatomi']}
 ]};}
function looksEmbedded(){return window.parent!==window||new URLSearchParams(location.search).get('embedded')==='1'}
function normalizeToolResult(result){if(result?.isError)throw Error(result?.content?.map?.(x=>x.text).join('\n')||'MCP tool failed');return result?.structuredContent??result?.result?.structuredContent??result;}
async function hostCall(name,args={}){if(window.openai?.callTool)return normalizeToolResult(await window.openai.callTool(name,args));throw Error('Embedded host tool API not available');}
async function fetchCloud(){
 if(looksEmbedded()&&window.openai?.callTool){const data=await hostCall('app_snapshot');return {data,backend:'embedded'};}
 const resp=await fetch('/api/snapshot',{credentials:'same-origin',cache:'no-store'});if(!resp.ok)throw Error('Cloud API unavailable');return {data:await resp.json(),backend:'web'};
}
async function initialize(){
 try{
  let cloud=null;try{cloud=await fetchCloud();}catch{}
  const owner=cloud?.data?.ownerId||'local';state.ownerId=owner;
  store=await openStore(owner);
  const cached=await dbGet('state')||{};
  state.queue=cached.queue||[];state.settings={...defaults,...cached.settings};
  if(cloud){state.backend=cloud.backend;const pending=state.queue.filter(q=>q.kind==='review').map(q=>q.payload);
   state.decks=cloud.data.decks||[];state.reviews=[...(cloud.data.reviews||[]),...pending.filter(p=>!(cloud.data.reviews||[]).some(x=>x.id===p.operationId)).map(p=>({...p,id:p.operationId,reviewedAt:p.reviewedAt||new Date().toISOString()}))];state.media=cloud.data.media||[];state.visualBindings=cloud.data.visualBindings||[];
  }else{state.backend='local';state.decks=cached.decks||[demoDeck()];state.reviews=cached.reviews||[];state.media=cached.media||[];state.visualBindings=cached.visualBindings||[];}
  state.initialized=true;await persist();renderStatus();applySettings();navigate(location.hash.slice(1)||'home');
  if(state.backend!=='local')void flushQueue();
 }catch(e){main.innerHTML=`<div class="empty"><h2>Data lokal tidak tersedia</h2><p>${safe(e.message)}</p><button class="button secondary" id="retryInit">Coba lagi</button></div>`;$('#retryInit')?.addEventListener('click',initialize);}
}
function applySettings(){document.documentElement.dataset.reducedMotion=state.settings.reducedMotion?'true':'false'}
function summary(){const cards=state.decks.flatMap(d=>d.cards||[]),now=new Date().toISOString();let due=0,studied=0;
 for(const card of cards){const r=replayReviews(state.reviews,card.id,now);if(r.due)due++;if(r.reviewCount)studied++;}
 return {decks:state.decks.length,cards:cards.length,due,studied};}
function navigate(to){
 if(state.session&&to!=='player')stopSession();
 const valid=['home','library','review','settings','player'];if(!valid.includes(to))to='home';state.route=to;document.body.classList.toggle('in-player',to==='player');
 if(to!=='player')history.replaceState(null,'','#'+to);
 $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.nav===to));
 render();
}
function deckTile(deck){return `<button class="deck-tile" data-open-deck="${safe(deck.id)}"><span class="deck-icon">▧</span><div><h3>${safe(deck.title)}</h3><p>${safe(deck.description||'Kumpulan flashcard untuk belajar aktif.')}</p></div><div class="tile-foot"><span>${(deck.cards||[]).length} kartu</span><span>Buka ↗</span></div></button>`}
function renderHome(){const m=summary(),recent=state.decks.slice(0,3);
 return `<div class="screen"><section class="hero"><div><span class="kicker">✦ YOUR LITTLE STUDY SPACE</span><h1>Belajar dikit.<br><span>Ingat lama.</span></h1><p>Satu kartu, satu ide. Geser kapan saja, intip petunjuk bertahap, lalu ulangi yang belum menempel di kepala.</p><div class="hero-actions"><button class="button primary" data-nav="review">◈ Mulai review</button><button class="button secondary" data-chat="1">✧ Buat dengan ChatGPT</button></div></div><div class="hero-card"><div class="hero-mascot">( ◕ ‿ ◕ )</div><small>YOU'VE GOT THIS ✦</small><p>Jangan buru-buru membaliknya. Biar otak mencoba dulu.</p></div></section><section class="stats"><div class="stat"><div class="number">${m.decks}</div><div class="label">Deck tersimpan</div></div><div class="stat"><div class="number">${m.cards}</div><div class="label">Total flashcard</div></div><div class="stat"><div class="number">${m.due}</div><div class="label">Siap direview</div></div></section><div class="split-head"><div><h2 class="section-heading">Kartu yang menemanimu</h2><p class="section-sub">Deck terbaru di perpustakaanmu.</p></div><button class="muted-link" data-nav="library">Lihat semua →</button></div>${recent.length?`<div class="deck-grid">${recent.map(deckTile).join('')}</div>`:`<div class="empty"><div class="empty-face">(・_・;)</div><h3>Belum ada deck</h3><p>Minta ChatGPT membuat flashcard dan menyimpannya melalui MCP.</p><button class="button primary" data-chat="1">Buat deck baru ✧</button></div>`}<p class="tagline">NOODL FLASHCARDS · CREATED WITH CHATGPT, REMEMBERED BY YOU</p></div>`;
}
function renderLibrary(){const filtered=state.decks.filter(d=>(d.title+' '+d.description).toLowerCase().includes(state.search.toLowerCase()));
 return `<div class="screen"><div style="padding-top:38px"><span class="kicker">YOUR COLLECTION</span><h1 class="page-title">My decks <span style="color:var(--violet)">✦</span></h1><p class="page-intro">Semuanya tersimpan rapi. Tidak ada bank soal atau pengaturan generator yang numpang hidup di sini.</p></div><div class="library-tools"><input class="search" id="deckSearch" placeholder="Cari deck..." value="${safe(state.search)}" aria-label="Cari deck"/><button class="button primary" data-chat="1">✧ Deck baru</button></div>${filtered.length?`<div class="deck-grid">${filtered.map(deckTile).join('')}</div>`:`<div class="empty"><p>Deck tidak ditemukan.</p></div>`}<div class="notice">${state.backend==='local'?'Kamu sedang memakai mode lokal. Contoh deck dan progres review tersimpan di browser ini. Hubungkan deployment MCP agar ChatGPT dapat menyimpan deck ke akun yang sama.':'Deck dari ChatGPT tersinkronkan ke akun yang sedang terhubung. Gambar yang belum disetujui tidak dapat digunakan sebagai isi kartu.'}</div></div>`;
}
function renderReview(){const m=summary();return `<div class="screen narrow"><div style="padding-top:38px"><span class="kicker">PRACTICE MAKES PERMANENT</span><h1 class="page-title">Review <span style="color:var(--violet)">◈</span></h1><p class="page-intro">Tidak harus menunggu jawaban terbuka untuk swipe. Sebelum dibalik, rating hanyalah penilaian diri—bukan bukti benar.</p></div><section class="stats"><div class="stat"><div class="number">${m.due}</div><div class="label">Perlu review</div></div><div class="stat"><div class="number">${m.studied}</div><div class="label">Pernah dipelajari</div></div><div class="stat"><div class="number">${m.cards}</div><div class="label">Semua kartu</div></div></section><div class="settings-panel"><h3>Pilih deck</h3>${state.decks.length?state.decks.map(d=>`<div class="media-row"><div class="deck-icon">▧</div><div class="summary"><strong>${safe(d.title)}</strong><small>${d.cards.length} kartu</small></div><button class="button secondary" data-start-deck="${safe(d.id)}">Belajar →</button></div>`).join(''):'<p>Belum ada deck.</p>'}</div><div class="notice">Clue muncul pada detik ke-5, 10, dan 15. Pada detik ke-20, timer berhenti tanpa menilai kartu secara otomatis. Saat tab tidak aktif, waktu dijeda.</div></div>`;}
function renderSettings(){return `<div class="screen narrow"><div style="padding-top:38px"><span class="kicker">MAKE IT YOURS</span><h1 class="page-title">Settings ⚙</h1><p class="page-intro">Noodl sesederhana yang diperlukan. Sesuaikan cara belajarnya.</p></div><div class="settings-panel"><h3>Pengalaman flashcard</h3>${[['timer','Timer 20 detik','Jeda saat tab tak terlihat atau jawaban dibuka.'],['clues','Tiga clue bertahap','Clue pada detik 5, 10, dan 15.'],['sound','Sound feedback','Efek suara pendek saat berinteraksi.'],['haptics','Getaran ringan','Hanya jika didukung perangkat.'],['reducedMotion','Kurangi animasi','Kurangi efek flip dan gerakan.'],['showSource','Tampilkan sumber gambar','Sumber, lisensi, dan status review.']].map(([key,label,desc])=>`<label class="toggle-row"><div><strong>${label}</strong><p>${desc}</p></div><input type="checkbox" data-setting="${key}" ${state.settings[key]?'checked':''}/></label>`).join('')}</div><div class="settings-panel"><h3>Media & pemeriksaan visual</h3><p class="note">Gambar wajib diverifikasi format, dimensi, dan kecocokan visual. Tanpa persetujuan pratinjau, kartu tidak boleh menggunakan aset baru.</p><div class="upload"><input id="mediaFile" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Unggah satu atau beberapa gambar"/><button class="button secondary" id="uploadMedia">Unggah gambar</button></div><div id="mediaList">${state.media.length?state.media.map(mediaRow).join(''):'<p class="note">Belum ada gambar. Unggah PNG, JPEG atau WebP.</p>'}</div></div><div class="settings-panel"><h3>Pemeriksaan gambar per kartu</h3><p class="note">Persetujuan aset belum membuktikan kecocokannya dengan sebuah kartu. Dua laporan sumber dan visual harus diikuti persetujuanmu untuk kartu tertentu.</p><div id="visualBindingList">${state.visualBindings.length?state.visualBindings.map(bindingRow).join(''):'<p class="note">Belum ada kandidat. Pilih tombol Pasang pada gambar yang sudah disetujui, lalu minta ChatGPT melakukan dua pemeriksaan MCP.</p>'}</div></div><div class="settings-panel"><h3>Akun & penyimpanan</h3><p class="note">Status: <strong>${state.backend==='local'?'Lokal / browser':state.backend==='embedded'?'ChatGPT MCP':'Cloud'}</strong>. Database lokal dipisah berdasarkan identitas akun. Media cloud tersimpan di bucket privat.</p><button class="button secondary" id="refreshData">↻ Sinkronkan sekarang</button><button class="button secondary" id="exportLocal" style="margin-left:7px">Ekspor data JSON</button></div></div>`;}
function mediaRow(m){return `<div class="media-row"><img class="media-thumb" data-media-id="${safe(m.id)}" src="${safe(mediaSrc(m.id))}" alt="Pratinjau media"/><div class="summary"><strong>${safe(m.provenance?.origin||m.id)}</strong><small class="${safe(m.status)}">${safe(m.status)} · ${m.width}×${m.height} · ${safe(m.provenance?.kind||'file')}</small></div>${m.status==='pending'?`<button class="button secondary" data-preview="${safe(m.id)}">Periksa</button>`:m.status==='approved'?`<button class="button secondary" data-preview="${safe(m.id)}">Lihat</button><button class="button primary" data-attach-image="${safe(m.id)}">Pilih kartu</button>`:'<span class="chip">Ditolak</span>'}</div>`;}
function bindingRow(b){const label=state.decks.flatMap(d=>d.cards?.map(c=>({d,c}))||[]).find(x=>x.c.id===b.cardId);return `<div class="media-row"><img class="media-thumb" data-media-id="${safe(b.mediaId)}" src="${safe(mediaSrc(b.mediaId))}" alt="Visual kandidat"/><div class="summary"><strong>${safe(label?.c?.front?.find(x=>x.type==='text')?.text||'Kartu '+b.cardId).slice(0,110)}</strong><small>${safe(b.status)} · ${safe(b.provenance?.origin||'Sumber')} · ${safe(b.side)}</small></div>${b.status==='awaiting_user_approval'?`<button class="button primary" data-review-binding="${safe(b.bindingId)}">Periksa untuk kartu</button>`:b.status==='approved_for_card'?`<button class="button primary" data-attach-binding="${safe(b.bindingId)}">Pasang</button>`:`<button class="button secondary" data-review-binding="${safe(b.bindingId)}">Audit</button>`}</div>`}
function render(){if(!state.initialized)return;cancelAnimationFrame(rafId);if(state.route==='home')main.innerHTML=renderHome();else if(state.route==='library')main.innerHTML=renderLibrary();else if(state.route==='review')main.innerHTML=renderReview();else if(state.route==='settings')main.innerHTML=renderSettings();else if(state.route==='player')renderPlayer();}
function mediaSrc(id){const media=state.media.find(x=>x.id===id);if(!media||media.status==='rejected')return '';if(media.dataUrl&&/^data:image\/(?:png|jpeg|webp);base64,/.test(media.dataUrl))return media.dataUrl;if(/^[a-f0-9-]{36}$/i.test(id))return '/api/media/'+encodeURIComponent(id);return '';}
// A private image may fail to load via relative /api URLs in a sandboxed ChatGPT iframe.
// Rehydrate exact stored R2 bytes through read-only, owner-checked MCP calls instead of showing broken images.
async function ensureMediaViaMcp(id){
 const m=state.media.find(x=>x.id===id);
 if(m?.dataUrl)return m.dataUrl;
 if(state.backend!=='embedded'||!m||mediaFallbackFailed.has(id))throw Error('No authenticated media fallback');
 if(mediaFallbackPending.has(id))return mediaFallbackPending.get(id);
 const task=(async()=>{
  const chunks=[],count=Math.ceil(m.bytes/(96*1024));
  if(!Number.isInteger(count)||count<1||count>43)throw Error('Stored media size is invalid');
  for(let i=0;i<count;i++){
   const part=await hostCall('app_get_media_chunk',{mediaId:id,index:i});
   if(part.mediaId!==id||part.index!==i||part.chunkCount!==count||part.bytes!==m.bytes||part.mime!==m.mime||part.sha256!==m.sha256)throw Error('Stored media chunk metadata mismatch');
   chunks.push(part.base64);
  }
  // Every chunk is independently base64-padded: never concatenate encoded chunks directly.
  const bytes=new Uint8Array(m.bytes);let offset=0;
  for(const part of chunks){
   const binary=atob(part);
   if(offset+binary.length>bytes.length)throw Error('Stored media chunk exceeds file size');
   for(let i=0;i<binary.length;i++)bytes[offset+i]=binary.charCodeAt(i);
   offset+=binary.length;
  }
  if(offset!==m.bytes)throw Error('Reconstructed image size does not match');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==m.sha256)throw Error('Reconstructed image checksum mismatch');
  let full='';for(let i=0;i<bytes.length;i+=8192)full+=String.fromCharCode(...bytes.subarray(i,i+8192));
  m.dataUrl=`data:${m.mime};base64,${btoa(full)}`;
  for(const image of document.querySelectorAll('img[data-media-id]'))if(image.dataset.mediaId===id)image.src=m.dataUrl;
  return m.dataUrl;
 })();
 mediaFallbackPending.set(id,task);
 try{return await task;}catch(e){mediaFallbackFailed.add(id);throw e;}finally{mediaFallbackPending.delete(id);}
}
document.addEventListener('error',event=>{
 const img=event.target;
 if(!(img instanceof HTMLImageElement)||!img.dataset.mediaId||state.backend!=='embedded')return;
 const id=img.dataset.mediaId;if(mediaFallbackFailed.has(id))return;
 void ensureMediaViaMcp(id).catch(e=>{console.warn('Image could not be read from private MCP storage',e.message)});
},true);
function blocksHtml(blocks){return (blocks||[]).map(b=>{
 if(b.type==='text')return `<div class="block-text">${safe(b.text)}</div>`;
 if(b.type==='math')return `<div class="math" role="math" aria-label="${safe(b.latex)}">${safe(b.latex)}</div>`;
 if(b.type==='image'){
  const img=mediaSrc(b.assetId),m=state.media.find(x=>x.id===b.assetId),label=m?.provenance?.origin;
  if(!img||m?.status!=='approved')return `<p class="note">Gambar tidak tersedia / belum disetujui.</p>`;
  return `<figure><img src="${safe(img)}" alt="${safe(b.alt)}" data-media-id="${safe(b.assetId)}" data-zoom="${safe(b.assetId)}" loading="eager"/><figcaption>${safe(b.alt)}${state.settings.showSource&&label?` · ${safe(label)}`:''}</figcaption></figure>`;
 }
 if(b.type==='embed'){
  try{const url=new URL(b.url);if(url.protocol!=='https:'||!['www.youtube-nocookie.com','www.youtube.com','youtu.be','player.vimeo.com','vimeo.com'].includes(url.hostname))return '<p>Embed tidak didukung.</p>';
   let embed='';
   if(url.hostname.includes('youtu')){const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v')||url.pathname.split('/').filter(Boolean).at(-1);if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))return '<p class="note">ID video YouTube tidak valid.</p>';embed=`https://www.youtube-nocookie.com/embed/${id}`;}
   else {const id=url.pathname.split('/').filter(Boolean).at(-1);if(!/^\d{1,15}$/.test(id||''))return '<p class="note">ID video Vimeo tidak valid.</p>';embed=`https://player.vimeo.com/video/${id}`;}
   return `<div class="notice embedded-video"><p>Video eksternal: ${safe(url.hostname)}. Muat hanya jika kamu memilihnya; provider bisa menerima data koneksi.</p><button class="button secondary" data-load-embed="${safe(embed)}">▶ Tampilkan video</button> <a class="button ghost" href="${safe(url.toString())}" target="_blank" rel="noopener noreferrer">Buka sumber ↗</a></div>`;
  }catch{return '<p>Embed tidak valid.</p>'}
 }
 return '';
 }).join('')}
function startDeck(id,onlyDue=false){const deck=state.decks.find(x=>x.id===id);if(!deck||!deck.cards?.length){toast('Deck tidak memiliki kartu.');return;}
 const cards=onlyDue?deck.cards.filter(c=>replayReviews(state.reviews,c.id).due):deck.cards;
 if(!cards.length){toast('Belum ada kartu yang jatuh tempo.');return;}
 const session={deck,cards,index:0,flipped:false,clock:null,cluesSeen:[],lastClue:0,processing:false,started:false};state.session=session;state.prevReview=null;state.route='player';document.body.classList.add('in-player');history.replaceState(null,'','#review');initCard();render();}
function initCard(){const s=state.session;if(!s)return;s.flipped=false;s.cluesSeen=[];s.lastClue=0;s.started=false;s.clock=new CardClock(state.settings.timer?s.cards[s.index]?.timerSeconds||20:20);s.clock.resume(clockMs());}
function stopSession(){if(state.session?.clock)state.session.clock.pause(clockMs());state.session=null;cancelAnimationFrame(rafId)}
function playerCard(){const s=state.session;return s?.cards[s.index]}
function renderPlayer(){const s=state.session;if(!s)return navigate('review');const card=playerCard();
 if(!card){main.innerHTML=`<div class="screen narrow" style="text-align:center;padding-top:80px"><div class="hero-mascot">(≧▽≦)</div><h1 class="page-title">Sesi selesai!</h1><p class="page-intro">${s.cards.length} kartu sudah kamu lewati. Rating tersimpan tanpa mengarang skor benar/salah.</p><div class="hero-actions" style="justify-content:center"><button class="button primary" data-nav="review">Ke Review</button><button class="button secondary" data-nav="library">My decks</button></div></div>`;return;}
 const n=s.index+1,len=s.cards.length,revealed=s.flipped,enterClass=s.enterDirection>0?'enter-from-left':s.enterDirection<0?'enter-from-right':'',clues=s.cluesSeen.map(t=>card.clues?.find(c=>c.atSecond===t)).filter(Boolean);
 main.innerHTML=`<div class="screen narrow"><div class="session-head"><div><button class="button ghost" data-nav="review">← Kembali</button></div><div style="text-align:center"><h2 class="session-title">${safe(s.deck.title)}</h2><p class="session-sub">FLASHCARDS · ${n} / ${len}</p></div><div><button class="button ghost" id="playerUndo" ${state.prevReview?'':'disabled'}>↶ Undo</button></div></div><div class="progress-rail"><div class="progress-bar" style="width:${(s.index/len)*100}%"></div></div><div class="timer-line"><span>✦ ${revealed?'Jawaban terbuka': 'Ingat dulu, baru balik'}</span><span id="timerPill" class="timer-pill">${state.settings.timer?'20s':'Santai'}</span></div><div class="flash-stage" id="flashStage" aria-label="Kartu flashcard; geser kiri atau kanan dari area mana saja"><div class="flash-behind"></div><div class="swipe-sticker left" id="stickerLeft">BELUM TAHU</div><div class="swipe-sticker right" id="stickerRight">TAHU</div><div class="flash-motion ${enterClass}" id="flashMotion"><div class="flash-scene ${revealed?'flipped':''}" id="flashScene"><div class="flash-face front"><div class="face-top"><span>PERTANYAAN</span><span>NOODL ◈</span></div><div class="face-content">${blocksHtml(card.front)}</div><div class="face-footer">Ketuk untuk balik · geser dari area mana saja</div></div><div class="flash-face back"><div class="face-top"><span>JAWABAN</span><span>FLASHCARD ✦</span></div><div class="face-content answer">${blocksHtml(card.back)}</div><div class="face-footer">Nilai sesuai ingatanmu, bukan tebakanmu</div></div></div></div></div><div class="clue-card" id="clueBox"><span class="info-icon">✦</span><div id="clueText">${revealed?'Jawaban dibuka. Timer dijeda.':'Clue pertama muncul pada detik ke-5.'}</div><button class="reveal-clues" id="showClues" ${clues.length?'':'disabled'}>Clue (${clues.length})</button></div><div id="ratingControls">${revealed?renderRatings():renderSwipeGuide()}</div><div class="player-controls"><button class="button secondary" id="playerFlip">${revealed?'↶ Lihat depan':'↻ Balik kartu'}</button><button class="button ghost" id="playerSkip">Lewati →</button></div><p class="session-meta">Swipe kiri / kanan termasuk di tengah kartu · Space: balik · 1–4: rating setelah flip · Z: undo. ${state.backend==='local'?'Data tersimpan di browser.':'Penyimpanan lokal dahulu, sinkronisasi kemudian.'}</p></div>`;
 s.enterDirection=0;bindGestures();bindPlayerButtons();tick();
}
function renderRatings(){return `<div class="rating-grid">${[['Lupa','0','forget','↶'],['Sulit','1','','◌'],['Bagus','2','','✓'],['Mudah','3','easy','✦']].map(([text,rating,cls,icon])=>`<button class="rating ${cls}" data-rating="${rating}"><span>${icon}</span>${text}<small>${Number(rating)+1} / ${rating==='0'?'←':rating==='3'?'→':'tap'}</small></button>`).join('')}</div>`}
function renderSwipeGuide(){return `<div class="swipe-guide"><span class="left">← Belum tahu</span><span>Swipe tanpa harus membalik</span><span class="right">Sudah tahu →</span></div>`}
function updateClueDisplay(){const s=state.session;if(!s||s.flipped)return;const card=playerCard();if(!card)return;const latest=s.cluesSeen.at(-1),c=card.clues?.find(x=>x.atSecond===latest),txt=$('#clueText');if(txt)txt.textContent=c?`Petunjuk ${s.cluesSeen.length}: ${c.text}`:'Clue pertama muncul pada detik ke-5.';const btn=$('#showClues');if(btn){btn.disabled=!s.cluesSeen.length;btn.textContent=`Clue (${s.cluesSeen.length})`;}}
function tick(){cancelAnimationFrame(rafId);const s=state.session;if(!s||state.route!=='player'||!playerCard())return;
 const now=clockMs(),elapsed=state.settings.timer?s.clock.seconds(now):0;
 if(state.settings.timer){const remain=Math.max(0,Math.ceil((s.clock.durationMs-s.clock.elapsed(now))/1000));const pill=$('#timerPill');if(pill){pill.textContent=remain+'s';pill.classList.toggle('expired',remain===0);}}
 if(state.settings.timer&&state.settings.clues&&!s.flipped){const newly=dueClues(elapsed).filter(x=>!s.cluesSeen.includes(x));
  if(newly.length){s.cluesSeen.push(...newly);const latest=playerCard().clues?.find(c=>c.atSecond===newly.at(-1));if(latest){toast(`✦ Clue ${s.cluesSeen.length}: ${latest.text}`);playTone(690,.055);}updateClueDisplay();}
 }
 if(state.settings.timer&&s.clock.expired(now)&&!s.started){s.started=true;toast('20 detik habis. Kamu boleh membuka jawaban atau swipe.');}
 rafId=requestAnimationFrame(tick);
}
function flip(){const s=state.session;if(!s||s.processing)return;s.flipped=!s.flipped;
 if(s.flipped){s.clock.pause(clockMs());}else if(document.visibilityState==='visible'){s.clock.resume(clockMs());}
 $('#flashScene')?.classList.toggle('flipped',s.flipped);$('#ratingControls').innerHTML=s.flipped?renderRatings():renderSwipeGuide();$('#playerFlip').textContent=s.flipped?'↶ Lihat depan':'↻ Balik kartu';$('.timer-line span:first-child').textContent=s.flipped?'✦ Jawaban terbuka':'✦ Ingat dulu, baru balik';if(s.flipped){$('#clueText').textContent='Jawaban dibuka. Timer dijeda.';}else updateClueDisplay();}
function bindPlayerButtons(){
 $('#playerFlip')?.addEventListener('click',flip);
 $('#playerSkip')?.addEventListener('click',()=>advanceNoRating());
 $('#playerUndo')?.addEventListener('click',()=>void undo());
 $('#showClues')?.addEventListener('click',()=>{
  const s=state.session;if(!s||!s.cluesSeen.length)return;
  const list=s.cluesSeen.map(t=>playerCard().clues.find(x=>x.atSecond===t)?.text).filter(Boolean);
  toast(list.join(' · '));
 });
}
/**
 * A single Pointer Events surface covers the entire card, including its scrollable
 * central content and image. Capture keeps the gesture alive after leaving the card;
 * the pan-y touch-action keeps vertical scrolling native on mobile. We only steal a
 * gesture after it is unambiguously horizontal, so vertical text scrolling still works.
 */
function bindGestures(){
 const stage=$('#flashStage'),motion=$('#flashMotion'),left=$('#stickerLeft'),right=$('#stickerRight');
 if(!stage||!motion)return;
 let pointer=null,paintFrame=0,suppressClickUntil=0;
 const reduced=()=>state.settings.reducedMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const paint=()=>{
  paintFrame=0;
  if(!pointer||pointer.axis!=='horizontal')return;
  const x=pointer.dx, width=Math.max(260,stage.clientWidth);
  const shown=Math.max(-width*.67,Math.min(width*.67,x));
  const ratio=Math.min(1,Math.abs(x)/Math.max(92,width*.22));
  motion.style.transform=`translate3d(${shown}px,0,0) rotate(${reduced()?0:shown/width*12}deg)`;
  motion.style.opacity=String(1-ratio*.16);
  left.style.opacity=String(x<0?ratio:0);
  right.style.opacity=String(x>0?ratio:0);
 };
 const reset=()=>{
  if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0;}
  motion.classList.remove('is-dragging');
  motion.style.transform='';motion.style.opacity='';
  left.style.opacity='0';right.style.opacity='0';
 };
 const finishCapture=id=>{try{if(stage.hasPointerCapture(id))stage.releasePointerCapture(id);}catch{}};
 stage.addEventListener('pointerdown',e=>{
  if(pointer||state.session?.processing||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;
  // Real controls remain clickable. Images are deliberately NOT excluded: users
  // can swipe over their center, or simply tap to open the full-size preview.
  if(e.target instanceof Element&&e.target.closest('button,a,iframe,input,textarea,select,[contenteditable="true"]'))return;
  pointer={id:e.pointerId,x:e.clientX,y:e.clientY,at:performance.now(),dx:0,dy:0,axis:'pending',
   zoomTarget:e.target instanceof Element&&!!e.target.closest('[data-zoom]'),samples:[{x:e.clientX,t:performance.now()}]};
  // Preserve native click on images; capture only if that touch becomes a drag.
  if(!pointer.zoomTarget)try{stage.setPointerCapture(e.pointerId);}catch{}
 });
 stage.addEventListener('pointermove',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
  if(pointer.axis==='pending'){
   if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.12){pointer.axis='vertical';return;}
   if(Math.abs(dx)<8||Math.abs(dx)<=Math.abs(dy)*1.1)return;
   pointer.axis='horizontal';motion.classList.add('is-dragging');
   if(pointer.zoomTarget)try{stage.setPointerCapture(e.pointerId);}catch{}
  }
  if(pointer.axis!=='horizontal')return;
  pointer.dx=dx;pointer.dy=dy;
  const now=performance.now();pointer.samples.push({x:e.clientX,t:now});
  pointer.samples=pointer.samples.filter(p=>now-p.t<=100).slice(-8);
  if(e.cancelable)e.preventDefault();
  if(!paintFrame)paintFrame=requestAnimationFrame(paint);
 });
 const done=(e,cancelled)=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const p=pointer;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;
  pointer=null;
  finishCapture(p.id);
  if(p.axis==='horizontal'){
   // Sampling recent movement lets a deliberate short flick commit, while a
   // long drag works even when released slowly after moving left/right/back.
   const recent=p.samples.find(s=>s.t>=performance.now()-100)||p.samples[0];
   const dt=Math.max(16,performance.now()-recent.t);
   const velocity=(e.clientX-recent.x)/dt*1000;
   const rating=cancelled?null:dragRating(dx,dy,velocity);
   // Native click may follow a touch/pointer release, especially over an image.
   suppressClickUntil=performance.now()+350;
   if(rating!==null){
    if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0;}
    p.dx=dx;p.dy=dy;pointer=p;paint();pointer=null;
    motion.classList.remove('is-dragging');
    void rate(rating,{swipeDirection:Math.sign(dx)});
   }else reset();
  }else if(!cancelled&&p.axis==='pending'&&!p.zoomTarget){
   reset();flip();
  }else reset();
 };
 stage.addEventListener('pointerup',e=>done(e,false));
 stage.addEventListener('pointercancel',e=>done(e,true));
 stage.addEventListener('lostpointercapture',e=>{
  // The old child (e.g. IMG) loses implicit touch capture when the stage
  // takes over. That event bubbles: do not mistake it for stage cancellation.
  if(e.target===stage&&pointer?.id===e.pointerId){pointer=null;reset();}
 });
 // Native image dragging (desktop) otherwise steals pointer events mid-swipe.
 stage.addEventListener('dragstart',e=>e.preventDefault());
 // Stop a delayed click from reaching the document-level media zoom handler.
 stage.addEventListener('click',e=>{
  if(performance.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}
 },true);
}
function animateSwipeExit(direction){
 const motion=$('#flashMotion'),stage=$('#flashStage');
 if(!motion||!stage||state.settings.reducedMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve();
 motion.classList.remove('is-dragging');
 return new Promise(resolve=>{
  requestAnimationFrame(()=>{
   // Leave the full viewport, not merely the original 135px drag clamp.
   motion.classList.add('swipe-exiting');
   motion.style.transform=`translate3d(${direction*(stage.clientWidth+130)}px,0,0) rotate(${direction*14}deg)`;
   motion.style.opacity='0';
  });
  setTimeout(resolve,205);
 });
}
function advanceNoRating(){const s=state.session;if(!s||s.processing)return;s.index++;initCard();renderPlayer();}
async function rate(rating,options={}){const s=state.session;if(!s||s.processing||!playerCard())return;
 if(!s.flipped&&!([0,3].includes(rating)))return;
 s.processing=true;s.clock.pause(clockMs());const c=playerCard(),elapsedMs=Math.floor(s.clock.elapsed(clockMs()));
 const event={id:uuid(),operationId:null,deckId:s.deck.id,cardId:c.id,rating,answerRevealed:s.flipped,cluesSeen:[...s.cluesSeen],elapsedMs,timedOut:state.settings.timer&&s.clock.expired(clockMs()),reviewedAt:new Date().toISOString(),undoneAt:null};event.operationId=event.id;
 try{
  state.reviews.push(event);if(state.backend!=='local')state.queue.push({kind:'review',payload:event});
  await Promise.all([persist(),options.swipeDirection?animateSwipeExit(options.swipeDirection):Promise.resolve()]);state.prevReview={event,index:s.index};
  playTone(rating===0?290:690,.085);vibrate(10);s.index++;initCard();s.enterDirection=options.swipeDirection||0;s.processing=false;renderPlayer();if(state.backend!=='local')void flushQueue();
 }catch(error){state.reviews=state.reviews.filter(x=>x.id!==event.id);state.queue=state.queue.filter(q=>q.payload?.id!==event.id);s.processing=false;const motion=$('#flashMotion');if(motion){motion.classList.remove('swipe-exiting','is-dragging');motion.style.transform='';motion.style.opacity='';}toast('Review gagal disimpan: '+error.message);}
}
async function undo(){const prev=state.prevReview,s=state.session;if(!prev||!s||s.processing)return;s.processing=true;
 const event=state.reviews.find(x=>x.id===prev.event.id);if(event)event.undoneAt=new Date().toISOString();
 const queued=state.queue.some(q=>q.kind==='review'&&q.payload?.id===prev.event.id);
 if(queued)state.queue=state.queue.filter(q=>!(q.kind==='review'&&q.payload?.id===prev.event.id));
 else if(state.backend!=='local')state.queue.push({kind:'undo',payload:{reviewId:prev.event.id,operationId:uuid()}});
 try{await persist();s.index=prev.index;state.prevReview=null;initCard();s.processing=false;renderPlayer();toast('Rating dibatalkan.');if(state.backend!=='local')void flushQueue();}catch(e){s.processing=false;toast('Undo gagal: '+e.message)}
}
async function cloudReviewCall(name,payload){if(state.backend==='embedded')return hostCall(name,payload);const endpoint=name==='undo_review'?'/api/review/undo':'/api/review';const resp=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!resp.ok)throw Error((await resp.json()).error||`HTTP ${resp.status}`);return resp.json();}
let flushing=false;
async function flushQueue(){if(flushing||state.backend==='local'||!navigator.onLine)return;flushing=true;
 try{
  while(state.queue.length){const item=state.queue[0];await cloudReviewCall(item.kind==='undo'?'undo_review':'record_review',item.payload);state.queue.shift();await persist();}
 }catch(e){toast('Sinkronisasi akan dicoba lagi ketika koneksi tersedia.');}
 finally{flushing=false;}
}
async function refresh(){if(state.backend==='local'){toast('Mode lokal: tidak ada koneksi MCP.');return;}
 try{await flushQueue();const cloud=await fetchCloud();state.decks=cloud.data.decks||[];state.media=cloud.data.media||[];state.visualBindings=cloud.data.visualBindings||[];
 const pending=state.queue.filter(q=>q.kind==='review').map(q=>q.payload);
 state.reviews=[...(cloud.data.reviews||[]),...pending];await persist();render();toast('Data diperbarui.');}
 catch(e){toast('Tidak bisa mengambil data cloud: '+e.message);}
}
async function createWithChatGPT(){const message='Buatkan satu deck flashcard Noodl. Tanyakan dulu topik dan sumber yang ingin kupakai. Buat front, back, tepat tiga clue progresif pada 5/10/15 detik, timer default 20 detik. Simpan lewat MCP create_deck. Jika ada gambar dari dokumen atau internet, PERIKSA gambarnya secara visual, rekam sumber dan lisensi, impor sebagai pending, lalu minta aku memeriksa preview dan menyetujuinya. Jangan menempelkan gambar ke kartu sebelum asset berstatus approved.';
 if(looksEmbedded()&&window.openai?.sendFollowUpMessage){try{await window.openai.sendFollowUpMessage({prompt:message});return;}catch(e){toast('Permintaan ke ChatGPT gagal.');return;}}
 const win=window.open('https://chatgpt.com/','_blank','noopener,noreferrer');try{await navigator.clipboard.writeText(message);toast('Instruksi disalin. Tempel di ChatGPT yang terhubung ke Noodl.');}catch{if(win)win.close();toast('Izinkan clipboard atau buka ChatGPT secara manual.');}
}
async function localUpload(file){if(!file||file.size>4_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Hanya PNG/JPEG/WebP maksimum 4 MB.');
 const bitmap=await createImageBitmap(file);const w=bitmap.width,h=bitmap.height;bitmap.close();if(w<32||h<32||w>4096||h>4096||w*h>12_000_000)throw Error('Dimensi gambar di luar batas aman.');
 const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)});
 if(!/^data:image\/(?:png|jpeg|webp);base64,/.test(src))throw Error('Format gambar tidak valid');
 const m={id:uuid(),status:'pending',mime:file.type,width:w,height:h,bytes:file.size,provenance:{kind:'manual',origin:file.name,sourcePage:null,license:'',description:'Unggahan pengguna'},visualReview:{observation:'Belum diperiksa',legible:false,relevant:false},dataUrl:src};
 state.media.unshift(m);await persist();return m;
}
async function chunkUploadViaMcp(file){
 if(!window.openai?.callTool)throw Error('MCP app tools tidak tersedia');
 const provenance={kind:'manual',origin:file.name,description:'Unggahan langsung dari perangkat pengguna melalui MCP'};
 const started=await hostCall('app_begin_media_upload',{byteLength:file.size,mimeType:file.type,fileName:file.name,provenance});
 const chunkSize=started.chunkBytes||96*1024;
 let sent=0;
 for(let index=0;sent<file.size;index++){
  const bytes=new Uint8Array(await file.slice(sent,Math.min(file.size,sent+chunkSize)).arrayBuffer());
  let binary='';for(let k=0;k<bytes.length;k+=8192)binary+=String.fromCharCode(...bytes.subarray(k,k+8192));
  const result=await hostCall('app_upload_media_chunk',{uploadId:started.uploadId,index,base64:btoa(binary)});
  sent+=bytes.length;
  if(result.receivedBytes!==sent)throw Error('Progres unggah MCP tidak cocok dengan jumlah byte dikirim');
  const button=$('#uploadMedia');if(button)button.textContent=`Mengunggah ${Math.round(100*sent/file.size)}%`;
 }
 return hostCall('app_finish_media_upload',{uploadId:started.uploadId});
}
async function uploadOneImage(file){
 if(!file||file.size<24||file.size>4_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Hanya PNG/JPEG/WebP maksimum 4 MB.');
 if(state.backend==='local')return localUpload(file);
 if(state.backend==='web'){
  const body=new FormData();body.set('file',file);body.set('provenance',JSON.stringify({kind:'manual',origin:file.name,description:'Unggahan pribadi'}));
  const r=await fetch('/api/media/upload',{method:'POST',body});if(!r.ok)throw Error((await r.json()).error);return r.json();
 }
 if(state.backend==='embedded'){
  // Prefer native ChatGPT file transfer when present, but recover from host errors using chunked MCP transfer.
  if(window.openai?.uploadFile&&window.openai?.getFileDownloadUrl){
   try{
    const uploaded=await window.openai.uploadFile(file,{library:false});
    const fileId=uploaded?.fileId;if(!fileId)throw Error('Host did not return fileId');
    const res=await window.openai.getFileDownloadUrl({fileId});
    return await hostCall('import_media_file',{operationId:uuid(),file:{file_id:fileId,download_url:res.downloadUrl,mime_type:file.type,file_name:file.name},provenance:{kind:'manual',origin:file.name},visualReview:{observation:'An actual user-selected image was transferred. Needs a full visual preview before approval.',legible:false,relevant:false}});
   }catch(error){console.warn('Native host transfer failed; trying direct MCP chunks:',error?.message||error);}
  }
  return chunkUploadViaMcp(file);
 }
 throw Error('Tidak ada cloud backend aktif; gambar belum dikirim.');
}
async function uploadMedia(){
 const files=[...($('#mediaFile')?.files||[])];if(!files.length)return toast('Pilih satu atau beberapa file gambar.');
 const button=$('#uploadMedia');if(button)button.disabled=true;
 let success=0;const errors=[];
 for(const file of files){
  try{
   if(button)button.textContent=`Unggah ${success+1}/${files.length}…`;
   const media=await uploadOneImage(file);
   if(state.backend!=='local')state.media.unshift(media);
   success++;
  }catch(e){errors.push(`${file.name}: ${e.message}`);}
 }
 await persist();render();
 if(errors.length)toast(`${success} masuk karantina; ${errors.length} gagal: ${errors[0]}`);
 else toast(`${success} gambar tersimpan sebagai pending. Lanjutkan pemeriksaan visual.`);
}

async function previewMedia(id){const media=state.media.find(m=>m.id===id);if(!media)return;if(state.session?.clock)state.session.clock.pause(clockMs());const src=mediaSrc(id);if(!src)return toast('Gambar sudah tidak tersedia');
 let previewSrc=src;const image=new Image();image.src=previewSrc;try{await image.decode();}catch{
  try{previewSrc=await ensureMediaViaMcp(id);image.src=previewSrc;await image.decode();}
  catch{if(state.session&&!state.session.flipped&&document.visibilityState==='visible')state.session.clock.resume(clockMs());return toast('Gambar gagal dibuka/didekode melalui URL maupun MCP. Jangan disetujui.');}
 }
 state.modal={id,rendered:true};
 modalRoot.innerHTML=`<div class="preview-modal" role="dialog" aria-modal="true" aria-labelledby="mediaTitle"><div class="modal-panel"><div class="session-head"><div><span class="kicker">VISUAL VERIFICATION GATE</span><h2 id="mediaTitle">Periksa gambar aslinya</h2></div><button class="button ghost" id="closePreview">Tutup ✕</button></div><p>Perbesar / tinjau gambar ini. Status tetap pending sampai kamu memeriksa kecocokan isi, sumber, dan keterbacaan label. Pemeriksaan format oleh server saja tidak cukup.</p><img id="fullPreview" class="modal-image" data-media-id="${safe(id)}" src="${safe(previewSrc)}" alt="Gambar lengkap untuk verifikasi manusia"/><div class="notice"><strong>Sumber:</strong> ${safe(media.provenance?.origin||'Tidak diketahui')} · ${media.width}×${media.height} · ${safe(media.mime)}<br><strong>Catatan AI:</strong> ${safe(media.visualReview?.observation||'Tidak ada pemeriksaan visual model')}<br><strong>Lisensi:</strong> ${safe(media.provenance?.license||'Tidak dicatat / bukan sumber web')}</div>${media.status==='pending'?`<form id="approveForm"><label class="checkline"><input type="checkbox" name="sourceMatches" required/> Saya melihat gambarnya dan memastikan sumber/halamannya sesuai materi.</label><label class="checkline"><input type="checkbox" name="labelsLegible" required/> Detail penting dan label gambar terbaca dengan benar.</label><label class="checkline"><input type="checkbox" name="contentRelevant" required/> Gambar sesuai isi kartu; tidak ada diagram/label keliru yang saya temukan.</label><textarea class="textarea" name="note" required minlength="12" maxlength="500" placeholder="Catatan pemeriksaan nyata, misalnya: Diagram menampilkan akson, label sel Schwann jelas, sesuai slide 7."></textarea><div class="modal-footer"><button type="button" class="button danger" id="rejectMedia">Tolak gambar</button><button type="submit" class="button primary">✓ Setujui setelah diperiksa</button></div></form>`:`<p class="notice">Status: <strong>${safe(media.status)}</strong>. Gambar sudah melalui gerbang persetujuan.</p>`}</div></div>`;
 // Double check DOM decoded actual resource; no approval if decode fails on reviewed full preview.
 const imageEl=$('#fullPreview');let decoded=false;
 try{await imageEl.decode();decoded=imageEl.naturalWidth>=32&&imageEl.naturalHeight>=32;}catch{}
 state.modal.rendered=decoded;
 if(decoded&&media.status==='pending'&&state.backend!=='local'){
  try{
   const ticket=state.backend==='embedded'?await hostCall('app_begin_media_review',{mediaId:id}):await (await fetch('/api/media/'+id+'/challenge',{credentials:'same-origin'})).json();
   state.modal.challenge=ticket.challenge;
  }catch(e){state.modal.rendered=false;toast('Tiket pemeriksaan visual tidak tersedia: '+e.message);}
 }
 if(!decoded)toast('Pratinjau tidak berhasil didekode: persetujuan diblokir.');
 $('#closePreview').addEventListener('click',closeModal);
 $('#rejectMedia')?.addEventListener('click',()=>void rejectMedia(id));
 $('#approveForm')?.addEventListener('submit',event=>{event.preventDefault();if(!state.modal?.rendered)return toast('Gambar belum dirender dan tidak bisa disetujui.');const form=new FormData(event.target);const attestation={imageRendered:true,sourceMatches:form.get('sourceMatches')==='on',labelsLegible:form.get('labelsLegible')==='on',contentRelevant:form.get('contentRelevant')==='on',note:String(form.get('note')||''),challenge:state.modal?.challenge||''};void approveMedia(id,attestation)});
}
function closeModal(){state.modal=null;modalRoot.innerHTML='';if(state.session&&!state.session.flipped&&document.visibilityState==='visible')state.session.clock.resume(clockMs());}
async function approveMedia(id,attestation){if(!Object.values(attestation).slice(0,4).every(Boolean)||attestation.note.trim().length<12)return toast('Semua bukti pemeriksaan perlu diisi.');
 const m=state.media.find(m=>m.id===id);if(!m)return;
 try{
  let approved;if(state.backend==='embedded')approved=await hostCall('app_approve_media',{mediaId:id,attestation});
  else if(state.backend==='web'){const r=await fetch('/api/media/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(attestation)});if(!r.ok)throw Error((await r.json()).error);approved=await r.json();}
  else approved={status:'approved',approval:{actor:'account_user',note:attestation.note}};
  Object.assign(m,approved);await persist();closeModal();render();toast('Gambar disetujui. Sekarang boleh dipasang ke kartu.');
 }catch(e){toast('Persetujuan gagal: '+e.message);}
}
async function rejectMedia(id){const m=state.media.find(m=>m.id===id);if(!m)return;
 try{
  if(state.backend==='embedded')await hostCall('app_reject_media',{mediaId:id});
  else if(state.backend==='web'){const r=await fetch('/api/media/'+id+'/reject',{method:'POST'});if(!r.ok)throw Error((await r.json()).error);}
  m.status='rejected';delete m.dataUrl;await persist();closeModal();render();toast('Gambar ditolak.');
 }catch(e){toast('Penolakan gagal: '+e.message);}
}
function pickTargetCard(assetId){
 const media=state.media.find(m=>m.id===assetId);if(!media||media.status!=='approved')return toast('Gambar belum disetujui pada tingkat aset.');
 const options=state.decks.flatMap(deck=>(deck.cards||[]).map(card=>({deck,card})));
 if(!options.length)return toast('Tidak ada kartu tujuan.');
 modalRoot.innerHTML=`<div class="preview-modal" role="dialog" aria-modal="true"><div class="modal-panel" style="max-width:700px"><span class="kicker">CARD-BOUND VISUAL GATE</span><h2>Pilih flashcard</h2><p>Pemeriksaan aset dan pemeriksaan kecocokan kartu adalah dua hal berbeda. Setelah memilih kartu, ChatGPT wajib mengirim cek sumber dan cek gambar final.</p><img class="modal-image" style="max-height:220px" src="${safe(mediaSrc(assetId))}" alt="Gambar kandidat"/><form id="attachImageForm"><label for="targetCard">Kartu tujuan</label><select class="search" style="width:100%" id="targetCard" required>${options.map(({deck,card},i)=>`<option value="${i}">${safe(deck.title)} · ${safe(card.front?.find(b=>b.type==='text')?.text||'Kartu').slice(0,90)}</option>`).join('')}</select><div class="modal-footer"><button type="button" class="button ghost" id="cancelAttach">Batal</button><button type="submit" class="button primary">${state.backend==='local'?'Pasang ilustrasi lokal':'Buat kandidat pemeriksaan'}</button></div></form></div></div>`;
 $('#cancelAttach').addEventListener('click',closeModal);
 $('#attachImageForm').addEventListener('submit',async event=>{event.preventDefault();const selected=options[Number($('#targetCard').value)];if(!selected)return;
  if(state.backend==='local'){
   closeModal();return toast('Mode lokal belum bisa membuktikan dua pemeriksaan per kartu. Upload dan pasang melalui backend MCP terhubung.');
  }
  try{
   const args={deckId:selected.deck.id,cardId:selected.card.id,mediaId:assetId,side:'back'};
   let result;
   if(state.backend==='embedded')result=await hostCall('create_visual_candidate',args);
   else {const res=await fetch('/api/visual/candidates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await res.json();if(!res.ok)throw Error(data.error);result=data;}
   state.visualBindings.unshift(result);await persist();closeModal();render();toast('Kandidat tercatat. Selanjutnya ChatGPT harus melakukan cek sumber dan cek visual final.');
  }catch(e){toast('Tidak bisa membuat kandidat: '+e.message);}
 });
}
async function visualCall(name,endpoint,body){
 if(state.backend==='embedded')return hostCall(name,body);
 if(state.backend!=='web')throw Error('Pemeriksaan kartu memerlukan backend MCP yang terhubung.');
 const r=await fetch(endpoint,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Server rejected visual operation');return result;
}
async function refreshVisual(){
 if(state.backend==='local')return;
 const data=state.backend==='embedded'?await hostCall('app_snapshot'):await (await fetch('/api/snapshot',{credentials:'same-origin',cache:'no-store'})).json();
 state.decks=data.decks||state.decks;state.media=data.media||state.media;state.visualBindings=data.visualBindings||[];
 await persist();render();
}
async function previewCardBinding(id){
 const b=state.visualBindings.find(x=>x.bindingId===id);if(!b)return toast('Binding belum ditemukan.');
 try{
  const audit=await visualCall('get_card_visual_audit','/api/visual/'+id+'/audit');
  const deck=state.decks.find(d=>d.id===b.deckId),card=deck?.cards.find(c=>c.id===b.cardId);
  const imageUrl=mediaSrc(b.mediaId);const image=new Image();image.src=imageUrl;await image.decode();
  const reports=audit.checks||[],ready=b.status==='awaiting_user_approval';
  state.modal={type:'visual-binding',id,rendered:false};
  modalRoot.innerHTML=`<div class="preview-modal visual-review-modal" role="dialog" aria-modal="true" aria-label="Persetujuan visual per kartu"><div class="modal-panel"><div class="session-head"><div><span class="kicker">DUAL VISUAL VERIFICATION</span><h2>Validasi untuk kartu tertentu</h2></div><button type="button" class="button ghost" id="closePreview">Tutup ✕</button></div><p><b>Pertanyaan:</b> ${safe(card?.front?.find(x=>x.type==='text')?.text||'(tidak terbaca)')}</p><p><b>Jawaban:</b> ${safe(card?.back?.find(x=>x.type==='text')?.text||'(tidak terbaca)')}</p><img class="modal-image" id="bindingPreview" src="${safe(imageUrl)}" alt="Gambar final untuk kartu ini"/><p><a class="button secondary" href="${safe(imageUrl)}" target="_blank" rel="noopener noreferrer">Buka gambar resolusi penuh ↗</a></p><div class="notice"><strong>Sumber:</strong> ${safe(b.provenance?.origin||'Tidak diketahui')} · Halaman ${safe(b.provenance?.sourcePage||'?')}<br><strong>Status:</strong> ${safe(audit.status)} · <strong>Integritas sumber:</strong> ${safe(reports[0]?.report?.sourceIntegrity||'belum dibuktikan oleh server')}<hr>${reports.map(r=>`<p><b>${r.phase==='source'?'Cek A — Sumber':'Cek B — Gambar final'}:</b> ${safe(r.report?.evidenceNote||r.report?.supportedClaim||'Tidak ada catatan')}<br>${safe(r.report?.countercheck||'')}</p>`).join('')}</div>${ready?`<form id="approveBindingForm"><label class="checkline"><input type="checkbox" name="sourceMatches" required/> Saya memeriksa sumber/halaman yang diklaim; jika belum dapat dibuktikan, saya memahami keterbatasannya.</label><label class="checkline"><input type="checkbox" name="labelsLegible" required/> Teks, label, dan relasi visual pada gambar final jelas.</label><label class="checkline"><input type="checkbox" name="contentRelevant" required/> Gambar ini benar-benar mendukung jawaban kartu di atas.</label><textarea class="textarea" name="note" required minlength="20" maxlength="600" placeholder="Jelaskan elemen yang dilihat dan mengapa cocok dengan jawaban."></textarea><div class="modal-footer"><button class="button primary" type="submit">Setujui dan pasang ke kartu</button></div></form>`:'<p class="notice">Belum siap untuk persetujuan. ChatGPT harus menyelesaikan pemeriksaan A dan B terlebih dahulu.</p>'}</div></div>`;
  await $('#bindingPreview').decode();state.modal.rendered=true;
  if(ready)state.modal.challenge=(await visualCall('app_begin_visual_approval','/api/visual/'+id+'/challenge')).challenge;
  $('#closePreview').addEventListener('click',closeModal);
  $('#approveBindingForm')?.addEventListener('submit',async event=>{event.preventDefault();if(!state.modal?.rendered||!state.modal?.challenge)return toast('Preview atau tiket persetujuan belum tersedia');
   const f=new FormData(event.target);
   try{
    await visualCall('app_approve_card_visual','/api/visual/'+id+'/approve',{bindingId:id,challenge:state.modal.challenge,imageRendered:true,sourceMatches:f.get('sourceMatches')==='on',labelsLegible:f.get('labelsLegible')==='on',contentRelevant:f.get('contentRelevant')==='on',note:String(f.get('note')||'')});
    closeModal();await refreshVisual();await attachApprovedBinding(id);
   }catch(e){toast('Persetujuan gagal: '+e.message);}
  });
 }catch(e){toast('Tidak bisa membuka audit visual: '+e.message);}
}
async function attachApprovedBinding(id){
 const b=state.visualBindings.find(x=>x.bindingId===id);if(!b)return toast('Binding tidak ditemukan.');
 const deck=state.decks.find(x=>x.id===b.deckId);if(!deck)return toast('Deck tidak ditemukan.');
 try{
  await visualCall('attach_visual_to_card','/api/visual/'+id+'/attach',{bindingId:id,operationId:uuid(),expectedRevision:deck.revision});
  await refreshVisual();toast('Gambar berstatus dua pemeriksaan + disetujui dan terpasang pada kartu.');
 }catch(e){toast('Belum terpasang: '+e.message+' · Perbarui deck lalu ulangi pemasangan.');}
}

function exportLocal(){const bytes=new Blob([JSON.stringify({format:'noodl-flashcards-backup-v1',exportedAt:new Date().toISOString(),decks:state.decks,reviews:state.reviews,media:state.media},null,2)],{type:'application/json'});const url=URL.createObjectURL(bytes);const a=document.createElement('a');a.href=url;a.download='noodl-flashcards-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function playTone(freq=600,duration=.09){if(!state.settings.sound)return;try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.045,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+duration);osc.onended=()=>ctx.close();}catch{}}
function vibrate(pattern=8){if(state.settings.haptics)navigator.vibrate?.(pattern)}
// All UI events use delegation; generated content is escaped and never inserted as executable HTML.
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return;}
 const deck=e.target.closest('[data-open-deck],[data-start-deck]');if(deck){startDeck(deck.dataset.openDeck||deck.dataset.startDeck);return;}
 if(e.target.closest('[data-chat]')){void createWithChatGPT();return;}
 const loadEmbed=e.target.closest('[data-load-embed]');if(loadEmbed){
  const src=loadEmbed.dataset.loadEmbed;
  try{const u=new URL(src);if(u.protocol!=='https:'||!['www.youtube-nocookie.com','player.vimeo.com'].includes(u.hostname))throw Error('Invalid embed host');
   const iframe=document.createElement('iframe');iframe.src=u.href;iframe.title='Video materi flashcard';iframe.referrerPolicy='no-referrer';iframe.loading='lazy';iframe.allow='autoplay; encrypted-media; picture-in-picture';iframe.setAttribute('allowfullscreen','');iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');iframe.style.cssText='display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin-top:10px;';
   loadEmbed.parentElement.append(iframe);loadEmbed.remove();
  }catch{toast('Video eksternal tidak dapat dimuat dengan aman.');}return;
 }
 const rating=e.target.closest('[data-rating]');if(rating){void rate(Number(rating.dataset.rating));return;}
 const prev=e.target.closest('[data-preview]');if(prev){void previewMedia(prev.dataset.preview);return;}
 const attach=e.target.closest('[data-attach-image]');if(attach){pickTargetCard(attach.dataset.attachImage);return;}
 const visual=e.target.closest('[data-review-binding]');if(visual){void previewCardBinding(visual.dataset.reviewBinding);return;}
 const approved=e.target.closest('[data-attach-binding]');if(approved){void attachApprovedBinding(approved.dataset.attachBinding);return;}
 const zoom=e.target.closest('[data-zoom]');if(zoom){const id=zoom.dataset.zoom;if(state.media.some(m=>m.id===id))void previewMedia(id);return;}
 if(e.target.closest('#uploadMedia')){void uploadMedia();return;}
 if(e.target.closest('#refreshData')){void refresh();return;}
 if(e.target.closest('#exportLocal')){exportLocal();return;}
});
document.addEventListener('input',e=>{if(e.target.id==='deckSearch'){state.search=e.target.value;const area=$('.deck-grid');if(area)area.innerHTML=state.decks.filter(d=>(d.title+' '+d.description).toLowerCase().includes(state.search.toLowerCase())).map(deckTile).join('');}});
document.addEventListener('change',e=>{if(e.target.matches('[data-setting]')){state.settings[e.target.dataset.setting]=e.target.checked;applySettings();void persist();}});
$('#headerChat').addEventListener('click',()=>void createWithChatGPT());
$$('.dock .nav-btn').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
window.addEventListener('hashchange',()=>{if(state.initialized&&!state.session)navigate(location.hash.slice(1));});
window.addEventListener('online',()=>{void flushQueue();});
document.addEventListener('visibilitychange',()=>{const s=state.session;if(!s||!s.clock||s.flipped)return;if(document.hidden||state.modal)s.clock.pause(clockMs());else s.clock.resume(clockMs());});
window.addEventListener('keydown',e=>{
 if(state.modal){if(e.key==='Escape')closeModal();return;}
 if(state.route!=='player')return;
 if(e.target.closest('input,textarea,select,[contenteditable="true"],a,button,[role="dialog"]')||e.altKey||e.metaKey||e.ctrlKey||e.shiftKey||e.repeat)return;
 if(e.key==='Escape'){e.preventDefault();navigate('review');return;}
 if(e.key===' '||e.key==='Enter'){e.preventDefault();flip();return;}
 if(e.key.toLowerCase()==='z'){e.preventDefault();void undo();return;}
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();void rate(e.key==='ArrowLeft'?0:3);return;}
 if(state.session?.flipped&&/^[1-4]$/.test(e.key)){e.preventDefault();void rate(Number(e.key)-1);}
});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
void initialize();
