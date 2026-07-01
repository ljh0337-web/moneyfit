const CACHE = "moneyfit-v2";
const SHELL = ["/app/manifest.json", "/app/icons/icon.svg", "/app/icons/icon-192.png", "/app/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // API는 항상 네트워크

  // app.html(및 다른 HTML 문서)은 네트워크 우선 — 배포 즉시 최신 버전을 받도록 함
  if (e.request.mode === "navigate" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match("/app/app.html")))
    );
    return;
  }

  // 그 외 정적 자원(아이콘 등)은 캐시 우선
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
