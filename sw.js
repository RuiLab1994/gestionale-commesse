const CACHE = 'commesse-v4';
const SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

// Installa e precacha la shell (non blocca se qualche risorsa fallisce)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

// Attiva e pulisce cache vecchie
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Riceve l'ordine di attivarsi subito (usato per l'aggiornamento immediato)
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Google APIs e OAuth → sempre rete (non cachare mai)
  if (url.includes('googleapis.com') || url.includes('accounts.google.com') || url.includes('gsi/client') || url.includes('generativelanguage')) {
    e.respondWith(fetch(req).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Pagina / navigazione / index.html → NETWORK-FIRST:
  // carica sempre l'ultima versione dalla rete, cade sulla cache solo se offline.
  const isPagina = req.mode === 'navigate' || url.endsWith('/') || url.endsWith('/index.html') || url.endsWith('index.html');
  if (isPagina) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match(req)))
    );
    return;
  }

  // Risorse statiche (icone, font, css) → CACHE-FIRST, poi rete
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === 'opaque') return resp;
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        return resp;
      });
    })
  );
});
