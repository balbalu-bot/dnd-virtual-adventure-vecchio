// Avvio dell'app e navigazione tra le schermate
import { configured, ensureSession, sb } from "./supabase.js";
import { h } from "./ui.js";
import { renderLobby } from "./lobby.js";
import { enterGame, leaveGameScreen } from "./game.js";

const app = document.getElementById("app");
let current = null; // "lobby" | "game"

export function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

async function route() {
  const hash = location.hash || "#/";
  const gameMatch = hash.match(/^#\/game\/([0-9a-f-]{36})/i);
  const joinMatch = hash.match(/^#\/join\/([A-Za-z0-9-]{4,12})/);
  if (current === "game" && !gameMatch) await leaveGameScreen();
  if (gameMatch) {
    current = "game";
    await enterGame(app, gameMatch[1]);
  } else {
    current = "lobby";
    await renderLobby(app, { joinCode: joinMatch ? joinMatch[1] : null });
  }
}

function renderSetupNeeded() {
  app.replaceChildren(h("div", { class: "setup-screen" },
    h("div", { class: "parchment setup-card" },
      h("h1", { class: "title-font" }, "D&D Virtual Adventure"),
      h("h2", {}, "Configurazione da completare"),
      h("p", {}, "Il sito è pubblicato correttamente, ma non è ancora collegato al database."),
      h("ol", {},
        h("li", {}, "Apri il file ", h("code", {}, "config.js"), " nel repository GitHub."),
        h("li", {}, "Incolla l'indirizzo del progetto Supabase e la chiave pubblica (anon / publishable)."),
        h("li", {}, "Salva (Commit) e attendi un minuto, poi ricarica questa pagina.")),
      h("p", { class: "muted" }, "Trovi la procedura completa nel file README.md, sezione 3."))));
}

function renderFatal(err) {
  app.replaceChildren(h("div", { class: "setup-screen" },
    h("div", { class: "parchment setup-card" },
      h("h2", {}, "Qualcosa non va"),
      h("p", {}, err.message || String(err)),
      h("button", { class: "btn btn-primary", onclick: () => location.reload() }, "Riprova"))));
}

async function boot() {
  if (!configured) { renderSetupNeeded(); return; }
  try {
    await ensureSession();
  } catch (e) { renderFatal(e); return; }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") location.reload();
    if (session?.user) import("./store.js").then(({ store }) => { store.user = session.user; });
  });
  window.addEventListener("hashchange", route);
  await route();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* opzionale */ });
  }
}

// Installazione come app (PWA) su Android / Chrome / Edge
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  document.dispatchEvent(new CustomEvent("pwa-installable"));
});

boot();
