/* News-Views service worker — network-first pages, SWR assets, offline fallback */
const V = "nv-v2";
const CORE = ["/", "/offline/", "/styles.css", "/site.js", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    // pages: always try network (fresh jobs), fall back to cache, then offline page
    e.respondWith(
      fetch(req).then((r) => {
        const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); return r;
      }).catch(() => caches.match(req).then((m) => m || caches.match("/offline/")))
    );
  } else {
    // assets: stale-while-revalidate
    e.respondWith(
      caches.match(req).then((m) => {
        const net = fetch(req).then((r) => {
          const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); return r;
        }).catch(() => m);
        return m || net;
      })
    );
  }
});
