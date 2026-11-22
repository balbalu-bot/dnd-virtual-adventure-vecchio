// Service worker minimale: rende l'app installabile e veloce da riaprire.
// Il gioco vero (chat, voce, video) richiede sempre la connessione.
const VERSION = "dndva-v5.0.0";
const SHELL = [
  "./", "index.html", "config.js", "css/app.css", "css/themes.css", "manifest.webmanifest",
  "js/main.js", "js/ui.js", "js/store.js", "js/supabase.js", "js/lobby.js", "js/characters.js",
  "js/game.js", "js/chat.js", "js/voice.js", "js/voice-permissions.js", "js/video.js", "js/dm-panel.js",
  "js/dice.js", "js/sheet.js", "js/combat.js", "js/audio.js", "js/chronicle.js", "js/dm-tools.js", "js/campaign-io.js", "js/map/grid.js", "js/map/engine.js", "js/map/table.js", "js/options.js", "js/dice3d.js", "js/monsters.js", "js/guide.js",
  "vendor/supabase.js", "vendor/livekit-client.js",
  "icons/icon.svg", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const immutable = /\/(vendor|fonts|icons)\//.test(url.pathname);
  if (immutable) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }
  // Rete prima (così vedi sempre l'ultima versione), cache se sei offline
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))),
  );
});
