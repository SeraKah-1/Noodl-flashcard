const VERSION='noodl-flashcards-v0.11-optional-visual';
const SHELL=['/','/index.html','/styles.css','/app.js','/shared/logic.js','/shared/mediaPolicy.js','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/mcp')return;
 if(!SHELL.includes(url.pathname))return;
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(resp=>{if(resp.ok)caches.open(VERSION).then(c=>c.put(req,resp.clone()));return resp;})));
});
