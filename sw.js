// =====================================================
// SERVICE WORKER - OrderFlow
// Per ora gestisce solo l'installabilità come PWA e una
// cache di base della "shell" dell'app (HTML/CSS/JS/icone),
// così l'app si apre anche con connessione instabile.
// Le notifiche push in background arriveranno in un
// secondo momento, quando collegherai Cloud Functions + FCM.
// =====================================================

const CACHE_NAME = "orderflow-shell-v2";
const APP_SHELL = [
    "/ordini",
    "/manifest.json",
    "/js/ordini-app.js",
    "/js/firebase-config.js",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Network-first per i dati (Firestore fa da sé la sua gestione realtime/offline),
// cache-first per la shell statica dell'app.
self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req)
                .then((res) => {
                    // aggiorna la cache in background con l'ultima versione
                    if (res && res.status === 200 && res.type === "basic") {
                        const resClone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                    }
                    return res;
                })
                .catch(() => cached);
        })
    );
});
