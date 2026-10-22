/* ClassBase の端末通知（Web Push）専用の Service Worker。
 * 画面のキャッシュやオフライン対応はしない（fetch は扱わない）。
 * 「この端末に通知を送る」をオンにした時だけ登録される。 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function sameOriginLink(value) {
  try {
    const url = new URL(typeof value === 'string' && value ? value : '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : '創造学園アプリ';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'ja',
    data: { link: sameOriginLink(data.link) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = sameOriginLink(event.notification.data && event.notification.data.link);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ('navigate' in client) {
        try {
          await client.navigate(target);
        } catch {
          // 別の画面に移れない場合はそのまま前面に出す。
        }
      }
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
