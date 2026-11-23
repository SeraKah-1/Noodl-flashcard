import {CardClock,dueClues,dragRating,replayReviews,isProcedureDeck,orderedProcedureCards,backPagesFor,nextBackPage} from '/shared/logic.js';
import {mediaRequirementOf,frontImageIds,knownFrontMediaReady} from '/shared/mediaPolicy.js';
// For static hosting, shared logic is copied at /shared/logic.js by build/deployment.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const main=$('#main'),modalRoot=$('#modalRoot');
const uuid=()=>crypto.randomUUID();
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const defaults={sound:true,haptics:true,timer:true,clues:true,reducedMotion:false,showSource:true};
const state={route:'home',backend:'local',ownerId:'local',decks:[],folders:[],activeFolderId:null,reviews:[],media:[],visualBindings:[],queue:[],settings:{...defaults},session:null,modal:null,search:'',busy:false,prevReview:null,initialized:false};
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
async function persist(){await dbSet('state',{decks:state.decks,folders:state.folders,reviews:state.reviews,media:state.backend==='local'?state.media:state.media.map(({dataUrl,...meta})=>meta),visualBindings:state.visualBindings,queue:state.queue,settings:state.settings});}
function demoDeck(){return {id:'demo-noodl',title:'Sistem Saraf — Demo',description:'Kartu contoh untuk menguji swipe, timer, clue, dan review.',revision:1,updatedAt:new Date().toISOString(),cards:[
 {id:'demo-1',front:[{type:'text',text:'Apa fungsi utama mielin pada akson neuron?'}],back:[{type:'text',text:'Meningkatkan kecepatan hantaran impuls melalui konduksi saltatori.'}],backPages:[{id:'mekanisme',kind:'explanation',title:'Mekanisme konduksi',blocks:[{type:'text',text:'Lapisan mielin mengisolasi sebagian besar membran akson. Potensial aksi dihasilkan ulang terutama pada nodus Ranvier, sehingga transmisi impuls menjadi lebih efisien.\n\nContoh ini hanya untuk demonstrasi halaman jawaban Noodl, bukan kutipan dari berkas kuliah.'}]},{id:'normal',kind:'normal',title:'Keadaan normal',blocks:[{type:'text',text:'Pada akson bermielin yang sehat, propagasi impuls terjadi lebih cepat dibandingkan banyak akson tak bermielin dengan diameter sebanding.'}]},{id:'abnormal',kind:'abnormal',title:'Jika mielin rusak',blocks:[{type:'text',text:'Kerusakan mielin dapat memperlambat atau menghambat penghantaran impuls. Konsekuensi klinis bergantung pada lokasi dan tingkat kerusakan.'}]},{id:'visual',kind:'visual',title:'Visual terverifikasi',blocks:[{type:'text',text:'Gambar slide asli atau ilustrasi tambahan baru boleh ditempel di sini setelah proses pemeriksaan sumber, pemeriksaan visual final, dan persetujuan pengguna untuk halaman ini.'}]}],clues:[{atSecond:5,text:'Berhubungan dengan lapisan pembungkus akson.'},{atSecond:10,text:'Fokus pada kecepatan rambat sinyal.'},{atSecond:15,text:'Impuls melompat antar nodus Ranvier.'}],timerSeconds:20,tags:['Neuroanatomi']},
 {id:'demo-2',front:[{type:'text',text:'Bagian neuron apa yang biasanya menerima sinyal dari sel lain?'}],back:[{type:'text',text:'Dendrit; sinyal kemudian diintegrasikan menuju badan sel.'}],clues:[{atSecond:5,text:'Struktur berbentuk cabang.'},{atSecond:10,text:'Letaknya di sekitar soma.'},{atSecond:15,text:'Namanya dimulai dengan huruf D.'}],timerSeconds:20,tags:['Neuroanatomi']},
 {id:'demo-3',front:[{type:'text',text:'Neurotransmiter utama di sambungan neuromuskular adalah?'}],back:[{type:'text',text:'Asetilkolin (acetylcholine).'}],clues:[{atSecond:5,text:'Molekul pengantar sinyal ke otot.'},{atSecond:10,text:'Berikatan dengan reseptor nikotinik.'},{atSecond:15,text:'Disingkat ACh.'}],timerSeconds:20,tags:['Fisiologi']},
 {id:'demo-4',front:[{type:'text',text:'Di mana impuls saraf mulai dipicu pada sebagian besar neuron?'}],back:[{type:'text',text:'Segmen awal akson, dekat axon hillock.'}],clues:[{atSecond:5,text:'Bukan di ujung dendrit.'},{atSecond:10,text:'Berdekatan dengan badan sel.'},{atSecond:15,text:'Daerah pemicu potensial aksi di awal akson.'}],timerSeconds:20,tags:['Fisiologi']},
 {id:'demo-5',front:[{type:'text',text:'Apa fungsi sel Schwann pada sistem saraf perifer?'}],back:[{type:'text',text:'Membentuk mielin pada akson sistem saraf perifer dan membantu regenerasi.'}],clues:[{atSecond:5,text:'Termasuk sel glia.'},{atSecond:10,text:'Berkaitan dengan mielin di saraf perifer.'},{atSecond:15,text:'Bukan oligodendrosit.'}],timerSeconds:20,tags:['Neuroanatomi']}
 ]};}
