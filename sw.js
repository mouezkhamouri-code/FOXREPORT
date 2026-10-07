'use strict';
const VERSION = 'foxreport-shell-d3ce9f50e8508202';
const FILES = [
    'offline.html','manifest.webmanifest','assets/app.css','assets/app.js','assets/local-store.js',
    'assets/pwa.js','assets/offline.js','assets/photos.js','assets/scanner.js','assets/location.js','assets/report-list.js','assets/install.js','assets/sync-client.js','assets/connection.js','assets/update.js',
    'assets/icons/icon-192.png','assets/icons/icon-512.png','assets/icons/icon-maskable.png',
    'assets/icons/apple-touch-icon.png','assets/icons/favicon.ico','assets/icons/favicon-32.png',
    'assets/ocr/worker.min.js','assets/ocr/eng.traineddata.gz',
    'assets/ocr/tesseract-core-lstm.wasm.js','assets/ocr/tesseract-core-lstm.wasm',
    'assets/ocr/tesseract-core-simd-lstm.wasm.js','assets/ocr/tesseract-core-simd-lstm.wasm',
];
const root = new URL('./', self.location.href);
const allowed = new Set(FILES.map(file => new URL(file,root).href));
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache =>
    cache.addAll(FILES.map(file=>new Request(new URL(file,root).href,{cache:'reload'}))))));
self.addEventListener('message', event => {
    if(event.data?.type==='FOXREPORT_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const name of await caches.keys()) {
        if (name.startsWith('foxreport-shell-') && name !== VERSION) await caches.delete(name);
    }
    await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== root.origin) return;
    const asset=new URL(url);
    asset.searchParams.delete('v');
    if (request.mode==='navigate' && url.pathname===new URL('offline.html',root).pathname) {
        event.respondWith(caches.match(new URL('offline.html',root).href));
    } else if (allowed.has(asset.href)) {
        event.respondWith(caches.open(VERSION).then(async cache => {
            if(url.searchParams.has('v') && url.searchParams.get('v')!==VERSION) {
                try { return await fetch(request); } catch { return await cache.match(asset.href); }
            }
            return await cache.match(asset.href) || fetch(request);
        }));
    } else if (request.mode === 'navigate' && url.pathname === new URL('index.php',root).pathname && !url.searchParams.has('api')) {
        event.respondWith(fetch(request).catch(() => {
            // No private report, photo, PDF or auth response is stored in the service worker cache.
            return caches.match(new URL('offline.html',root).href);
        }));
    }
});
