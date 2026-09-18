"use strict";

const CACHE_PREFIX = "acts-constructor-";
const CACHE_NAME = `${CACHE_PREFIX}v3.1.0-20260918-r17`;
const OFFLINE_URL = "./index.html";
const APP_SHELL = [
  "./index.html",
  "./README.md",
  "./assets/styles.css",
  "./assets/about.css",
  "./assets/about.js",
  "./assets/theme.css",
  "./assets/theme.js",
  "./assets/workspace.js",
  "./assets/text-normalize.js",
  "./assets/app.js",
  "./assets/xlsx-template.js",
  "./assets/pwa.css",
  "./assets/pwa.js",
  "./assets/hero-city-color.png",
  "./assets/icon-zoom-out.svg",
  "./assets/icon-zoom-in.svg",
  "./assets/icon-fullscreen.svg",
  "./assets/icon-close.svg",
  "./assets/icon-chevron-down.svg",
  "./assets/icon-download.svg",
  "./assets/pictogram-heart.svg",
  "./assets/icon-status-success.svg",
  "./assets/icon-status-warning.svg",
  "./assets/icon-status-error.svg",
  "./assets/pictogram-document-check.svg",
  "./assets/pictogram-preview.svg",
  "./assets/pictogram-signature.svg",
  "./assets/pictogram-excel.svg",
  "./assets/pictogram-shield.svg",
  "./assets/pictogram-repeat.svg",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./manifest.webmanifest",
  "./preview.png",
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
