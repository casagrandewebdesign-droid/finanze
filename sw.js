// Service worker: tiene in cache l'interfaccia così l'app si apre subito, anche offline.
// I dati passano sempre dal motore (Apps Script), non vengono messi in cache qui.
// Strategia: l'app si apre dalla copia salvata (istantaneo) e intanto scarica la versione nuova.
// A ogni pubblicazione il deploy cambia __BUILD__: il nuovo service worker si installa,
// prende il controllo e la pagina si ricarica una volta da sola (vedi index.html).
const C = 'finanze-__BUILD__';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-180.png', 'icon-512.png', 'world.json'];

self.addEventListener('install', e => {
  // cache:'reload' salta la cache HTTP di GitHub Pages: si salvano sempre i file appena pubblicati
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // chiamate al motore: sempre rete
  if (u.pathname.endsWith('/sw.js')) return;
  const rete = fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  });
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(c => c || rete));
  e.waitUntil(rete.catch(() => {}));
});
