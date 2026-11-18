// Tidemark service worker: makes the app open offline and shows reminder notifications.
// Bump VERSION whenever you change files in this folder, so devices pick up the new copy.
const VERSION = 'v6';
const CACHE = `tidemark-${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/sync.js', './js/db.js', './vendor/supabase.js',
  './fonts/bricolage.woff2', './fonts/instrument.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png', './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tidemark-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: try the network briefly so updates arrive, fall back to the saved copy.
// Fonts, icons and the Supabase library never change, so they come straight from the cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Supabase calls pass through

  const fixed = /\/(fonts|icons|vendor)\//.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (fixed && cached) return cached;
    try {
      const fresh = await fetchWithTimeout(req, cached ? 3000 : 15000);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      if (cached) return cached;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});

function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal, cache: 'no-cache' }).finally(() => clearTimeout(timer));
}

// ---------- reminders ----------

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* empty or unreadable push */ }

  let title = 'Tidemark';
  let body = 'You have a reminder.';
  if (data.type === 'test') {
    title = 'Tidemark reminders work';
    body = 'This device will be notified when a reminder is due.';
  } else if (data.type === 'reminder') {
    title = data.title || 'Untitled task';
    body = dueText(data);
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: data.id || 'tidemark',
    renotify: true,
    data: { id: data.id || null },
  }));
});

// The server sends the raw deadline; formatting here uses this device's language and time zone.
function dueText(data) {
  if (!data.due_at) return 'Reminder';
  const due = new Date(data.due_at);
  const now = new Date();
  const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  const time = data.all_day ? '' : ' at ' + new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(due);
  if (!data.all_day && due < now) return 'Was due' + (days === 0 ? ' today' : ' on ' + shortDate(due)) + time;
  if (days < 0) return 'Was due on ' + shortDate(due);
  if (days === 0) return 'Due today' + time;
  if (days === 1) return 'Due tomorrow' + time;
  return 'Due ' + new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(due) + ', ' + shortDate(due) + time;
}
const shortDate = (d) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.id;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.focus();
      if (id) existing.postMessage({ type: 'open-task', id });
    } else {
      await self.clients.openWindow(self.registration.scope + (id ? '#task=' + id : ''));
    }
  })());
});
