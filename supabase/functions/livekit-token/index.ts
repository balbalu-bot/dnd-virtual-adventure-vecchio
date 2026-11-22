// =====================================================================
//  D&D Virtual Adventure — Edge Function "livekit-token"
//  Rilascia il "biglietto" (token) per entrare nella stanza audio/video
//  SOLO a chi è membro attivo della partita. La chiave segreta LiveKit
//  resta qui sul server (Supabase → Edge Functions → Secrets) e non
//  finisce mai nel codice pubblicato su GitHub.
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

/** Crea un token LiveKit (JWT HS256) firmato con la chiave segreta. */
export async function signLiveKitToken(
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  try {
    const API_KEY = Deno.env.get("LIVEKIT_API_KEY");
    const API_SECRET = Deno.env.get("LIVEKIT_API_SECRET");
    const LK_URL = Deno.env.get("LIVEKIT_URL");
    if (!API_KEY || !API_SECRET || !LK_URL) {
      return json({ error: "Server audio non configurato: mancano i segreti LIVEKIT_* nella Edge Function" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Accesso non effettuato" }, 401);

    const { game_id } = await req.json().catch(() => ({}));
    if (typeof game_id !== "string" || !/^[0-9a-f-]{36}$/i.test(game_id)) {
      return json({ error: "Partita non valida" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Sessione non valida" }, 401);
    const uid = userData.user.id;

    // La lettura passa dalle regole di sicurezza del database (RLS)
    const { data: m, error: mErr } = await sb
      .from("members")
      .select("role,status,display_name,character_name")
      .eq("game_id", game_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (mErr) return json({ error: "Errore database: " + mErr.message }, 500);
    if (!m || m.status !== "active") return json({ error: "Non sei autorizzato in questa partita" }, 403);

    const room = `game-${game_id}`;
    const token = await signLiveKitToken(API_KEY, API_SECRET, {
      sub: uid,
      jti: `${uid}-${Date.now()}`,
      name: m.display_name,
      metadata: JSON.stringify({ role: m.role, character: m.character_name ?? "" }),
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,          // l'app non usa messaggi via audio/video: niente canale dati
        canUpdateOwnMetadata: false,
        canPublishSources: ["microphone", "camera"],
      },
    }, 10 * 60);  // 10 minuti: serve solo per collegarsi. Un escluso non può riusarlo a lungo,
                  // e "livekit-guard" scollega comunque chi non è più membro attivo.

    return json({ token, url: LK_URL, room });
  } catch (e) {
    return json({ error: "Errore interno: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
