/* 离线缓存：只缓存白名单内的应用自身文件。
   路径全部相对于 Service Worker 注册作用域（GitHub Pages 子路径也能正常工作）。 */
const CACHE = "ticket-v9";
const BASE = new URL("./", self.registration.scope).pathname;
const REL = ["", "index.html", "parser.js", "manifest.webmanifest", "icon.svg", "assets/icon-192.png", "assets/icon-512.png"];
const ASSETS = REL.map((p) => BASE + p);
const ALLOW = new Set(ASSETS);
const DOC = BASE + "index.html";

function put(key, res) {
  if (!res || res.status !== 200) return;
  caches.open(CACHE).then((c) => c.put(key, res)).catch(() => {});
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 跨域一律不管

  const isDoc = req.mode === "navigate";
  const key = isDoc && (url.pathname === BASE || url.pathname === BASE.slice(0, -1)) ? DOC : url.pathname;
  if (!ALLOW.has(key)) return;                            // 白名单外不接管

  if (isDoc) {
    /* 文档：先网络，拿不到新版本就回落缓存，保证离线能启动 */
    e.respondWith(
      fetch(req)
        .then((res) => { put(DOC, res.clone()); return res; })
        .catch(() => caches.match(DOC).then((r) => r || caches.match(BASE)))
    );
    return;
  }

  /* 静态资源：先缓存，没有再请求并写入 */
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => { put(key, res.clone()); return res; });
    })
  );
});
