"use strict";

const CACHE_PREFIX = "acts-constructor-";
const CACHE_NAME = `${CACHE_PREFIX}v3.0.0-20260914-r13`;
const OFFLINE_URL = "./index.html";
const APP_SHELL = [
  "./index.html",
  "./assets/styles-v2.9.css",
  "./assets/workspace-v2.9.js",
  "./assets/app-v2.9.js",
  "./assets/xlsx-template-v2.3.js",
  "./assets/pwa-v2.9.css",
  "./assets/pwa-v2.9.js",
  "./assets/hero-city-color-v2.10.png",
  "./assets/icons-v2.9.svg",
  "./assets/icon-zoom-out-v3.svg",
  "./assets/icon-zoom-in-v3.svg",
  "./assets/icon-fullscreen-v3.svg",
  "./assets/icon-close-v3.svg",
  "./assets/icon-chevron-down-v3.svg",
  "./assets/icon-download-v3.svg",
  "./assets/pictogram-heart-v3.svg",
  "./assets/icon-status-success-v3.svg",
  "./assets/icon-status-warning-v3.svg",
  "./assets/icon-status-error-v3.svg",
  "./assets/pictogram-document-check-v2.9.svg",
  "./assets/pictogram-preview-v2.9.svg",
  "./assets/pictogram-signature-v2.9.svg",
  "./assets/pictogram-excel-v2.9.svg",
  "./assets/pictogram-shield-v2.9.svg",
  "./assets/pictogram-repeat-v2.9.svg",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./manifest.webmanifest",
  "./preview-v3.0.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./fonts/GolosText-Regular.woff2",
  "./fonts/GolosText-Medium.woff2",
  "./fonts/GolosText-SemiBold.woff2",
  "./fonts/GolosText-Bold.woff2",
  "./fonts/GolosText-ExtraBold.woff2"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = APP_SHELL.map(url => new Request(url, { cache: "reload" }));
    await cache.addAll(requests);
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(OFFLINE_URL, response.clone());
      return response;
    }
    return (await caches.match(OFFLINE_URL, { ignoreSearch: true })) || response;
  } catch (_) {
    return (await caches.match(OFFLINE_URL, { ignoreSearch: true })) || Response.error();
  }
}

function updateCache(request) {
  return fetch(request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const networkPromise = updateCache(request);
  event.waitUntil(networkPromise.catch(() => undefined));
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || networkPromise).catch(() => networkPromise)
  );
});