function procedureDemoDeck(){return {"title":"DEMO — Format Tilik OSCE (bukan tilik resmi)","description":"Contoh struktur metadata, bukan checklist lengkap untuk praktik klinis atau ujian. Ganti SELURUH teks dan sumber dengan tilik fakultas yang kamu pakai.","cards":[{"front":[{"type":"text","text":"Apa yang perlu dilakukan pada langkah 1 menurut tilik?"}],"back":[{"type":"text","text":"Sapa pasien dan perkenalkan diri sesuai standar komunikasi pada tilik resmi."}],"clues":[],"timerSeconds":20,"tags":["DEMO","Tilik"],"procedureStep":{"order":1,"checklistItem":"Contoh butir 1","phase":"Pembukaan","critical":false,"sourceDocument":"DEMO SAJA - ganti dengan PDF tilik resmi","sourcePage":null},"id":"demo-tilik-1","position":0},{"front":[{"type":"text","text":"Apa yang perlu dilakukan pada langkah 2 menurut tilik?"}],"back":[{"type":"text","text":"Konfirmasi identitas pasien menurut prosedur lembaga sebelum tindakan."}],"clues":[],"timerSeconds":20,"tags":["DEMO","Tilik"],"procedureStep":{"order":2,"checklistItem":"Contoh butir 2","phase":"Pembukaan","critical":false,"sourceDocument":"DEMO SAJA - ganti dengan PDF tilik resmi","sourcePage":null},"id":"demo-tilik-2","position":1},{"front":[{"type":"text","text":"Apa yang perlu dilakukan pada langkah 3 menurut tilik?"}],"back":[{"type":"text","text":"Jelaskan tujuan dan langkah umum tindakan dengan bahasa yang dipahami pasien."}],"clues":[],"timerSeconds":20,"tags":["DEMO","Tilik"],"procedureStep":{"order":3,"checklistItem":"Contoh butir 3","phase":"Penjelasan","critical":false,"sourceDocument":"DEMO SAJA - ganti dengan PDF tilik resmi","sourcePage":null},"id":"demo-tilik-3","position":2},{"front":[{"type":"text","text":"Apa yang perlu dilakukan pada langkah 4 menurut tilik?"}],"back":[{"type":"text","text":"Minta persetujuan tindakan sesuai kebijakan setempat, sebelum memulai pemeriksaan."}],"clues":[],"timerSeconds":20,"tags":["DEMO","Tilik"],"procedureStep":{"order":4,"checklistItem":"Contoh butir 4","phase":"Persetujuan","critical":false,"sourceDocument":"DEMO SAJA - ganti dengan PDF tilik resmi","sourcePage":null},"id":"demo-tilik-4","position":3},{"front":[{"type":"text","text":"Apa yang perlu dilakukan pada langkah 5 menurut tilik?"}],"back":[{"type":"text","text":"Beri kesempatan bertanya, sampaikan langkah berikutnya, dan tutup interaksi dengan sopan."}],"clues":[],"timerSeconds":20,"tags":["DEMO","Tilik"],"procedureStep":{"order":5,"checklistItem":"Contoh butir 5","phase":"Penutupan","critical":false,"sourceDocument":"DEMO SAJA - ganti dengan PDF tilik resmi","sourcePage":null},"id":"demo-tilik-5","position":4}],"id":"demo-osce-tilik","revision":1};}
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
   state.decks=cloud.data.decks||[];state.folders=cloud.data.folders||[];state.reviews=[...(cloud.data.reviews||[]),...pending.filter(p=>!(cloud.data.reviews||[]).some(x=>x.id===p.operationId)).map(p=>({...p,id:p.operationId,reviewedAt:p.reviewedAt||new Date().toISOString()}))];state.media=cloud.data.media||[];state.visualBindings=cloud.data.visualBindings||[];
  }else{state.backend='local';state.decks=cached.decks||[demoDeck(),procedureDemoDeck()];state.folders=cached.folders||[];state.reviews=cached.reviews||[];state.media=cached.media||[];state.visualBindings=cached.visualBindings||[];}
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
function deckTile(deck){return `<button class="deck-tile" data-open-deck="${safe(deck.id)}"><span class="deck-icon">▧</span><div><h3>${safe(deck.title)}${isProcedureDeck(deck.cards)?' <span class="mini-procedure">TILIK · URUT</span>':''}</h3><p>${safe(deck.description||'Kumpulan flashcard untuk belajar aktif.')}</p></div><div class="tile-foot"><span>${(deck.cards||[]).length} kartu</span><span>Buka ↗</span></div></button>`}
function renderHome(){const m=summary(),recent=state.decks.slice(0,3);
 return `<div class="screen"><section class="hero"><div><span class="kicker">✦ YOUR LITTLE STUDY SPACE</span><h1>Belajar dikit.<br><span>Ingat lama.</span></h1><p>Satu kartu, satu ide. Geser kapan saja, intip petunjuk bertahap, lalu ulangi yang belum menempel di kepala.</p><div class="hero-actions"><button class="button primary" data-nav="review">◈ Mulai review</button><button class="button secondary" data-chat="1">✧ Buat dengan ChatGPT</button></div></div><div class="hero-card"><div class="hero-mascot">( ◕ ‿ ◕ )</div><small>YOU'VE GOT THIS ✦</small><p>Jangan buru-buru membaliknya. Biar otak mencoba dulu.</p></div></section><section class="stats"><div class="stat"><div class="number">${m.decks}</div><div class="label">Deck tersimpan</div></div><div class="stat"><div class="number">${m.cards}</div><div class="label">Total flashcard</div></div><div class="stat"><div class="number">${m.due}</div><div class="label">Siap direview</div></div></section><div class="split-head"><div><h2 class="section-heading">Kartu yang menemanimu</h2><p class="section-sub">Deck terbaru di perpustakaanmu.</p></div><button class="muted-link" data-nav="library">Lihat semua →</button></div>${recent.length?`<div class="deck-grid">${recent.map(deckTile).join('')}</div>`:`<div class="empty"><div class="empty-face">(・_・;)</div><h3>Belum ada deck</h3><p>Minta ChatGPT membuat flashcard dan menyimpannya melalui MCP.</p><button class="button primary" data-chat="1">Buat deck baru ✧</button></div>`}<p class="tagline">NOODL FLASHCARDS · CREATED WITH CHATGPT, REMEMBERED BY YOU</p></div>`;
}
function folderPath(folderId){
 const parts=[],seen=new Set();let cursor=folderId;
 while(cursor){if(seen.has(cursor)||parts.length>8)break;seen.add(cursor);const folder=state.folders.find(f=>f.id===cursor);if(!folder)break;parts.unshift(folder);cursor=folder.parentId;}
 return parts;
}
function folderList(){return state.folders.slice().sort((a,b)=>a.name.localeCompare(b.name,'id'));}
function folderOptions(selected=null,forFolderId=null){
 const blocked=new Set();if(forFolderId){blocked.add(forFolderId);for(const f of state.folders)if(folderPath(f.id).some(p=>p.id===forFolderId))blocked.add(f.id);}
 return `<option value="" ${selected==null?'selected':''}>⌂ Tanpa folder (root)</option>`+folderList().filter(f=>!blocked.has(f.id)).map(f=>{
 const chain=folderPath(f.id);return `<option value="${safe(f.id)}" ${selected===f.id?'selected':''}>${safe('　'.repeat(Math.max(0,chain.length-1))+'📁 '+chain.map(x=>x.name).join(' / '))}</option>`;
 }).join('');
}
function folderTile(f){
 const deckCount=state.decks.filter(d=>d.folderId===f.id).length,subCount=state.folders.filter(d=>d.parentId===f.id).length;
 return `<div class="folder-tile"><button class="folder-open" type="button" data-open-folder="${safe(f.id)}"><span class="folder-symbol">📁</span><span class="folder-info"><strong>${safe(f.name)}</strong><small>${deckCount} deck · ${subCount} subfolder</small></span><span class="folder-arrow">›</span></button><div class="folder-actions"><button type="button" data-folder-action="rename" data-folder-id="${safe(f.id)}" aria-label="Ganti nama folder ${safe(f.name)}">Rename</button><button type="button" data-folder-action="move" data-folder-id="${safe(f.id)}" aria-label="Pindahkan folder ${safe(f.name)}">Pindah</button><button type="button" data-folder-action="delete" data-folder-id="${safe(f.id)}" aria-label="Hapus folder ${safe(f.name)}">Hapus</button></div></div>`;
}
function deckTileWithMove(d){return `<div class="deck-wrapper">${deckTile(d)}<button type="button" class="deck-move-action" data-move-deck="${safe(d.id)}" aria-label="Pindahkan deck ${safe(d.title)}">↗ Pindahkan</button></div>`;}
function renderLibraryContents(){
 const query=state.search.trim().toLowerCase();
 const folders=query?state.folders.filter(f=>f.name.toLowerCase().includes(query)):state.folders.filter(f=>f.parentId===state.activeFolderId);
 const decks=state.decks.filter(d=>query?(d.title+' '+d.description).toLowerCase().includes(query):(d.folderId??null)===state.activeFolderId);
 return `<section class="folder-section"><div class="folder-section-head"><h2 class="section-heading">Folder <span class="chip">${folders.length}</span></h2>${!query?`<span class="note">Klik folder untuk membuka</span>`:''}</div>${folders.length?`<div class="folder-grid">${folders.map(folderTile).join('')}</div>`:'<p class="folder-empty">Belum ada folder di lokasi ini.</p>'}</section><section class="folder-section"><div class="folder-section-head"><h2 class="section-heading">Flashcard deck <span class="chip">${decks.length}</span></h2></div>${decks.length?`<div class="deck-grid">${decks.map(deckTileWithMove).join('')}</div>`:'<div class="empty"><p>Belum ada deck di lokasi ini. Deck yang dipindahkan tetap mempertahankan seluruh kartu dan progres.</p></div>'}</section>`;
}
function renderLibrary(){
 const path=folderPath(state.activeFolderId);if(state.activeFolderId&&!path.some(f=>f.id===state.activeFolderId))state.activeFolderId=null;
 const crumbs=`<nav class="folder-crumbs" aria-label="Lokasi folder"><button type="button" data-open-folder="">⌂ Semua folder</button>${path.map(f=>`<span>›</span><button type="button" data-open-folder="${safe(f.id)}">${safe(f.name)}</button>`).join('')}</nav>`;
 return `<div class="screen"><div style="padding-top:38px"><span class="kicker">YOUR COLLECTION</span><h1 class="page-title">My decks <span style="color:var(--violet)">✦</span></h1><p class="page-intro">Folder bertingkat untuk merapikan deck. Kartu, gambar tersimpan, dan progres belajarmu tetap utuh saat deck dipindah.</p></div>${crumbs}<div class="library-tools"><input class="search" id="deckSearch" placeholder="Cari folder atau deck..." value="${safe(state.search)}" aria-label="Cari folder atau deck"/><button type="button" class="button secondary" data-folder-action="create">＋ Folder baru</button><button class="button primary" data-chat="1">✧ Deck baru</button></div><div id="libraryContents">${renderLibraryContents()}</div><div class="notice">${state.backend==='local'?'Mode lokal: struktur folder disimpan pada IndexedDB di browser ini. Folder cloud baru aktif setelah Worker v0.5 dideploy.':'Folder dan pemindahan deck disimpan ke akun Noodl melalui MCP; tidak mengubah progres review.'}</div></div>`;
}
function renderReview(){const m=summary();return `<div class="screen narrow"><div style="padding-top:38px"><span class="kicker">PRACTICE MAKES PERMANENT</span><h1 class="page-title">Review <span style="color:var(--violet)">◈</span></h1><p class="page-intro">Tidak harus menunggu jawaban terbuka untuk swipe. Sebelum dibalik, rating hanyalah penilaian diri—bukan bukti benar.</p></div><section class="stats"><div class="stat"><div class="number">${m.due}</div><div class="label">Perlu review</div></div><div class="stat"><div class="number">${m.studied}</div><div class="label">Pernah dipelajari</div></div><div class="stat"><div class="number">${m.cards}</div><div class="label">Semua kartu</div></div></section><div class="settings-panel"><h3>Pilih deck</h3>${state.decks.length?state.decks.map(d=>`<div class="media-row"><div class="deck-icon">▧</div><div class="summary"><strong>${safe(d.title)}</strong><small>${d.cards.length} kartu</small></div><button class="button secondary" data-start-deck="${safe(d.id)}">Belajar →</button></div>`).join(''):'<p>Belum ada deck.</p>'}</div><div class="notice">Clue muncul pada detik ke-5, 10, dan 15. Pada detik ke-20, timer berhenti tanpa menilai kartu secara otomatis. Saat tab tidak aktif, waktu dijeda.</div></div>`;}
function renderSettings(){return `<div class="screen narrow"><div style="padding-top:38px"><span class="kicker">MAKE IT YOURS</span><h1 class="page-title">Settings ⚙</h1><p class="page-intro">Noodl sesederhana yang diperlukan. Sesuaikan cara belajarnya.</p></div><div class="settings-panel"><h3>Pengalaman flashcard</h3>${[['timer','Timer 20 detik','Jeda saat tab tak terlihat atau jawaban dibuka.'],['clues','Tiga clue bertahap','Clue pada detik 5, 10, dan 15.'],['sound','Sound feedback','Efek suara pendek saat berinteraksi.'],['haptics','Getaran ringan','Hanya jika didukung perangkat.'],['reducedMotion','Kurangi animasi','Kurangi efek flip dan gerakan.'],['showSource','Tampilkan sumber gambar','Sumber, lisensi, dan status review.']].map(([key,label,desc])=>`<label class="toggle-row"><div><strong>${label}</strong><p>${desc}</p></div><input type="checkbox" data-setting="${key}" ${state.settings[key]?'checked':''}/></label>`).join('')}</div><div class="settings-panel"><h3>Media & pemeriksaan visual</h3><p class="note">Gambar diunggah langsung melalui MCP (bukan transfer file ChatGPT), lalu disimpan setelah format, dimensi, dan hash diverifikasi. ChatGPT wajib memeriksa sumber dan gambar final sebelum memasangnya pada kartu; tanpa konfirmasi manual.</p><div class="upload"><input id="mediaFile" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Unggah satu atau beberapa gambar"/><button class="button secondary" id="uploadMedia">Unggah gambar</button></div><div id="mediaList">${state.media.length?state.media.map(mediaRow).join(''):'<p class="note">Belum ada gambar. Unggah PNG, JPEG atau WebP.</p>'}</div></div><div class="settings-panel"><h3>Pemeriksaan gambar per kartu</h3><p class="note">ChatGPT melakukan dua pemeriksaan untuk setiap pasangan gambar dan kartu. Tidak ada tombol persetujuan; semua pasangan dapat diaudit dan dibatalkan jika keliru.</p><div id="visualBindingList">${state.visualBindings.length?state.visualBindings.map(bindingRow).join(''):'<p class="note">Belum ada pasangan gambar/kartu. ChatGPT dapat mengirim dua laporan pemeriksaan dan menautkan gambar secara batch lewat MCP.</p>'}</div></div><div class="settings-panel"><h3>Akun & penyimpanan</h3><p class="note">Status: <strong>${state.backend==='local'?'Lokal / browser':state.backend==='embedded'?'ChatGPT MCP':'Cloud'}</strong>. Database lokal dipisah berdasarkan identitas akun. Media cloud tersimpan di bucket privat.</p><button class="button secondary" id="refreshData">↻ Sinkronkan sekarang</button><button class="button secondary" id="exportLocal" style="margin-left:7px">Ekspor data JSON</button></div></div>`;}
function mediaRow(m){return `<div class="media-row"><img class="media-thumb" data-media-id="${safe(m.id)}" src="${safe(mediaSrc(m.id))}" alt="Pratinjau media"/><div class="summary"><strong>${safe(m.provenance?.origin||m.id)}</strong><small class="${safe(m.status)}">${m.status==='approved'?'Disimpan (belum dicek per kartu)':safe(m.status)} · ${m.width}×${m.height} · ${safe(m.provenance?.kind||'file')}</small></div>${m.status==='pending'?`<button class="button secondary" data-preview="${safe(m.id)}">Lihat</button>`:m.status==='approved'?`<button class="button secondary" data-preview="${safe(m.id)}">Lihat</button><button class="button primary" data-attach-image="${safe(m.id)}">Pilih kartu</button>`:'<span class="chip">Ditolak</span>'}</div>`;}
function bindingRow(b){const label=state.decks.flatMap(d=>d.cards?.map(c=>({d,c}))||[]).find(x=>x.c.id===b.cardId);return `<div class="media-row"><img class="media-thumb" data-media-id="${safe(b.mediaId)}" src="${safe(mediaSrc(b.mediaId))}" alt="Visual kandidat"/><div class="summary"><strong>${safe(label?.c?.front?.find(x=>x.type==='text')?.text||'Kartu '+b.cardId).slice(0,110)}</strong><small>${safe(b.status)} · ${safe(b.provenance?.origin||'Sumber')} · ${safe(b.side)}${b.pageId?' · '+safe(b.pageId):''}</small></div>${b.status==='approved_for_card'?`<button class="button primary" data-attach-binding="${safe(b.bindingId)}">Pasang</button>`:`<button class="button secondary" data-review-binding="${safe(b.bindingId)}">Audit</button>`}</div>`}
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
/** Only explicit visual-identification questions depend on front image availability.
 * Text-only, legacy, OSCE and optional-image cards never enter this gate.
 */
