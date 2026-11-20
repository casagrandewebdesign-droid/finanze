// Service worker: tiene in cache l'interfaccia così l'app si apre anche offline.
// I dati passano sempre dal motore (Apps Script), non vengono messi in cache qui.
// Strategia "prima la rete, senza cache del browser": ogni apertura prende l'ultima versione
// pubblicata; la copia salvata serve solo quando manca la connessione.
const C = 'finanze-v25';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-180.png', 'icon-512.png', 'world.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // chiamate al motore: sempre rete
  e.respondWith(fetch(u.href, { cache: 'no-cache' })
    .then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
