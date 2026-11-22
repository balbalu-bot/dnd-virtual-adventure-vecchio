// =====================================================================
//  D&D Virtual Adventure — Edge Function "livekit-guard"
//  "Buttafuori" del server audio/video: confronta chi è collegato alla
//  stanza LiveKit con l'elenco dei membri ATTIVI della partita nel
//  database e scollega subito chiunque non sia (più) autorizzato:
//  esclusi, usciti, rifiutati, sconosciuti.
//
//  Viene chiamata:
//   - dal database, ogni volta che un membro attivo viene escluso o esce
//     (trigger members_voice_sweep → pg_net);
//   - da LiveKit Cloud (webhook), ogni volta che qualcuno entra nella stanza;
//   - dal pannello del DM.
//  Può essere chiamata da chiunque senza danni: l'unica cosa che fa è
//  applicare le regole del database (non può mai far entrare nessuno).
//
//  Impostazioni: "Verify JWT" DISATTIVATO (la chiamano anche LiveKit e il
//  database). Segreti: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL.
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già forniti da Supabase.
// =====================================================================å
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sign(apiKey: string, apiSecret: string, claims: Record<string, unknown>, ttl: number) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: apiKey, nbf: now - 10, exp: now + ttl, ...claims }))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${data}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))))}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
    const SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
    const LK_URL = Deno.env.get("LIVEKIT_URL") ?? "";
    if (!KEY || !SECRET || !LK_URL) return json({ error: "Server audio non configurato" }, 500);

    const raw = await req.text();
    if (raw.length > 20000) return json({ error: "Richiesta troppo grande" }, 413);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "Richiesta non valida" }, 400); }

    // game_id diretto (database / DM) oppure evento webhook di LiveKit (room.name = "game-<id>")
    let gameId = typeof body.game_id === "string" ? body.game_id : "";
    const roomName = (body.room as { name?: string } | undefined)?.name;
    if (!gameId && typeof roomName === "string" && roomName.startsWith("game-")) gameId = roomName.slice(5);
    if (!UUID.test(gameId)) return json({ ok: true, skipped: "nessuna partita" });
    const room = `game-${gameId}`;

    // elenco dei membri attivi, letto con i privilegi del server
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: members, error } = await admin.from("members").select("user_id").eq("game_id", gameId).eq("status", "active");
    if (error) return json({ error: "Errore database: " + error.message }, 500);
    const allowed = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));

    const host = LK_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
    const call = async (method: string, payload: unknown) => {
      const tok = await sign(KEY, SECRET, { sub: "dnd-guard", video: { room, roomAdmin: true, roomList: true } }, 60);
      const res = await fetch(`${host}/twirp/livekit.RoomService/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method}: ${res.status} ${text}`);
      return text ? JSON.parse(text) : {};
    };

    let list: Array<{ identity: string }> = [];
    try { list = (await call("ListParticipants", { room })).participants ?? []; }
    catch (_e) { return json({ ok: true, skipped: "stanza vuota o inesistente" }); }

    const removed: string[] = [];
    for (const p of list) {
      if (allowed.has(p.identity)) continue;
      try { await call("RemoveParticipant", { room, identity: p.identity }); removed.push(p.identity); } catch (_e) { /* già uscito */ }
    }
    // se la partita non ha più membri attivi (cancellata), chiude la stanza
    if (!allowed.size) { try { await call("DeleteRoom", { room }); } catch (_e) { /* niente */ } }
    return json({ ok: true, connected: list.length, removed: removed.length });
  } catch (e) {
    return json({ error: "Errore interno: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
