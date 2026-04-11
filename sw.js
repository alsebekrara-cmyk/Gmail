const CACHE='cashier-v9';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
    const url=new URL(e.request.url);
    /* Firebase/CDN: always network first */
    if(url.hostname.includes('firebase')||url.hostname.includes('gstatic')||url.hostname.includes('googleapis')||url.hostname.includes('cdn.jsdelivr')){
        e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
        return;
    }
    /* App files: network first, fallback to cache */
    e.respondWith(
        fetch(e.request).then(resp=>{
            if(resp&&resp.status===200){
                const clone=resp.clone();
                caches.open(CACHE).then(c=>c.put(e.request,clone));
            }
            return resp;
        }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
    );
});
