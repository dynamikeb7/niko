// NiKo Service Worker: nur für Benachrichtigungen, kein Offline-Cache.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'NiKo';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    lang: 'de',
    data: { url: data.url || self.registration.scope },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || self.registration.scope, self.registration.scope);
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        await c.focus();
        c.postMessage({ type: 'niko-open', url: target.href });
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
