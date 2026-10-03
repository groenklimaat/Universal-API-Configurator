/* ================================================================
   UNIVERSAL API MONITOR — Service Worker
   Versie: 1.0.0
   Doel: offline caching van de app + network-first voor API's
   ================================================================ */
'use strict';

/* ================================================================
   1. CONFIGURATIE
   ================================================================ */

// Verhoog dit nummer bij elke nieuwe versie → oude caches worden gewist
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME    = 'universal-api-monitor-' + CACHE_VERSION;

// Bestanden die bij installatie al in de cache gaan (offline werken)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/privacy',
  '/manifest.json',
  '/static/app.js',
  '/static/logo.svg',
  '/static/privacy-shield.svg',
  '/static/favicon.svg',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/icon-912.png',
  '/static/icons/maskable-512.png',
  '/static/icons/apple-touch-icon.png'
];

// Paden die NOOIT gecached mogen worden (dynamisch, POST, etc.)
const NEVER_CACHE = [
  '/api/proxy',
  '/api/config',
  '/api/test',
  '/api/health'
];

/* ================================================================
   2. INSTALL — precache alle statische assets
   ================================================================ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installeren…');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precache vullen:', PRECACHE_ASSETS.length, 'bestanden');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())   // nieuwe SW meteen activeren
      .catch((err) => console.error('[SW] Precache mislukt:', err))
  );
});

/* ================================================================
   3. ACTIVATE — oude caches opruimen
   ================================================================ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activeren…');

  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Oude cache verwijderen:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())   // meteen pagina's overnemen
  );
});

/* ================================================================
   4. FETCH — routering van verzoeken
   ================================================================ */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 4a. Alleen GET-verzoeken cachen (POST/PUT/DELETE gaan altijd naar netwerk)
  if (request.method !== 'GET') {
    return;   // browser handelt het af
  }

  // 4b. API-routes NOOIT cachen — altijd live
  if (NEVER_CACHE.some((path) => url.pathname.startsWith(path))) {
    return;
  }

  // 4c. Externe API-verzoeken (andere host) NOOIT cachen
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4d. Alles hier = statische eigen asset → cache-first strategie
  event.respondWith(cacheFirst(request));
});

/* ================================================================
   5. STRATEGIE: Cache-first
   - Kijk eerst in cache
   - Zo niet gevonden → fetch van netwerk → bewaar in cache
   - Bij offline en niet in cache → fallback naar /index.html
   ================================================================ */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    // Alleen OK-responses cachen (geen 404, 500, …)
    if (response && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch (err) {
    // Offline én niet in cache → navigatie-fallback
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    // Anders: lege response (of je kan een offline.html serveren)
    return new Response('Offline — niet in cache', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* ================================================================
   6. MESSAGE — communicatie met de pagina
   Ondersteunt: { type: 'SKIP_WAITING' } en { type: 'CLEAR_CACHE' }
   ================================================================ */
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ ok: true });
          }
        })
    );
  }
});

/* ================================================================
   7. PUSH — optionele notificaties (indien later gebruikt)
   ================================================================ */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'Universal API Monitor', body: '' };
  try {
    payload = Object.assign(payload, event.data.json());
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/icon-192.png',
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});