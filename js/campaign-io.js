// =====================================================================
//  Esportazione / importazione di una campagna in formato JSON
// =====================================================================
import { sb, rpc, must } from "./supabase.js";
import { store } from "./store.js";
import { toast, loadPref } from "./ui.js";

const FORMAT = "dndva-campaign";

async function safe(promise) { try { return await must(promise); } catch { return []; } }

async function fileToDataUrl(path) {
  const { data, error } = await sb.storage.from("maps").download(path);
  if (error || !data) return null;
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(data); });
}
function dataUrlToBlob(d) {
  const [head, b64] = d.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const strip = (o, ...keys) => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

export async function exportCampaign({ includeImages = true, includeChat = false, onProgress = () => {} } = {}) {
  const gid = store.game.id;
  onProgress("Lettura dei dati…");
  const [maps, tokens, drawings, scenes, bestiary, handouts, notes, chronicle, members] = await Promise.all([
    safe(sb.from("maps").select("*").eq("game_id", gid)),
    safe(sb.from("tokens").select("*").eq("game_id", gid)),
    safe(sb.from("drawings").select("*").eq("game_id", gid)),
    safe(sb.from("scenes").select("*").eq("game_id", gid)),
    safe(sb.from("bestiary").select("*").eq("game_id", gid)),
    safe(sb.from("handouts").select("*").eq("game_id", gid)),
    safe(sb.from("dm_notes").select("*").eq("game_id", gid)),
    safe(sb.from("chronicle").select("*").eq("game_id", gid)),
    safe(sb.from("members").select("user_id,display_name,role,character_id,character_name").eq("game_id", gid)),
  ]);
  const charIds = members.map((m) => m.character_id).filter(Boolean);
  const characters = charIds.length ? await safe(sb.from("characters").select("*").in("id", charIds)) : [];
  const messages = includeChat ? await safe(sb.from("messages").select("sender_name,kind,body,created_at").eq("game_id", gid).is("recipients", null).order("id")) : [];

  if (includeImages) {
    let i = 0;
    for (const m of maps) if (m.image_path) { onProgress(`Immagini mappe ${++i}/${maps.filter((x) => x.image_path).length}…`); m._image = await fileToDataUrl(m.image_path); }
    i = 0;
    for (const x of handouts) { onProgress(`Immagini da mostrare ${++i}/${handouts.length}…`); x._image = await fileToDataUrl(x.image_path); }
  }
  const memberName = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));
  const out = {
    format: FORMAT, version: 1, exported_at: new Date().toISOString(),
    note: "Esportazione di D&D Virtual Adventure. Contiene dati della campagna: non pubblicarla se contiene segreti del DM.",
    game: { name: store.game.name, max_players: store.game.max_players, require_approval: store.game.require_approval, settings: strip(store.game.settings || {}, "music"), active_map_id: store.game.active_map_id },
    maps: maps.map((m) => strip(m, "game_id", "created_at", "updated_at")),
    tokens: tokens.map((t) => ({ ...strip(t, "game_id", "created_at", "updated_at"), _owner_name: t.owner_id ? memberName[t.owner_id] || null : null })),
    drawings: drawings.map((d) => strip(d, "game_id", "author_id", "created_at")),
    scenes: scenes.map((s) => strip(s, "game_id", "created_at", "updated_at")),
    bestiary: bestiary.map((b) => strip(b, "game_id", "created_at", "updated_at")),
    handouts: handouts.map((x) => strip(x, "game_id", "created_at")),
    dm_notes: notes.map((n) => strip(n, "game_id", "created_at", "updated_at")),
    chronicle: chronicle.map((c) => strip(c, "game_id", "author_id", "updated_at")),
    characters: characters.map((c) => ({ ...strip(c, "owner_id", "created_at", "updated_at"), _player: members.find((m) => m.character_id === c.id)?.display_name || null })),
    messages,
  };
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const name = `${store.game.name.replace(/[^\w\-àèéìòù ]+/gi, "").trim().replace(/\s+/g, "_") || "campagna"}_${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  onProgress(`Fatto: ${name} (${Math.round(blob.size / 1024)} KB)`);
  return name;
}

/** Crea una NUOVA partita (di cui sei DM) a partire da un file esportato */
export async function importCampaign(file, { includeCharacters = true, onProgress = () => {} } = {}) {
  const text = await file.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("Il file non è un JSON valido"); }
  if (j.format !== FORMAT) throw new Error("Il file non è un'esportazione di D&D Virtual Adventure");

  onProgress("Creazione della partita…");
  const res = await rpc("create_game", {
    p_name: `${j.game?.name || "Campagna"} (importata)`.slice(0, 80),
    p_display_name: loadPref("name", "") || store.me?.display_name || "DM",
    p_character_id: null, p_max_players: j.game?.max_players || 8, p_require_approval: !!j.game?.require_approval,
  });
  const gid = res.game_id;
  if (j.game?.settings) await sb.from("games").update({ settings: j.game.settings }).eq("id", gid);

  const ids = new Map(); // vecchio id -> nuovo id
  const newId = (old) => { if (!old) return null; if (!ids.has(old)) ids.set(old, crypto.randomUUID()); return ids.get(old); };

  const upload = async (dataUrl, folder) => {
    if (!dataUrl) return null;
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
    const path = `${gid}/${folder}${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("maps").upload(path, blob, { contentType: blob.type });
    return error ? null : path;
  };

  let n = 0;
  for (const m of j.maps || []) {
    onProgress(`Mappe ${++n}/${j.maps.length}…`);
    const image_path = m._image ? await upload(m._image, "") : null;
    const row = strip(m, "_image", "id"); row.id = newId(m.id); row.game_id = gid; row.image_path = image_path;
    await must(sb.from("maps").insert(row));
  }
  const toks = (j.tokens || []).map((t) => ({ ...strip(t, "_owner_name", "id", "owner_id", "move_used", "move_window"), id: newId(t.id), map_id: ids.get(t.map_id), game_id: gid, owner_id: null })).filter((t) => t.map_id);
  for (let i = 0; i < toks.length; i += 200) await must(sb.from("tokens").insert(toks.slice(i, i + 200)));
  const draws = (j.drawings || []).map((d) => ({ ...strip(d, "id"), map_id: ids.get(d.map_id), game_id: gid })).filter((d) => d.map_id);
  for (let i = 0; i < draws.length; i += 200) await must(sb.from("drawings").insert(draws.slice(i, i + 200)));

  onProgress("Archivio, immagini, scene e note…");
  const opt = async (table, rows) => { if (rows.length) { try { await must(sb.from(table).insert(rows)); } catch (e) { toast(`${table}: ${e.message}`, "error"); } } };
  await opt("bestiary", (j.bestiary || []).map((b) => ({ ...strip(b, "id"), game_id: gid })));
  const hs = [];
  for (const x of j.handouts || []) { const p = await upload(x._image, "handouts/"); if (p) hs.push({ id: newId(x.id), game_id: gid, title: x.title, image_path: p, shown_at: null }); }
  await opt("handouts", hs);
  await opt("scenes", (j.scenes || []).map((s) => ({ ...strip(s, "id"), game_id: gid, map_id: ids.get(s.map_id) || null, handout_id: ids.get(s.handout_id) || null })));
  await opt("dm_notes", (j.dm_notes || []).map((x) => ({ ...strip(x, "id"), game_id: gid })));
  await opt("chronicle", (j.chronicle || []).map((c) => ({ ...strip(c, "id", "author_name", "created_at"), game_id: gid,
    body: c.author_name ? `${c.body}\n\n— ${c.author_name}` : c.body })));
  if (includeCharacters && (j.characters || []).length) {
    await opt("characters", j.characters.map((c) => ({ ...strip(c, "id", "_player"), owner_id: store.user.id, name: c.name })));
  }
  if (j.game?.active_map_id && ids.get(j.game.active_map_id)) await rpc("set_active_map", { p_game: gid, p_map: ids.get(j.game.active_map_id) }).catch(() => {});
  onProgress("Importazione completata.");
  return gid;
}
