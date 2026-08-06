const C='line2relief-v38';
const ASSETS=['./','./index.html','./style.css','./app.js','./depthgen.js','./manifest.webmanifest',
              './icons/icon-192.png','./icons/icon-512.png','./sample.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(k=>Promise.all(k.filter(n=>n!==C).map(n=>caches.delete(n))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(res=>{
      const cp=res.clone();
      caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
