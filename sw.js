/*
 * schedule PWA Service Worker
 * Google Calendar / OAuthなど外部オリジンの通信には介入しない。
 */

const CACHE_VERSION = "v1.0.0";
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
    caches.open(STATIC_CACHE).then(async cache => {
      // 1ファイルの404でService Worker全体を失敗させない
      await Promise.allSettled(
        APP_SHELL.map(path => cache.add(path))
      );
    })
  );
});

self.addEventListener("activate", event => {
  const activeCaches = new Set([STATIC_CACHE, PAGE_CACHE]);

  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(name => !activeCaches.has(name))
          .map(name => caches.delete(name))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if(request.method !== "GET") return;

  const url = new URL(request.url);

  // Google API、Googleログイン、CDNなど外部通信には介入しない
  if(url.origin !== self.location.origin) return;

  if(request.mode === "navigate"){
    event.respondWith(networkFirstPage(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstPage(request){
  try{
    const response = await fetch(request);

    if(isCacheable(response)){
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(request, response.clone());
      await cache.put("./index.html", response.clone());
    }

    return response;
  }catch(error){
    return (
      await caches.match(request) ||
      await caches.match("./index.html") ||
      await caches.match("./") ||
      offlineResponse()
    );
  }
}

async function staleWhileRevalidate(request){
  const cached = await caches.match(request);

  const network = fetch(request).then(async response => {
    if(isCacheable(response)){
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await network || Response.error();
}

function isCacheable(response){
  return response && response.ok && response.type === "basic";
}

function offlineResponse(){
  return new Response(
    `<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="theme-color" content="#0D1117">
        <title>schedule — オフライン</title>
        <style>
          body{
            margin:0;min-height:100vh;display:grid;place-items:center;
            padding:24px;box-sizing:border-box;font-family:system-ui,sans-serif;
            background:#0D1117;color:#DCE3EA;text-align:center
          }
          main{max-width:420px}
          h1{font-size:1.25rem}
          p{color:#8B98A6;line-height:1.7}
        </style>
      </head>
      <body>
        <main>
          <h1>オフラインです</h1>
          <p>インターネットに接続した状態で一度アプリを開くと、次回から画面をオフラインでも開けます。</p>
        </main>
      </body>
    </html>`,
    {
      status:503,
      headers:{"Content-Type":"text/html; charset=utf-8"}
    }
  );
}

self.addEventListener("message", event => {
  if(event.data?.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});
