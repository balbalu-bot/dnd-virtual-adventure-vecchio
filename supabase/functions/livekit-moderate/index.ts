// =====================================================================
//  D&D Virtual Adventure — Edge Function "livekit-moderate"
//  Comandi del Dungeon Master sul server audio/video:
//    - "mute":  spegne il microfono di un partecipante per tutti
//    - "kick":  scollega un partecipante dalla stanza audio/video
//  Solo il DM della partita può usarla (controllo sul database).
//
//  Segreti richiesti: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signLiveKitToken(
  apiKey: string, apiSecret: string, claims: Record<string, unknown>, ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: apiKey, nbf: now - 10, exp: now + ttlSeconds, ...claims };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

async function roomService(method: string, body: unknown, room: string, env: Record<string, string>) {
  const host = env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
  const token = await signLiveKitToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    sub: "dnd-moderator",
    video: { room, roomAdmin: true },
  }, 60);
  const res = await fetch(`${host}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LiveKit ${method}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  try {
    const env = {
      LIVEKIT_API_KEY: Deno.env.get("LIVEKIT_API_KEY") ?? "",
      LIVEKIT_API_SECRET: Deno.env.get("LIVEKIT_API_SECRET") ?? "",
      LIVEKIT_URL: Deno.env.get("LIVEKIT_URL") ?? "",
    };
    if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
      return json({ error: "Server audio non configurato" }, 500);
    }

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Accesso non effettuato" }, 401);

    const { game_id, action, target } = await req.json().catch(() => ({}));
    if (typeof game_id !== "string" || typeof target !== "string" || !["mute", "kick"].includes(action)) {
      return json({ error: "Richiesta non valida" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
    );
    const { data: userData } = await sb.auth.getUser(jwt);
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Sessione non valida" }, 401);

    const { data: game } = await sb.from("games").select("dm_id").eq("id", game_id).maybeSingle();
    if (!game || game.dm_id !== uid) return json({ error: "Solo il Dungeon Master può farlo" }, 403);
    if (target === uid) return json({ error: "Non puoi moderare te stesso" }, 400);

    const room = `game-${game_id}`;

    if (action === "kick") {
      try {
        await roomService("RemoveParticipant", { room, identity: target }, room, env);
      } catch (_e) { /* il partecipante potrebbe essere già uscito */ }
      return json({ ok: true });
    }

    // action === "mute": spegne tutte le tracce microfono del partecipante
    const info = await roomService("GetParticipant", { room, identity: target }, room, env);
    const tracks: Array<Record<string, unknown>> = info?.tracks ?? [];
    let muted = 0;
    for (const t of tracks) {
      const src = t.source;
      const type = t.type;
      const isMic = src === "MICROPHONE" || src === 2 ||
        ((src === undefined || src === "UNKNOWN" || src === 0) && (type === "AUDIO" || type === 0 || type === undefined));
      if (!isMic) continue;
      await roomService("MutePublishedTrack", { room, identity: target, track_sid: t.sid, muted: true }, room, env);
      muted++;
    }
    return json({ ok: true, muted });
  } catch (e) {
    return json({ error: "Errore interno: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
