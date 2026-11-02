importScripts('db.js');

const CACHE = 'guardados-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Lo que llega desde el menú "Compartir" del móvil.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      let n = 0;
      try {
        const form = await e.request.formData();
        const items = GuardadosDB.buildItems({
          title: form.get('title') || '',
          text: form.get('text') || '',
          url: form.get('url') || '',
          files: form.getAll('media').filter(f => f && typeof f !== 'string')
        });
        await GuardadosDB.putMany(items);
        n = items.length;
      } catch (err) {
        return Response.redirect('./?error=1', 303);
      }
      return Response.redirect('./?saved=' + n, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Red primero (para recibir actualizaciones), caché si no hay conexión.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
