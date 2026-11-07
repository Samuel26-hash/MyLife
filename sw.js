// MyLife Service Worker – V15.2
// Wichtig: Die Seite (index.html) wird IMMER zuerst frisch aus dem Internet geladen.
// Nur wenn du offline bist, kommt die gespeicherte Version. So sind Updates sofort sichtbar.
const CACHE = 'mylife-v15-2';
const CORE = ['./', './index.html', './favicon.ico', './favicon-32.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));   // alte Versionen löschen
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data && (e.data === 'SKIP_WAITING' || e.data.type === 'SKIP_WAITING')) self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // fremde Seiten (APIs, Wetter …) nie anfassen
  if (url.pathname.startsWith('/api/')) return;            // Server-Funktionen nie zwischenspeichern
  const isPage = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html') || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isPage) {
    // Netzwerk zuerst → immer die neueste Version
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put('./index.html', fresh.clone()).catch(() => { }); }
        return fresh;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  // Bilder/Icons usw.: schnell aus dem Speicher, im Hintergrund aktualisieren
  e.respondWith((async () => {
    const c = await caches.open(CACHE), hit = await c.match(req);
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()).catch(() => { }); return r; }).catch(() => hit);
    return hit || net;
  })());
});

// ---------- Push-Mitteilungen ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  if (d.notification && typeof d.notification === 'object') d = Object.assign({}, d, d.notification);
  const title = d.title || 'MyLife';
  const opt = {
    body: d.body || d.text || d.message || '',
    icon: d.icon || './icon-192.png',
    badge: d.badge || './favicon-32.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: !!d.requireInteraction,
    data: Object.assign({ url: d.url || (d.data && d.data.url) || './' }, d.data || {})
  };
  e.waitUntil(self.registration.showNotification(title, opt));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.location.origin)) { try { await c.focus(); if ('navigate' in c && c.url !== target && target !== self.location.origin + '/') await c.navigate(target); } catch (err) { } return; } }
    await self.clients.openWindow(target);
  })());
});
