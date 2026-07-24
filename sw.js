/*
 * Schedule PWA Service Worker
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `schedule-static-${CACHE_VERSION}`;
const PAGE_CACHE = `schedule-pages-${CACHE_VERSION}`;

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL))
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    const currentCaches = [STATIC_CACHE, PAGE_CACHE];

    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names
                    .filter(name => !currentCaches.includes(name))
                    .map(name => caches.delete(name))
            )
        )
    );

    self.clients.claim();
});

self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Google APIには介入しない
    if (url.origin !== location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request));
        return;
    }

    event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {

    try {

        const response = await fetch(request);

        if (response.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(request, response.clone());
            cache.put("./index.html", response.clone());
        }

        return response;

    } catch {

        return (
            await caches.match(request) ||
            await caches.match("./index.html") ||
            await caches.match("./")
        );

    }

}

async function cacheFirst(request) {

    const cached = await caches.match(request);

    if (cached) return cached;

    const response = await fetch(request);

    if (response.ok && response.type === "basic") {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
    }

    return response;

}