function questionVisualStatus(card=playerCard()){
 if(mediaRequirementOf(card)!=='required_for_question')return {ready:true,reason:''};
 const ids=frontImageIds(card);
 if(!ids.length)return {ready:false,reason:'Gambar inti belum ditempel di sisi pertanyaan.'};
 for(const id of ids){
  const media=state.media.find(m=>m.id===id);
  if(!media||media.status!=='approved')return {ready:false,reason:'Gambar pertanyaan belum tersedia atau belum lolos pemeriksaan file.'};
  if(mediaFallbackFailed.has(id))return {ready:false,reason:'Gambar tidak dapat dibaca dari penyimpanan. Sinkronkan atau unggah ulang.'};
  const img=[...document.querySelectorAll('.flash-face.front img[data-required-question-image]')].find(el=>el.dataset.mediaId===id);
  if(!img||!img.complete)return {ready:false,reason:'Menunggu gambar pertanyaan selesai dimuat. Jika gagal, lewati kartu ini.'};
  if(!img.naturalWidth)return {ready:false,reason:'Gambar pertanyaan gagal dimuat; kartu ini tidak boleh dinilai.'};
 }
 return {ready:true,reason:'Gambar pertanyaan sudah dimuat. Kamu bisa menjawab dan memberi rating.'};
}
function updateQuestionVisualGate(){
 if(state.route!=='player'||!state.session)return;
 const card=playerCard(),el=document.querySelector('#questionVisualGate');
 if(mediaRequirementOf(card)!=='required_for_question')return;
 const status=questionVisualStatus(card);
 if(el){el.textContent=(status.ready?'✓ ':'⚠ ')+status.reason;el.classList.toggle('blocked',!status.ready);el.setAttribute('aria-live','polite');}
 if(!state.session.flipped&&playerTimerEnabled(state.session)){if(status.ready&&document.visibilityState==='visible'&&!state.modal)state.session.clock.resume(clockMs());else state.session.clock.pause(clockMs());}
 document.querySelectorAll('#ratingControls [data-rating]').forEach(button=>{button.disabled=!status.ready;button.setAttribute('aria-disabled',String(!status.ready));});
}
document.addEventListener('load',event=>{
 if(event.target instanceof HTMLImageElement && event.target.matches('[data-required-question-image]'))updateQuestionVisualGate();
},true);
document.addEventListener('error',event=>{
 const img=event.target;
 if(img instanceof HTMLImageElement && img.matches('[data-required-question-image]'))queueMicrotask(updateQuestionVisualGate);
 if(!(img instanceof HTMLImageElement)||!img.dataset.mediaId||state.backend!=='embedded')return;
 const id=img.dataset.mediaId;if(mediaFallbackFailed.has(id))return;
 void ensureMediaViaMcp(id).catch(e=>{console.warn('Image could not be read from private MCP storage',e.message)});
},true);
function blocksHtml(blocks,side='back'){return (blocks||[]).map(b=>{
 if(b.type==='text')return `<div class="block-text">${safe(b.text)}</div>`;
 if(b.type==='math')return `<div class="math" role="math" aria-label="${safe(b.latex)}">${safe(b.latex)}</div>`;
 if(b.type==='image'){
  const img=mediaSrc(b.assetId),m=state.media.find(x=>x.id===b.assetId),label=m?.provenance?.origin;
  if(!img||m?.status!=='approved')return `<p class="note">Gambar tidak tersedia atau file gagal diverifikasi.</p>`;
  return `<figure><img src="${safe(img)}" alt="${safe(b.alt)}" data-media-id="${safe(b.assetId)}" data-zoom="${safe(b.assetId)}" ${side==='front'&&mediaRequirementOf(playerCard())==='required_for_question'?'data-required-question-image="1"':''} loading="eager"/><figcaption>${safe(b.alt)}${state.settings.showSource&&label?` · ${safe(label)}`:''}</figcaption></figure>`;
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
/** Render the optional deep-reading layer without removing the full, original back text. */
function explanationHtml(card){
 const sections=card?.explanation?.sections;
 if(!Array.isArray(sections)||!sections.length)return '';
 return `<section class="reader-explanation" aria-label="Pembahasan lengkap"><div class="reader-section-heading">PEMBAHASAN LENGKAP</div>${sections.map((section,i)=>`<section class="reader-section"><h3>${safe(section.heading||`Bagian ${i+1}`)}</h3>${blocksHtml(section.blocks||[])}</section>`).join('')}</section>`;
}
function deepPage(card,index=0){return backPagesFor(card)[index]||backPagesFor(card)[0]}
function hasDeepPages(card){return Array.isArray(card?.backPages)&&card.backPages.length>0}
function deepPageSource(page){
 if(!page?.sourceRefs?.length)return '';
 return `<div class="deep-page-sources"><strong>Referensi halaman</strong>${page.sourceRefs.map(ref=>`<div>${safe(ref.kind==='slide'?'Slide asli':ref.kind==='web'?'Ilustrasi web':ref.kind==='generated'?'Ilustrasi AI':'Catatan')} · ${safe(ref.origin)}${ref.sourcePage?' · halaman '+ref.sourcePage:''}</div>`).join('')}<small>Referensi tercatat; validitas medis dan izin gambar tetap diperiksa terpisah.</small></div>`;
}
function deepBackHtml(card,index=0){
 const page=deepPage(card,index),step=card.procedureStep;
 if(index===0){
  return `${step?`<div class="procedure-rubric">${step.critical?'<strong class="critical-note">⚠ Langkah kritis menurut tilik sumber</strong>':''}<strong>${safe(step.checklistItem)}</strong>${step.phase?`<small>${safe(step.phase)}</small>`:''}</div>`:''}${blocksHtml(card.back)}${hasExplanation(card)?`<p class="answer-more-label">✦ Pembahasan lengkap di tombol Baca lengkap</p>`:''}${step?`<div class="procedure-source">Sumber: ${safe(step.sourceDocument)}${step.sourcePage?' · halaman '+step.sourcePage:''} · butir ${safe(step.checklistItem)}</div>`:''}`;
 }
 return `<div class="deep-page-heading"><span>${safe(page.kind).toUpperCase()}</span><h3>${safe(page.title)}</h3></div>${blocksHtml(page.blocks)}${deepPageSource(page)}`;
}
function deepNavHtml(card,index=0,revealed=false){
 if(!hasDeepPages(card))return '';
 const pages=backPagesFor(card),page=pages[index]||pages[0];
 return `<div class="deep-nav" id="deepNav" ${revealed?'':'hidden'} aria-label="Navigasi halaman jawaban"><button type="button" class="deep-arrow" id="deepPrev" aria-label="Halaman jawaban sebelumnya" ${index<=0?'disabled':''}>‹</button><div class="deep-nav-center"><strong id="deepPageCounter">${index+1} / ${pages.length} halaman</strong><span id="deepPageTitle">${safe(page.title)}</span><div class="deep-dots" id="deepDots" aria-hidden="true">${pages.map((p,i)=>`<span class="${i===index?'active':''}"></span>`).join('')}</div></div><button type="button" class="deep-arrow" id="deepNext" aria-label="Halaman jawaban berikutnya" ${index>=pages.length-1?'disabled':''}>›</button></div>`;
}
function updateDeepPageUI(direction=0){
 const s=state.session,card=playerCard();if(!s||!card||!hasDeepPages(card))return;
 const p=deepPage(card,s.backPageIndex),pages=backPagesFor(card);
 const content=$('#deepPageBody');if(content){content.innerHTML=deepBackHtml(card,s.backPageIndex);content.classList.remove('deep-enter-next','deep-enter-prev');void content.offsetWidth;if(direction)content.classList.add(direction>0?'deep-enter-next':'deep-enter-prev');}
 const scroller=$('.flash-face.back .face-content');if(scroller)scroller.scrollTop=0;
 const nav=$('#deepNav');if(nav)nav.hidden=!s.flipped;
 const count=$('#deepPageCounter');if(count)count.textContent=`${s.backPageIndex+1} / ${pages.length} halaman`;
 const title=$('#deepPageTitle');if(title)title.textContent=p.title;
 const dots=$('#deepDots');if(dots)dots.innerHTML=pages.map((_,i)=>`<span class="${i===s.backPageIndex?'active':''}"></span>`).join('');
 const prev=$('#deepPrev'),next=$('#deepNext');if(prev)prev.disabled=s.backPageIndex===0;if(next)next.disabled=s.backPageIndex===pages.length-1;
 const head=$('.flash-face.back .face-top span:first-child');if(head)head.textContent=s.backPageIndex?`${p.title} · ${s.backPageIndex+1}/${pages.length}`:(s.procedure?`TINDAKAN ${s.index+1}`:'JAWABAN');
 const stickerL=$('#stickerLeft'),stickerR=$('#stickerRight');if(stickerL)stickerL.textContent=s.flipped?'BERIKUTNYA':'BELUM TAHU';if(stickerR)stickerR.textContent=s.flipped?'SEBELUMNYA':'TAHU';
}
function moveDeepPage(delta){
 const s=state.session,card=playerCard();if(!s?.flipped||s.processing||!hasDeepPages(card)||state.modal)return false;
 const next=nextBackPage(s.backPageIndex,delta,card);if(next===s.backPageIndex)return false;
 s.backPageIndex=next;updateDeepPageUI(delta);return true;
}
function hasExplanation(card){return !!card?.explanation?.sections?.length;}
function openCardReader(side='back'){
 const s=state.session,card=playerCard();if(!s||!card||s.processing)return;
 if(!['front','back'].includes(side))side='back';
 // Opening the question reader must never reveal the answer behind a face-down card.
 if(side==='back'&&!s.flipped)side='front';
 if(s.clock&&playerTimerEnabled(s))s.clock.pause(clockMs());
 state.modal={kind:'card-reader',side};
 document.body.classList.add('reading-open');
 const selectedPage=deepPage(card,s.backPageIndex);
 const heading=side==='front'?'Pertanyaan lengkap':(hasDeepPages(card)?selectedPage.title:'Jawaban & pembahasan');
 const step=card.procedureStep;
 const source=side==='back'&&step&&s.backPageIndex===0?`<div class="reader-source"><strong>Butir tilik ${step.order}:</strong> ${safe(step.checklistItem)}${step.critical?' · Langkah kritis':''}<br>Sumber: ${safe(step.sourceDocument)}${step.sourcePage?' · halaman '+step.sourcePage:''}</div>`:'';
 const surface=()=>`<div class="reader-content" id="readerContent" tabindex="0" role="region" aria-label="Teks lengkap, dapat digulir"><div class="reader-text">${source}${side==='front'?blocksHtml(card.front,'front'):blocksHtml(selectedPage.blocks)}${side==='back'&&s.backPageIndex===0?explanationHtml(card):''}${side==='back'&&s.backPageIndex>0?deepPageSource(selectedPage):''}</div><div class="reader-end">Akhir ${side==='back'?'jawaban':'pertanyaan'} · semua materi di atas dapat digulir</div></div>`;
 modalRoot.innerHTML=`<div class="reader-overlay" id="readerOverlay"><div class="reader-backdrop" data-close-reader></div><section class="reader-panel" role="dialog" aria-modal="true" aria-labelledby="readerTitle"><div class="reader-top"><div><div class="kicker">LAYERED FLASHCARD</div><h2 id="readerTitle">${heading}</h2><p> ${safe(s.deck.title)} · kartu ${s.index+1}/${s.cards.length}</p></div><button type="button" class="button secondary" id="readerClose" aria-label="Tutup pembahasan">✕ Tutup</button></div><div class="reader-tabs" role="group" aria-label="Bagian kartu"><button class="reader-tab ${side==='front'?'selected':''}" data-reader-side="front" aria-pressed="${side==='front'}">Pertanyaan</button><button class="reader-tab ${side==='back'?'selected':''}" data-reader-side="back" aria-pressed="${side==='back'}" ${!s.flipped?'disabled title="Balik kartu dahulu untuk membuka jawaban"':''}>Jawaban${hasExplanation(card)?' + Detail':''}</button></div>${surface()}<div class="reader-bottom"><span>Scroll untuk membaca · swipe kartu dijeda</span>${side==='back'&&hasDeepPages(card)?`<button type="button" class="button secondary" id="readerPrev" ${s.backPageIndex<=0?'disabled':''}>‹</button><button type="button" class="button secondary" id="readerNext" ${s.backPageIndex>=backPagesFor(card).length-1?'disabled':''}>›</button>`:''}<button type="button" class="button primary" id="readerDone">Kembali ke kartu</button></div></section></div>`;
 const content=$('#readerContent');if(content)content.scrollTop=0;
 $('#readerClose')?.addEventListener('click',closeModal);
 $('#readerDone')?.addEventListener('click',closeModal);
 $('#readerPrev')?.addEventListener('click',()=>{s.backPageIndex=nextBackPage(s.backPageIndex,-1,card);updateDeepPageUI(-1);openCardReader('back');});
 $('#readerNext')?.addEventListener('click',()=>{s.backPageIndex=nextBackPage(s.backPageIndex,1,card);updateDeepPageUI(1);openCardReader('back');});
 $('#readerOverlay [data-close-reader]')?.addEventListener('click',closeModal);
 $$('.reader-tab').forEach(el=>el.addEventListener('click',()=>{if(el.dataset.readerSide!==state.modal?.side)openCardReader(el.dataset.readerSide)}));
 $('#readerContent')?.focus({preventScroll:true});
}
function startDeck(id,onlyDue=false){const deck=state.decks.find(x=>x.id===id);if(!deck||!deck.cards?.length){toast('Deck tidak memiliki kartu.');return;}
 const procedure=isProcedureDeck(deck.cards);
 // A due-only subset breaks the checklist order; procedural decks ALWAYS replay the full station.
 const candidates=onlyDue?deck.cards.filter(c=>replayReviews(state.reviews,c.id).due):deck.cards;
 const cards=procedure?orderedProcedureCards(deck.cards):candidates.filter(c=>knownFrontMediaReady(c,state.media));
 const skipped=procedure?0:candidates.length-cards.length;
 if(skipped)toast(`${skipped} kartu visual belum punya gambar inti, dilewati tanpa mengubah riwayat review.`);
 if(!cards.length){toast('Belum ada kartu yang jatuh tempo.');return;}
 const session={deck,cards,procedure,procedureView:'technique',index:0,flipped:false,backPageIndex:0,clock:null,cluesSeen:[],lastClue:0,processing:false,started:false};state.session=session;state.prevReview=null;state.route='player';document.body.classList.add('in-player');history.replaceState(null,'','#review');initCard();render();}
function playerTimerEnabled(s=state.session){return !!s&&!s.procedure&&state.settings.timer;}
function initCard(){const s=state.session;if(!s)return;s.flipped=false;s.backPageIndex=0;s.cluesSeen=[];s.lastClue=0;s.started=false;s.clock=new CardClock(playerTimerEnabled(s)?s.cards[s.index]?.timerSeconds||20:20);if(playerTimerEnabled(s))s.clock.resume(clockMs());}
function stopSession(){if(state.session?.clock)state.session.clock.pause(clockMs());state.session=null;cancelAnimationFrame(rafId)}
function playerCard(){const s=state.session;return s?.cards[s.index]}
function renderPlayer(){const s=state.session;if(!s)return navigate('review');const card=playerCard();
 if(!card){main.innerHTML=`<div class="screen narrow" style="text-align:center;padding-top:80px"><div class="hero-mascot">(≧▽≦)</div><h1 class="page-title">Sesi selesai!</h1><p class="page-intro">${s.cards.length} kartu sudah kamu lewati. Rating tersimpan tanpa mengarang skor benar/salah.</p><div class="hero-actions" style="justify-content:center"><button class="button primary" data-nav="review">Ke Review</button><button class="button secondary" data-nav="library">My decks</button></div></div>`;return;}
 const n=s.index+1,len=s.cards.length,revealed=s.flipped,procedure=!!s.procedure,sequence=procedure&&s.procedureView==='sequence',timerOn=playerTimerEnabled(s),step=card.procedureStep,enterClass=s.enterDirection>0?'enter-from-left':s.enterDirection<0?'enter-from-right':'',clues=s.cluesSeen.map(t=>card.clues?.find(c=>c.atSecond===t)).filter(Boolean),deep=hasDeepPages(card);
 main.innerHTML=`<div class="screen narrow"><div class="session-head"><div><button class="button ghost" data-nav="review">← Kembali</button></div><div style="text-align:center"><h2 class="session-title">${safe(s.deck.title)}</h2><p class="session-sub">${procedure?'TILIK OSCE · URUT':'FLASHCARDS'} · ${n} / ${len}</p></div><div><button class="button ghost" id="playerUndo" ${state.prevReview?'':'disabled'}>↶ Undo</button></div></div>${procedure?`<div class="procedure-modes" aria-label="Cara latihan tilik"><button class="button ${s.procedureView==='technique'?'primary':'secondary'}" data-procedure-view="technique" aria-pressed="${s.procedureView==='technique'}">Pelajari teknik</button><button class="button ${s.procedureView==='sequence'?'primary':'secondary'}" data-procedure-view="sequence" aria-pressed="${s.procedureView==='sequence'}">Ingat urutan</button></div>`:''}<div class="progress-rail"><div class="progress-bar" style="width:${(s.index/len)*100}%"></div></div><div class="timer-line"><span>✦ ${revealed?'Jawaban terbuka':procedure?'Peragakan dahulu, baru balik':'Ingat dulu, baru balik'}</span><span id="timerPill" class="timer-pill">${timerOn?'20s':procedure?'Tanpa timer':'Santai'}</span></div><div class="flash-stage" id="flashStage" aria-label="Kartu flashcard; geser kiri atau kanan dari area mana saja"><div class="flash-behind"></div><div class="swipe-sticker left" id="stickerLeft">BELUM TAHU</div><div class="swipe-sticker right" id="stickerRight">TAHU</div><div class="flash-motion ${enterClass}" id="flashMotion"><div class="flash-scene ${revealed?'flipped':''}" id="flashScene"><div class="flash-face front" aria-hidden="${revealed}"><div class="face-top"><span>${procedure?'LANGKAH '+n:'PERTANYAAN'}</span><span>NOODL ◈</span></div><div class="face-content" tabindex="${revealed?-1:0}" role="region" aria-label="Pertanyaan kartu, gulir untuk membaca seluruh teks">${sequence?'<div class="sequence-recall">Apa tindakan selanjutnya?<small>Ucapkan dan peragakan tanpa melihat daftar tilik</small></div>':blocksHtml(card.front,'front')}</div><div class="face-footer">${(card.front||[]).filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)>350?'↕ Gulir pertanyaan · ☷ Baca lengkap':procedure?'Peragakan tindakan · geser dari area mana saja':'Ketuk untuk balik · geser dari area mana saja'}</div></div><div class="flash-face back" aria-hidden="${!revealed}"><div class="face-top"><span>${procedure?'TINDAKAN '+n:'JAWABAN'}</span><span>FLASHCARD ✦</span></div><div class="face-content answer" tabindex="${revealed?0:-1}" role="region" aria-label="Jawaban kartu, gulir untuk membaca seluruh teks"><div class="deep-page-body" id="deepPageBody">${deepBackHtml(card,s.backPageIndex)}</div></div><div class="face-footer">${(card.back||[]).filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)>350?'↕ Gulir jawaban · ☷ Baca lengkap':procedure?'Rating hanya penilaian diri, bukan bukti kompetensi klinis':'Nilai sesuai ingatanmu, bukan tebakanmu'}</div></div></div></div></div>${deepNavHtml(card,s.backPageIndex,revealed)}${mediaRequirementOf(card)==='required_for_question'?`<div id="questionVisualGate" class="question-visual-gate" role="status" aria-live="polite">Memeriksa gambar inti pertanyaan…</div>`:''}${!procedure?`<div class="clue-card" id="clueBox"><span class="info-icon">✦</span><div id="clueText">${revealed?'Jawaban dibuka. Timer dijeda.':'Clue pertama muncul pada detik ke-5.'}</div><button class="reveal-clues" id="showClues" ${clues.length?'':'disabled'}>Clue (${clues.length})</button></div>`:''}<div id="ratingControls">${revealed?renderRatings():renderSwipeGuide()}</div><div class="player-controls"><button class="button secondary" id="playerFlip">${revealed?'↶ Lihat depan':'↻ Balik kartu'}</button><button class="button secondary" id="playerRead" title="Buka seluruh teks tanpa risiko terpotong">☷ Baca lengkap${hasExplanation(card)?" + pembahasan":""}</button>${state.backend!=='local'?'<button class="button secondary" id="playerRefresh" title="Baca perubahan isi terbaru dari ChatGPT MCP">↻ Perbarui isi</button>':''}<button class="button ghost" id="playerSkip">Lewati →</button></div><p class="session-meta">${procedure?'Urutan tindakan mengikuti sumber · tanpa timer dan clue · rating bukan sertifikasi teknik. ':''}${deep?'Depan: swipe untuk rating · Belakang: swipe untuk halaman · Rating via tombol.':'Swipe kiri / kanan termasuk di tengah kartu'} · Space: balik · 1–4: rating setelah flip · Z: undo. ${state.backend==='local'?'Data tersimpan di browser.':'Penyimpanan lokal dahulu, sinkronisasi kemudian.'}</p></div>`;
 s.enterDirection=0;bindGestures();bindPlayerButtons();updateQuestionVisualGate();tick();
}
function renderRatings(){return `<div class="rating-grid">${[['Lupa','0','forget','↶'],['Sulit','1','','◌'],['Bagus','2','','✓'],['Mudah','3','easy','✦']].map(([text,rating,cls,icon])=>`<button class="rating ${cls}" data-rating="${rating}"><span>${icon}</span>${text}<small>${Number(rating)+1} / ${rating==='0'?'←':rating==='3'?'→':'tap'}</small></button>`).join('')}</div>`}
function renderSwipeGuide(){return `<div class="swipe-guide"><span class="left">← Belum tahu</span><span>Swipe tanpa harus membalik</span><span class="right">Sudah tahu →</span></div>`}
function updateClueDisplay(){const s=state.session;if(!s||s.flipped)return;const card=playerCard();if(!card)return;const latest=s.cluesSeen.at(-1),c=card.clues?.find(x=>x.atSecond===latest),txt=$('#clueText');if(txt)txt.textContent=c?`Petunjuk ${s.cluesSeen.length}: ${c.text}`:'Clue pertama muncul pada detik ke-5.';const btn=$('#showClues');if(btn){btn.disabled=!s.cluesSeen.length;btn.textContent=`Clue (${s.cluesSeen.length})`;}}
function tick(){cancelAnimationFrame(rafId);const s=state.session;if(!s||state.route!=='player'||!playerCard())return;
 const now=clockMs(),timerOn=playerTimerEnabled(s),elapsed=timerOn?s.clock.seconds(now):0;
 if(timerOn){const remain=Math.max(0,Math.ceil((s.clock.durationMs-s.clock.elapsed(now))/1000));const pill=$('#timerPill');if(pill){pill.textContent=remain+'s';pill.classList.toggle('expired',remain===0);}}
 if(timerOn&&state.settings.clues&&!s.flipped){const newly=dueClues(elapsed).filter(x=>!s.cluesSeen.includes(x));
  if(newly.length){s.cluesSeen.push(...newly);const latest=playerCard().clues?.find(c=>c.atSecond===newly.at(-1));if(latest){toast(`✦ Clue ${s.cluesSeen.length}: ${latest.text}`);playTone(690,.055);}updateClueDisplay();}
 }
 if(timerOn&&s.clock.expired(now)&&!s.started){s.started=true;toast('20 detik habis. Kamu boleh membuka jawaban atau swipe.');}
 rafId=requestAnimationFrame(tick);
}
function flip(){const s=state.session;if(!s||s.processing||state.modal)return;s.flipped=!s.flipped;s.backPageIndex=0;
 if(s.flipped){s.clock.pause(clockMs());}else if(playerTimerEnabled(s)&&document.visibilityState==='visible'){s.clock.resume(clockMs());}
 $$('.face-content').forEach(el=>{el.scrollTop=0;el.tabIndex=el.closest('.flash-face.back')?(s.flipped?0:-1):(s.flipped?-1:0);});
 $('#flashScene')?.classList.toggle('flipped',s.flipped);$('.flash-face.front')?.setAttribute('aria-hidden',String(s.flipped));$('.flash-face.back')?.setAttribute('aria-hidden',String(!s.flipped));$('#ratingControls').innerHTML=s.flipped?renderRatings():renderSwipeGuide();updateQuestionVisualGate();$('#playerFlip').textContent=s.flipped?'↶ Lihat depan':'↻ Balik kartu';$('.timer-line span:first-child').textContent=s.flipped?'✦ Jawaban terbuka':s.procedure?'✦ Peragakan dahulu, baru balik':'✦ Ingat dulu, baru balik';if(s.flipped){if($('#clueText'))$('#clueText').textContent='Jawaban dibuka. Timer dijeda.';}else updateClueDisplay();updateDeepPageUI();}
function bindPlayerButtons(){
 $('#playerFlip')?.addEventListener('click',flip);
 $('#playerRead')?.addEventListener('click',()=>openCardReader(state.session?.flipped?'back':'front'));
 $('#playerSkip')?.addEventListener('click',()=>advanceNoRating());
 $('#playerRefresh')?.addEventListener('click',()=>void refresh());
 $('#playerUndo')?.addEventListener('click',()=>void undo());
 $('#deepPrev')?.addEventListener('click',()=>moveDeepPage(-1));
 $('#deepNext')?.addEventListener('click',()=>moveDeepPage(1));
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
  const x=pointer.dx, width=Math.max(260,stage.clientWidth),deepGesture=!!(state.session?.flipped&&hasDeepPages(playerCard()));
  const shown=Math.max(-width*.67,Math.min(width*.67,x));
  const ratio=Math.min(1,Math.abs(x)/Math.max(92,width*.22));
  if(deepGesture){const inner=$('#deepPageBody');if(inner){inner.style.transform=`translate3d(${shown*.32}px,0,0)`;inner.style.opacity=String(1-ratio*.22);}}
  else {motion.style.transform=`translate3d(${shown}px,0,0) rotate(${reduced()?0:shown/width*12}deg)`;motion.style.opacity=String(1-ratio*.16);}
  left.style.opacity=String(x<0?ratio:0);
  right.style.opacity=String(x>0?ratio:0);
 };
 const reset=()=>{
  if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0;}
  motion.classList.remove('is-dragging');
  motion.style.transform='';motion.style.opacity='';const inner=$('#deepPageBody');if(inner){inner.style.transform='';inner.style.opacity='';}
  left.style.opacity='0';right.style.opacity='0';
 };
 const finishCapture=id=>{try{if(stage.hasPointerCapture(id))stage.releasePointerCapture(id);}catch{}};
 stage.addEventListener('pointerdown',e=>{
  if(pointer||state.modal||state.session?.processing||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;
  // Real controls remain clickable. Images are deliberately NOT excluded: users
  // can swipe over their center, or simply tap to open the full-size preview.
  if(e.target instanceof Element&&e.target.closest('button,a,iframe,input,textarea,select,[contenteditable="true"]'))return;
  pointer={id:e.pointerId,x:e.clientX,y:e.clientY,at:performance.now(),dx:0,dy:0,axis:'pending',
   zoomTarget:e.target instanceof Element&&!!e.target.closest('[data-zoom]'),samples:[{x:e.clientX,t:performance.now()}]};
  // Preserve native click on images; capture only if that touch becomes a drag.
  // Capture only after a horizontal movement: native vertical scroll must remain reachable at the top of long cards.
  if(!pointer.zoomTarget&&!e.target.closest('.face-content'))try{stage.setPointerCapture(e.pointerId);}catch{}
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
    if(state.session?.flipped&&hasDeepPages(playerCard())){reset();moveDeepPage(dx<0?1:-1);}
    else void rate(rating,{swipeDirection:Math.sign(dx)});
   }else reset();
  }else if(!cancelled&&p.axis==='pending'&&!p.zoomTarget){
   reset();if(!(state.session?.flipped&&hasDeepPages(playerCard())))flip();
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
 if(!questionVisualStatus(playerCard()).ready){toast('Pertanyaan visual belum siap: gambar inti harus tampil sebelum review. Gunakan Lewati.');updateQuestionVisualGate();return;}
 if(!s.flipped&&!([0,3].includes(rating)))return;
 s.processing=true;s.clock.pause(clockMs());const c=playerCard(),elapsedMs=Math.floor(s.clock.elapsed(clockMs()));
 const event={id:uuid(),operationId:null,deckId:s.deck.id,cardId:c.id,rating,answerRevealed:s.flipped,cluesSeen:[...s.cluesSeen],elapsedMs:playerTimerEnabled(s)?elapsedMs:0,timedOut:playerTimerEnabled(s)&&s.clock.expired(clockMs()),reviewedAt:new Date().toISOString(),undoneAt:null};event.operationId=event.id;
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
 try{await flushQueue();const cloud=await fetchCloud();mediaFallbackFailed.clear();state.decks=cloud.data.decks||[];state.folders=cloud.data.folders||[];state.media=cloud.data.media||[];state.visualBindings=cloud.data.visualBindings||[];
 const pending=state.queue.filter(q=>q.kind==='review').map(q=>q.payload);
 state.reviews=[...(cloud.data.reviews||[]),...pending];
 if(state.session){
  const s=state.session,oldCardId=playerCard()?.id,updated=state.decks.find(d=>d.id===s.deck.id);
  if(!updated){stopSession();state.route='library';document.body.classList.remove('in-player');}
  else{
   s.deck=updated;
   const ids=new Set(s.cards.map(c=>c.id));
   s.cards=s.procedure?orderedProcedureCards(updated.cards):updated.cards.filter(c=>ids.has(c.id));
   let at=s.cards.findIndex(c=>c.id===oldCardId);
   if(at<0){at=Math.min(s.index,s.cards.length);s.index=at;initCard();}
   else{s.index=at;s.backPageIndex=Math.min(s.backPageIndex,backPagesFor(playerCard()).length-1);}
  }
 }
 await persist();render();toast('Isi terbaru dari MCP sudah dimuat.');}
 catch(e){toast('Tidak bisa mengambil data cloud: '+e.message);}
}
async function createWithChatGPT(){const folder=state.folders.find(f=>f.id===state.activeFolderId);const destination=folder&&state.backend!=='local'?` Simpan langsung ke folder ${folder.name} menggunakan folderId=${folder.id} pada tool create_deck.`:'';const message='Buatkan satu deck flashcard Noodl. Tanyakan dulu topik dan sumber yang ingin kupakai. Untuk teori buat front, back singkat, dan tepat tiga clue pada 5/10/15 detik. Jika materi kompleks, pakai backPages[] (id unik, kind, title, blocks, sourceRefs) berisi teknik, temuan normal, abnormal, diagnosis banding, dan visual hanya jika relevan. MCP bisa membaca isi dengan get_card_content/list_card_contents/search_card_contents dan mengedit bagian terpilih dengan patch_card_content memakai expectedRevision; jangan tulis ulang deck bila hanya satu halaman berubah. Kalau sumbernya daftar tilik OSCE, jangan acak langkah: buat procedureStep berurutan 1..N dari butir tilik asli dengan checklistItem, phase, critical, sourceDocument, sourcePage. Tidak perlu clue untuk tilik; mode urutan otomatis tanpa timer. Jangan mengarang butir atau menilai kompetensi hanya dari swipe. Simpan lewat MCP create_deck. Jangan wajibkan gambar untuk kartu teks. Jika gambar hanya pelengkap, mediaRequirement=optional atau biarkan kosong; hanya pertanyaan yang tidak mungkin dijawab tanpa gambar menggunakan mediaRequirement=required_for_question. Gambar boleh pada front atau back, tetapi harus diimpor dan dicek lewat MCP sebelum dipasang. Jika ada gambar dari dokumen atau internet, benar-benar buka gambar FINAL lewat inspect_media_image, catat sumber dan lisensi, lalu gunakan attach_verified_visuals_batch dengan dua laporan pemeriksaan per gambar. Jangan minta konfirmasi manual atau mengklaim gambar sudah terpasang sebelum get_deck dan list_media menunjukkan hasilnya.'+destination;
 if(looksEmbedded()&&window.openai?.sendFollowUpMessage){try{await window.openai.sendFollowUpMessage({prompt:message});return;}catch(e){toast('Permintaan ke ChatGPT gagal.');return;}}
 const win=window.open('https://chatgpt.com/','_blank','noopener,noreferrer');try{await navigator.clipboard.writeText(message);toast('Instruksi disalin. Tempel di ChatGPT yang terhubung ke Noodl.');}catch{if(win)win.close();toast('Izinkan clipboard atau buka ChatGPT secara manual.');}
}
async function localUpload(file){if(!file||file.size>4_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Hanya PNG/JPEG/WebP maksimum 4 MB.');
 const bitmap=await createImageBitmap(file);const w=bitmap.width,h=bitmap.height;bitmap.close();if(w<32||h<32||w>4096||h>4096||w*h>12_000_000)throw Error('Dimensi gambar di luar batas aman.');
 const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)});
 if(!/^data:image\/(?:png|jpeg|webp);base64,/.test(src))throw Error('Format gambar tidak valid');
 const m={id:uuid(),status:'approved',mime:file.type,width:w,height:h,bytes:file.size,provenance:{kind:'manual',origin:file.name,sourcePage:null,license:'',description:'Unggahan pengguna'},visualReview:{observation:'Byte gambar berhasil didekode, kecocokan materi belum diperiksa.',legible:false,relevant:false},dataUrl:src};
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
 if(state.backend==='embedded')return chunkUploadViaMcp(file);
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
 if(errors.length)toast(`${success} berhasil disimpan; ${errors.length} gagal: ${errors[0]}`);
 else toast(`${success} gambar berhasil disimpan. ChatGPT dapat memeriksa dan memasangkannya ke kartu lewat MCP.`);
}

async function previewMedia(id,label='Gambar materi'){
 const media=state.media.find(m=>m.id===id);if(!media)return;
 if(state.session?.clock)state.session.clock.pause(clockMs());
 let src=mediaSrc(id);if(!src)return toast('Gambar tidak tersedia');
 const image=new Image();image.src=src;
 try{await image.decode();}catch{try{src=await ensureMediaViaMcp(id);image.src=src;await image.decode();}catch(e){return toast('Gambar gagal dibuka: '+e.message);}}
 state.modal={id,type:'media-preview',rendered:true};
 modalRoot.innerHTML=`<div class="preview-modal zoom-modal" id="visualViewer" role="dialog" aria-modal="true" aria-labelledby="mediaTitle"><div class="modal-panel zoom-modal-panel"><div class="session-head"><div><span class="kicker">ZOOM & PAN · GAMBAR SUMBER</span><h2 id="mediaTitle">${safe(label)}</h2></div><button class="button ghost" id="closePreview" aria-label="Tutup gambar">Tutup ✕</button></div><div class="image-zoom-viewport" id="imageZoomViewport" role="region" aria-label="Gambar dapat diperbesar dan digeser dengan sentuhan atau mouse"><img id="fullPreview" class="zoomable-image" src="${safe(src)}" alt="${safe(label)}" draggable="false"/></div><div class="image-zoom-toolbar" role="group" aria-label="Kontrol pembesaran gambar"><button type="button" class="button secondary" id="zoomOut" aria-label="Perkecil gambar">−</button><strong id="zoomLevel" aria-live="polite">100%</strong><button type="button" class="button secondary" id="zoomIn" aria-label="Perbesar gambar">＋</button><button type="button" class="button ghost" id="zoomReset">Atur ulang</button></div><p class="zoom-instructions">Zoom dengan dua jari atau roda mouse; geser gambar untuk melihat detail. Gestur kartu dinonaktifkan selama jendela ini terbuka.</p><div class="notice"><strong>Sumber:</strong> ${safe(media.provenance?.origin||'Tidak diketahui')} · ${media.width}×${media.height} · ${safe(media.mime)}<br><strong>Integritas:</strong> ${safe(media.sha256||'belum tercatat')}<br><strong>Lisensi:</strong> ${safe(media.provenance?.license||'sumber pribadi / belum dicatat')}</div></div></div>`;
 $('#closePreview')?.addEventListener('click',closeModal);
 installImageZoom();
}
function installImageZoom(){
 const view=$('#imageZoomViewport'),img=$('#fullPreview'),label=$('#zoomLevel');if(!view||!img)return;
 const points=new Map();let scale=1,dx=0,dy=0,pinch=null,last=null;
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const update=()=>{
  const width=img.offsetWidth||view.clientWidth,height=img.offsetHeight||view.clientHeight;
  dx=clamp(dx,-Math.max(0,(width*scale-view.clientWidth)/2),Math.max(0,(width*scale-view.clientWidth)/2));
  dy=clamp(dy,-Math.max(0,(height*scale-view.clientHeight)/2),Math.max(0,(height*scale-view.clientHeight)/2));
  img.style.transform=`translate3d(${dx}px,${dy}px,0) scale(${scale})`;
  if(label)label.textContent=Math.round(scale*100)+'%';
  view.classList.toggle('is-zoomed',scale>1.01);
 };
 const setScale=(value)=>{scale=clamp(value,1,5);if(scale===1){dx=0;dy=0;}update();};
 const distance=arr=>Math.hypot(arr[0].x-arr[1].x,arr[0].y-arr[1].y);
 view.addEventListener('pointerdown',e=>{
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});view.setPointerCapture(e.pointerId);
  if(points.size===1){last={x:e.clientX,y:e.clientY};pinch=null;}
  else if(points.size===2){pinch={distance:distance([...points.values()]),scale};last=null;}
 });
 view.addEventListener('pointermove',e=>{
  if(!points.has(e.pointerId))return;
  const old=points.get(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(points.size===2&&pinch){const now=distance([...points.values()]);setScale(pinch.scale*(now/Math.max(1,pinch.distance)));}
  else if(points.size===1&&scale>1){dx+=e.clientX-old.x;dy+=e.clientY-old.y;update();}
 });
 const end=e=>{points.delete(e.pointerId);if(points.size===1){last=[...points.values()][0];pinch=null;}else if(!points.size){pinch=null;last=null;}};
 view.addEventListener('pointerup',end);view.addEventListener('pointercancel',end);
 view.addEventListener('wheel',e=>{e.preventDefault();setScale(scale*(e.deltaY<0?1.18:1/1.18));},{passive:false});
 view.addEventListener('dblclick',()=>setScale(scale<2?2:1));
 $('#zoomIn')?.addEventListener('click',()=>setScale(scale*1.3));
 $('#zoomOut')?.addEventListener('click',()=>setScale(scale/1.3));
 $('#zoomReset')?.addEventListener('click',()=>{scale=1;dx=0;dy=0;update();});
 img.addEventListener('load',update);update();
}
function closeModal(){const wasReader=state.modal?.kind==='card-reader';state.modal=null;document.body.classList.remove('reading-open');modalRoot.innerHTML='';if(wasReader)$('#playerRead')?.focus({preventScroll:true});if(state.session&&!state.session.flipped&&document.visibilityState==='visible')state.session.clock.resume(clockMs());}
async function rejectMedia(id){const m=state.media.find(m=>m.id===id);if(!m)return;
 try{
  if(state.backend==='embedded')await hostCall('app_reject_media',{mediaId:id});
  else if(state.backend==='web'){const r=await fetch('/api/media/'+id+'/reject',{method:'POST'});if(!r.ok)throw Error((await r.json()).error);}
  m.status='rejected';delete m.dataUrl;await persist();closeModal();render();toast('Gambar ditolak.');
 }catch(e){toast('Penolakan gagal: '+e.message);}
}
function pickTargetCard(assetId){
 const media=state.media.find(m=>m.id===assetId);if(!media||media.status!=='approved')return toast('Gambar belum berhasil tersimpan atau belum lolos pemeriksaan byte.');
 const options=state.decks.flatMap(deck=>(deck.cards||[]).map(card=>({deck,card})));
 if(!options.length)return toast('Tidak ada kartu tujuan.');
 modalRoot.innerHTML=`<div class="preview-modal" role="dialog" aria-modal="true"><div class="modal-panel" style="max-width:700px"><span class="kicker">SUMBER DAN KEC0COKAN GAMBAR</span><h2>Pilih flashcard</h2><p>Pemeriksaan aset dan pemeriksaan kecocokan kartu adalah dua hal berbeda. Setelah memilih kartu, ChatGPT wajib mengirim cek sumber dan cek gambar final.</p><img class="modal-image" style="max-height:220px" src="${safe(mediaSrc(assetId))}" alt="Gambar kandidat"/><form id="attachImageForm"><label for="targetCard">Kartu tujuan</label><select class="search" style="width:100%" id="targetCard" required>${options.map(({deck,card},i)=>`<option value="${i}">${safe(deck.title)} · ${safe(card.front?.find(b=>b.type==='text')?.text||'Kartu').slice(0,90)}</option>`).join('')}</select><label for="targetPage">Target gambar</label><select class="search" style="width:100%" id="targetPage" aria-label="Halaman tempat gambar ditempel"></select><div class="modal-footer"><button type="button" class="button ghost" id="cancelAttach">Batal</button><button type="submit" class="button primary">${state.backend==='local'?'Pasang ilustrasi lokal':'Buat kandidat pemeriksaan'}</button></div></form></div></div>`;
 const setTargetPages=()=>{
  const c=options[Number($('#targetCard').value)]?.card;
  $('#targetPage').innerHTML=`<option value="front">Depan — gambar pertanyaan</option><option value="back">Belakang — jawaban inti</option>${(c?.backPages||[]).map(p=>`<option value="page:${safe(p.id)}">Deep Card · ${safe(p.title)}</option>`).join('')}`;
 };
 $('#targetCard').addEventListener('change',setTargetPages);setTargetPages();
 $('#cancelAttach').addEventListener('click',closeModal);
 $('#attachImageForm').addEventListener('submit',async event=>{event.preventDefault();const selected=options[Number($('#targetCard').value)];if(!selected)return;
  if(state.backend==='local'){
   closeModal();return toast('Mode lokal belum bisa membuktikan dua pemeriksaan per kartu. Upload dan pasang melalui backend MCP terhubung.');
  }
  try{
   const target=$('#targetPage').value;
   const args={deckId:selected.deck.id,cardId:selected.card.id,mediaId:assetId,side:target==='front'?'front':'back',...(target.startsWith('page:')?{pageId:target.slice(5)}:{})};
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
 state.decks=data.decks||state.decks;state.folders=data.folders||state.folders;state.media=data.media||state.media;state.visualBindings=data.visualBindings||[];
 await persist();render();
}
async function previewCardBinding(id){
 const binding=state.visualBindings.find(x=>x.bindingId===id);if(!binding)return toast('Pasangan tidak ditemukan.');
 try{
  const audit=await visualCall('get_card_visual_audit','/api/visual/'+id+'/audit');
  const deck=state.decks.find(d=>d.id===binding.deckId),card=deck?.cards.find(c=>c.id===binding.cardId);
  const target=binding.pageId?card?.backPages?.find(p=>p.id===binding.pageId):null;
  let src=mediaSrc(binding.mediaId),im=new Image();im.src=src;
  try{await im.decode();}catch{src=await ensureMediaViaMcp(binding.mediaId);}
  const reports=audit.checks||[];
  state.modal={type:'visual-audit',id};
  modalRoot.innerHTML=`<div class="preview-modal" role="dialog" aria-modal="true" aria-label="Audit gambar tanpa persetujuan"><div class="modal-panel"><div class="session-head"><div><span class="kicker">AUDIT VISUAL · TWO CHECKS</span><h2>Gambar dan kartu</h2></div><button class="button ghost" id="closePreview">Tutup ✕</button></div><p><b>Pertanyaan:</b> ${safe(card?.front?.find(b=>b.type==='text')?.text||'Tidak ditemukan')}</p><p><b>Target:</b> ${safe(target?.title||'Jawaban inti')}</p><img class="modal-image" src="${safe(src)}" alt="Gambar final yang disimpan"/><p class="note">Status ${safe(audit.status)} · Sumber ${safe(binding.provenance?.origin||'?')} · Gambar cocok hanya jika kedua laporan terisi dengan hasil pemeriksaan yang nyata.</p>${reports.map(r=>`<div class="notice"><strong>${safe(r.phase)} · ${safe(r.result)}</strong><p>${safe(r.report?.evidenceNote||r.report?.supportedClaim||'Tidak ada laporan')}</p></div>`).join('')}</div></div>`;
  $('#closePreview')?.addEventListener('click',closeModal);
 }catch(e){toast('Audit visual gagal: '+e.message);}
}
async function attachApprovedBinding(id){
 const b=state.visualBindings.find(x=>x.bindingId===id);if(!b)return toast('Binding tidak ditemukan.');
 const deck=state.decks.find(x=>x.id===b.deckId);if(!deck)return toast('Deck tidak ditemukan.');
 try{
  await visualCall('attach_visual_to_card','/api/visual/'+id+'/attach',{bindingId:id,operationId:uuid(),expectedRevision:deck.revision});
  await refreshVisual();toast('Gambar lolos dua pemeriksaan dan berhasil ditautkan ke kartu.');
 }catch(e){toast('Belum terpasang: '+e.message+' · Perbarui deck lalu ulangi pemasangan.');}
}

const folderNamesEqual=(a,b)=>a.trim().replace(/\s+/g,' ').toLowerCase()===b.trim().replace(/\s+/g,' ').toLowerCase();
function validFolderName(v){const name=String(v||'').trim().replace(/\s+/g,' ');if(!name||name.length>72||/[/\\\u0000-\u001f\u007f]/.test(name)||name==='.'||name==='..')throw Error('Nama folder tidak valid (1–72 karakter, tanpa slash).');return name;}
function localFolderOp(action,args){
 const existing=state.folders,folder=existing.find(f=>f.id===args.folderId);
 const destination=(args.parentId||args.folderId===null)?args.parentId:null;
 const sameName=(parentId,name,except=null)=>existing.some(f=>f.id!==except&&f.parentId===parentId&&folderNamesEqual(f.name,name));
 if(action==='create_folder'){
  const parentId=args.parentId||null,name=validFolderName(args.name);
  if(parentId&&!existing.some(f=>f.id===parentId))throw Error('Folder induk tidak ada');
  if(folderPath(parentId).length>=6)throw Error('Maksimal 6 tingkat folder');
  if(sameName(parentId,name))throw Error('Folder dengan nama yang sama sudah ada di lokasi ini');
  const next={id:uuid(),name,parentId,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};existing.push(next);return {folderId:next.id};
 }
 if(action==='move_deck_to_folder'){
  const deck=state.decks.find(d=>d.id===args.deckId);if(!deck)throw Error('Deck tidak ditemukan');
  const folderId=args.folderId||null;if(folderId&&!existing.some(f=>f.id===folderId))throw Error('Folder tujuan tidak ditemukan');
  if((deck.folderId||null)!==folderId){deck.folderId=folderId;deck.revision++;}return {deckId:deck.id,folderId};
 }
 if(!folder)throw Error('Folder tidak ditemukan');
 if(action==='rename_folder'){
  const name=validFolderName(args.name);if(sameName(folder.parentId,name,folder.id))throw Error('Nama folder sudah ada di lokasi ini');
  folder.name=name;folder.revision++;return {folderId:folder.id};
 }
 if(action==='move_folder'){
  const parentId=args.parentId||null;
  if(parentId&&!existing.some(f=>f.id===parentId))throw Error('Folder induk tidak ditemukan');
  if(parentId===folder.id||folderPath(parentId).some(p=>p.id===folder.id))throw Error('Folder tidak boleh dipindah ke dalam dirinya sendiri');
  const depth=(id)=>{const children=existing.filter(f=>f.parentId===id);return children.length?1+Math.max(...children.map(x=>depth(x.id))):1;};
  if(folderPath(parentId).length+depth(folder.id)>6)throw Error('Maksimal 6 tingkat folder');
  if(sameName(parentId,folder.name,folder.id))throw Error('Nama folder bentrok di lokasi tujuan');
  if(folder.parentId!==parentId){folder.parentId=parentId;folder.revision++;}return {folderId:folder.id,parentId};
 }
 if(action==='delete_folder'){
  for(const child of existing.filter(f=>f.parentId===folder.id)){
   if(sameName(folder.parentId,child.name,child.id))throw Error('Nama subfolder bentrok di folder induk. Pindahkan atau ubah nama lebih dulu.');
  }
  for(const child of existing)if(child.parentId===folder.id){child.parentId=folder.parentId;child.revision++;}
  for(const deck of state.decks)if(deck.folderId===folder.id){deck.folderId=folder.parentId;deck.revision++;}
  state.folders=existing.filter(f=>f.id!==folder.id);
  if(state.activeFolderId===folder.id)state.activeFolderId=folder.parentId;
  return {folderId:folder.id,deleted:true};
 }
 throw Error('Operasi folder tidak dikenal');
}
async function folderCall(action,payload){
 if(state.backend==='local'){const result=localFolderOp(action,payload);await persist();render();return result;}
 const result=state.backend==='embedded'?await hostCall(action,payload):await (async()=>{
  const endpoints={create_folder:'/api/folders',rename_folder:'/api/folders/rename',move_folder:'/api/folders/move',delete_folder:'/api/folders/delete',move_deck_to_folder:'/api/folders/move-deck'};
  const resp=await fetch(endpoints[action],{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
  const data=await resp.json();if(!resp.ok)throw Error(data.error||'Folder operation failed');return data;
 })();
 await refreshFoldersQuiet();return result;
}
async function refreshFoldersQuiet(){
 if(state.backend==='local')return;
 const {data}=await fetchCloud();state.decks=data.decks||[];state.folders=data.folders||[];state.media=data.media||[];state.visualBindings=data.visualBindings||[];
 if(state.activeFolderId&&!state.folders.some(f=>f.id===state.activeFolderId))state.activeFolderId=null;
 await persist();render();
}
function folderForm(action,id){
 const folder=state.folders.find(f=>f.id===id),deck=state.decks.find(d=>d.id===id),isCreate=action==='create',isRename=action==='rename',isDelete=action==='delete',isMoveFolder=action==='move',isMoveDeck=action==='move-deck';
 if(!isCreate&&!deck&&!folder)return toast('Folder / deck tidak ditemukan');
 const heading={create:'Buat folder baru',rename:'Ganti nama folder',delete:'Hapus folder (isi tetap aman)',move:'Pindahkan folder','move-deck':'Pindahkan deck'}[action];
 const initialParent=isCreate?state.activeFolderId:isMoveDeck?deck.folderId:folder?.parentId;
 let body='';
 if(isCreate||isRename){body=`<label class="folder-label" for="folderName">Nama folder</label><input class="search folder-input" id="folderName" name="name" maxlength="72" required value="${safe(isRename?folder.name:'')}" placeholder="Contoh: Blok 9"/><label class="folder-label" for="parentFolder">${isCreate?'Lokasi folder':'Folder induk saat ini'}</label><select class="search folder-input" id="parentFolder" name="parentId" ${isRename?'disabled':''}>${folderOptions(isRename?folder.parentId:initialParent)}</select>`;}
 else if(isMoveDeck||isMoveFolder){body=`<p>Memindahkan <b>${safe(deck?.title||folder?.name)}</b> tidak mengubah isi kartu maupun progres review.</p><label class="folder-label" for="parentFolder">Lokasi tujuan</label><select class="search folder-input" id="parentFolder" name="parentId">${folderOptions(initialParent,isMoveFolder?folder.id:null)}</select>`;}
 else if(isDelete){const sub=state.folders.filter(f=>f.parentId===folder.id).length,decks=state.decks.filter(d=>d.folderId===folder.id).length;body=`<div class="notice">Folder <b>${safe(folder.name)}</b> akan dihapus. <b>${decks} deck</b> dan <b>${sub} subfolder</b> dipindahkan satu tingkat ke atas. Tidak ada kartu, gambar, atau riwayat review yang dihapus. Jika nama subfolder bentrok, operasi dibatalkan.</div>`;}
 state.modal={type:'folder-operation',action,id};
 modalRoot.innerHTML=`<div class="preview-modal" role="dialog" aria-modal="true" aria-label="${safe(heading)}"><div class="modal-panel folder-dialog"><h2>${safe(heading)}</h2><form id="folderEditForm">${body}<div class="modal-footer"><button class="button ghost" type="button" id="cancelFolderEdit">Batal</button><button class="button ${isDelete?'danger':'primary'}" type="submit">${isDelete?'Hapus folder saja':'Simpan perubahan'}</button></div></form></div></div>`;
 $('#cancelFolderEdit').addEventListener('click',closeModal);
 $('#folderEditForm').addEventListener('submit',async event=>{
  event.preventDefault();const btn=event.target.querySelector('[type="submit"]');btn.disabled=true;
  try{
   const fd=new FormData(event.target),parentId=(fd.get('parentId')||null),operationId=uuid();let name=null,payload;
   const revision=folder?.revision??deck?.revision;
   if(isCreate){name=validFolderName(fd.get('name'));payload={operationId,name,parentId};}
   else if(isRename){name=validFolderName(fd.get('name'));payload={operationId,folderId:folder.id,expectedRevision:revision,name};}
   else if(isMoveFolder)payload={operationId,folderId:folder.id,expectedRevision:revision,parentId};
   else if(isMoveDeck)payload={operationId,deckId:deck.id,expectedRevision:revision,folderId:parentId};
   else payload={operationId,folderId:folder.id,expectedRevision:revision};
   await folderCall(({create:'create_folder',rename:'rename_folder',move:'move_folder',delete:'delete_folder','move-deck':'move_deck_to_folder'})[action],payload);
   if(isCreate){state.activeFolderId=payload.parentId;state.search='';}
   if(isDelete&&state.activeFolderId===folder.id)state.activeFolderId=folder.parentId;
   closeModal();render();toast(isDelete?'Folder dihapus; deck dan subfolder tetap aman.':'Perubahan folder disimpan.');
  }catch(e){btn.disabled=false;toast(e.message||'Gagal menyimpan folder');}
 });
 $('#folderName')?.focus();
}
function exportLocal(){const bytes=new Blob([JSON.stringify({format:'noodl-flashcards-backup-v1',exportedAt:new Date().toISOString(),decks:state.decks,folders:state.folders,reviews:state.reviews,media:state.media},null,2)],{type:'application/json'});const url=URL.createObjectURL(bytes);const a=document.createElement('a');a.href=url;a.download='noodl-flashcards-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function playTone(freq=600,duration=.09){if(!state.settings.sound)return;try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.045,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+duration);osc.onended=()=>ctx.close();}catch{}}
function vibrate(pattern=8){if(state.settings.haptics)navigator.vibrate?.(pattern)}
// All UI events use delegation; generated content is escaped and never inserted as executable HTML.
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return;}
 const folderOpen=e.target.closest('[data-open-folder]');if(folderOpen){state.activeFolderId=folderOpen.dataset.openFolder||null;state.search='';if(state.route!=='library')navigate('library');else render();return;}
 const folderAction=e.target.closest('[data-folder-action]');if(folderAction){folderForm(folderAction.dataset.folderAction,folderAction.dataset.folderId);return;}
 const moveDeckButton=e.target.closest('[data-move-deck]');if(moveDeckButton){folderForm('move-deck',moveDeckButton.dataset.moveDeck);return;}
 const deck=e.target.closest('[data-open-deck],[data-start-deck]');if(deck){startDeck(deck.dataset.openDeck||deck.dataset.startDeck);return;}
 const procedureMode=e.target.closest('[data-procedure-view]');if(procedureMode&&state.session?.procedure){const mode=procedureMode.dataset.procedureView;if(!['technique','sequence'].includes(mode)||state.session.processing)return;state.session.procedureView=mode;initCard();renderPlayer();return;}
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
 const zoom=e.target.closest('[data-zoom]');if(zoom){const id=zoom.dataset.zoom;if(state.media.some(m=>m.id===id))void previewMedia(id,zoom.getAttribute('alt')||'Gambar materi');return;}
 if(e.target.closest('#uploadMedia')){void uploadMedia();return;}
 if(e.target.closest('#refreshData')){void refresh();return;}
 if(e.target.closest('#exportLocal')){exportLocal();return;}
});
document.addEventListener('input',e=>{if(e.target.id==='deckSearch'){state.search=e.target.value;const area=$('#libraryContents');if(area)area.innerHTML=renderLibraryContents();}});
document.addEventListener('change',e=>{if(e.target.matches('[data-setting]')){state.settings[e.target.dataset.setting]=e.target.checked;applySettings();void persist();}});
$('#headerChat').addEventListener('click',()=>void createWithChatGPT());
$$('.dock .nav-btn').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
window.addEventListener('hashchange',()=>{if(state.initialized&&!state.session)navigate(location.hash.slice(1));});
window.addEventListener('online',()=>{void flushQueue();});
document.addEventListener('visibilitychange',()=>{const s=state.session;if(!s||!s.clock||s.flipped||!playerTimerEnabled(s))return;if(document.hidden||state.modal)s.clock.pause(clockMs());else s.clock.resume(clockMs());});
window.addEventListener('keydown',e=>{
 if(state.modal){if(e.key==='Escape')closeModal();return;}
 if(state.route!=='player')return;
 if(e.target.closest('input,textarea,select,[contenteditable="true"],a,button,[role="dialog"]')||e.altKey||e.metaKey||e.ctrlKey||e.shiftKey||e.repeat)return;
 if(e.key==='Escape'){e.preventDefault();navigate('review');return;}
 if(e.key===' '||e.key==='Enter'){e.preventDefault();flip();return;}
 if(e.key.toLowerCase()==='z'){e.preventDefault();void undo();return;}
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(state.session?.flipped&&hasDeepPages(playerCard()))moveDeepPage(e.key==='ArrowLeft'?-1:1);else void rate(e.key==='ArrowLeft'?0:3);return;}
 if(state.session?.flipped&&/^[1-4]$/.test(e.key)){e.preventDefault();void rate(Number(e.key)-1);}
});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
void initialize();
