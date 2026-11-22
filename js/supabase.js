// Collegamento a Supabase (database, accesso, tempo reale, funzioni server)
import { createClient } from "../vendor/supabase.js";
import { store } from "./store.js";

const cfg = window.DND_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY &&
  !cfg.SUPABASE_URL.includes("INCOLLA") && !cfg.SUPABASE_KEY.includes("INCOLLA"));

export const sb = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    realtime: { params: { eventsPerSecond: 20 } },
  })
  : null;

export function appUrl() {
  return location.origin + location.pathname;
}

/** Garantisce una sessione: se non c'è, crea un accesso "ospite" anonimo. */
export async function ensureSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (location.search.includes("code=")) history.replaceState(null, "", appUrl() + location.hash);
  if (session?.user) { store.user = session.user; return session.user; }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    if (/anonymous/i.test(error.message)) {
      throw new Error("Accesso ospite disattivato: in Supabase vai su Authentication → Sign In / Providers e attiva \"Allow anonymous sign-ins\".");
    }
    throw new Error("Impossibile accedere: " + error.message);
  }
  store.user = data.user;
  return data.user;
}

function cleanError(msg = "") {
  return msg.replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");
}

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(cleanError(error.message));
  // alcune funzioni restituiscono l'errore invece di sollevarlo (così i tentativi falliti restano contati)
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.error === "string") throw new Error(data.error);
  return data;
}

export async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* nessun dettaglio */ }
    if (/Failed to send|fetch/i.test(msg)) msg = `Funzione server "${name}" non raggiungibile (è stata pubblicata in Supabase?)`;
    throw new Error(msg);
  }
  return data;
}

export async function must(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(cleanError(error.message));
  return data;
}
