// =====================================================================
//  Strumenti del Dungeon Master (finestra a schede)
// =====================================================================
import { sb, rpc, must } from "./supabase.js";
import { store } from "./store.js";
import { h, icon, toast, modal, confirmDialog, resizeImage, loadPref, savePref } from "./ui.js";
import { roomBody } from "./dm-panel.js";
import { audioPanel, dmSetMusic, AMBIENCES } from "./audio.js";
import { tableState } from "./map/table.js";
import { snap, gridOf } from "./map/grid.js";
import { activeEncounter, addToCombat } from "./combat.js";
import { exportCampaign, importCampaign } from "./campaign-io.js";
import { navigate } from "./main.js";

const TABS = [
  ["room", "door", "Stanza"], ["scenes", "map", "Scene"], ["bestiary", "sword", "Mostri e PNG"],
  ["handouts", "eye", "Immagini"], ["audio", "volume", "Musica e suoni"], ["notes", "lock", "Note private"], ["campaign", "scroll", "Campagna"],
];

export function openDmTools(tab) {
  let current = tab || loadPref("dmTab", "room");
  const body = h("div", { class: "dmt-body" });
  const bar = h("div", { class: "dmt-tabs" });
  const show = (id) => {
    current = id; savePref("dmTab", id);
    bar.replaceChildren(...TABS.map(([k, ic, l]) => h("button", { class: `dmt-tab ${k === id ? "active" : ""}`, html: `${icon(ic)} <span>${l}</span>`, onclick: () => show(k) })));
    body.replaceChildren(h("p", { class: "muted" }, "Caricamento…"));
    const fn = { room: () => roomBody(), scenes: scenesTab, bestiary: bestiaryTab, handouts: handoutsTab, audio: () => audioPanel(), notes: notesTab, campaign: campaignTab }[id];
    Promise.resolve(fn()).then((el) => body.replaceChildren(el)).catch((e) => body.replaceChildren(h("p", { class: "error" }, needPhase4(e))));
  };
  modal({ title: "Strumenti del Dungeon Master", wide: true, cls: "dmt", body: h("div", {}, bar, body), actions: [{ label: "Chiudi", primary: true }] });
  show(current);
}

function needPhase4(e) {
  const m = e?.message || String(e);
  return /relation|does not exist|schema cache/i.test(m) ? "Questa funzione richiede l'aggiornamento del database: esegui supabase/schema-fase4.sql nel SQL Editor di Supabase." : m;
}

// ================================================================== SCENE
async function scenesTab() {
  const gid = store.game.id;
  const [scenes, maps, handouts, tracks] = await Promise.all([
    must(sb.from("scenes").select("*").eq("game_id", gid).order("sort").order("created_at")),
    must(sb.from("maps").select("id,name").eq("game_id", gid).order("sort")),
    must(sb.from("handouts").select("id,title").eq("game_id", gid).order("created_at")),
    must(sb.from("audio_tracks").select("id,title,file_path,kind").eq("game_id", gid).eq("kind", "music")),
  ]);
  const box = h("div", {});
  const musicOptions = [["", "— nessuna / lascia com'è —"], ["stop", "⏹ Ferma la musica"], ...AMBIENCES.map(([k, l]) => ["synth:" + k, l]), ...tracks.map((t) => ["file:" + t.file_path, "🎵 " + t.title])];
  const musicLabel = (m) => !m ? "" : m.stop ? "ferma musica" : (m.title || "");
  const render = () => box.replaceChildren(
    h("p", { class: "muted small" }, "Prepara le scene in anticipo. «Avvia» mostra la mappa ai giocatori, scrive in chat il testo da leggere, mostra l'immagine e cambia la musica, tutto in un clic."),
    scenes.length ? h("div", { class: "map-list" }, scenes.map((s) => h("div", { class: "map-row" },
      h("div", { class: "map-row-main" }, h("strong", {}, s.name),
        h("div", { class: "muted small" }, [maps.find((m) => m.id === s.map_id)?.name && "🗺 " + maps.find((m) => m.id === s.map_id).name,
          handouts.find((x) => x.id === s.handout_id)?.title && "🖼 " + handouts.find((x) => x.id === s.handout_id).title,
          musicLabel(s.music) && "🎵 " + musicLabel(s.music), s.read_aloud && "📜 testo"].filter(Boolean).join(" · "))),
      h("div", { class: "row-btns" },
        h("button", { class: "btn btn-sm btn-primary", onclick: () => startScene(s) }, "▶ Avvia"),
        h("button", { class: "btn btn-sm", onclick: () => edit(s) }, "Modifica"))))) : h("p", {}, "Nessuna scena preparata."),
    h("button", { class: "btn btn-sm btn-primary", html: `${icon("plus")} Nuova scena`, onclick: () => edit(null) }));

  const edit = (s) => {
    const f = {
      name: h("input", { maxlength: 120, value: s?.name || "", placeholder: "es. L'ingresso della cripta" }),
      map: h("select", {}, h("option", { value: "" }, "— nessuna —"), maps.map((m) => h("option", { value: m.id, selected: s?.map_id === m.id }, m.name))),
      handout: h("select", {}, h("option", { value: "" }, "— nessuna —"), handouts.map((x) => h("option", { value: x.id, selected: s?.handout_id === x.id }, x.title || "Immagine"))),
      music: h("select", {}, musicOptions.map(([v, l]) => h("option", { value: v, selected: s?.music && (s.music.stop ? v === "stop" : v === `${s.music.type}:${s.music.id || s.music.path}`) }, l))),
      read: h("textarea", { rows: 6, maxlength: 8000, placeholder: "Testo da leggere ai giocatori (va in chat quando avvii la scena)" }, s?.read_aloud || ""),
      notes: h("textarea", { rows: 4, maxlength: 8000, placeholder: "Note per te: PNG, segreti, cosa succede se…" }, s?.dm_notes || ""),
    };
    const sheetBody = h("div", { class: "form-cols" },
      h("div", {}, h("label", {}, "Nome della scena", f.name), h("label", {}, "Mappa da mostrare", f.map), h("label", {}, "Immagine da mostrare", f.handout), h("label", {}, "Musica", f.music)),
      h("div", {}, h("label", {}, "Testo da leggere", f.read), h("label", {}, "Note del DM (segrete)", f.notes)));
    const actions = [{ label: "Annulla" }, {
      label: "Salva", primary: true,
      onClick: async () => {
        if (!f.name.value.trim()) { toast("Dai un nome alla scena", "error"); return false; }
        const mv = f.music.value;
        const music = !mv ? null : mv === "stop" ? { stop: true } : mv.startsWith("synth:") ? { type: "synth", id: mv.slice(6), title: AMBIENCES.find(([k]) => k === mv.slice(6))?.[1] } : { type: "file", path: mv.slice(5), title: tracks.find((t) => t.file_path === mv.slice(5))?.title };
        const row = { name: f.name.value.trim(), map_id: f.map.value || null, handout_id: f.handout.value || null, music, read_aloud: f.read.value, dm_notes: f.notes.value };
        const saved = s ? await must(sb.from("scenes").update(row).eq("id", s.id).select().single())
          : await must(sb.from("scenes").insert({ ...row, game_id: gid, sort: scenes.length }).select().single());
        const i = scenes.findIndex((x) => x.id === saved.id); if (i >= 0) scenes[i] = saved; else scenes.push(saved);
        render();
      },
    }];
    if (s) actions.unshift({ label: "Elimina", danger: true, onClick: async () => { if (!(await confirmDialog(`Eliminare la scena «${s.name}»?`))) return false; await must(sb.from("scenes").delete().eq("id", s.id)); scenes.splice(scenes.indexOf(s), 1); render(); } });
    modal({ title: s ? "Modifica scena" : "Nuova scena", wide: true, body: sheetBody, actions });
  };
  render();
  return box;
}

async function startScene(s) {
  try {
    if (s.map_id) await rpc("set_active_map", { p_game: store.game.id, p_map: s.map_id });
    if (s.music?.stop) await dmSetMusic(null);
    else if (s.music) await dmSetMusic(s.music);
    if (s.read_aloud?.trim()) await must(sb.from("messages").insert({ game_id: store.game.id, kind: "general", body: `📜 ${s.name}\n\n${s.read_aloud.trim()}`.slice(0, 2000), sender_id: store.user.id }));
    if (s.handout_id) await must(sb.from("handouts").update({ shown_at: new Date().toISOString() }).eq("id", s.handout_id));
    toast(`Scena «${s.name}» avviata.`, "ok");
    if (s.dm_notes?.trim()) modal({ title: `Note: ${s.name}`, body: h("div", { class: "pre" }, s.dm_notes), actions: [{ label: "OK", primary: true }] });
  } catch (e) { toast(e.message, "error"); }
}

// ================================================================== MOSTRI E PNG
async function bestiaryTab() {
  const gid = store.game.id;
  const rows = await must(sb.from("bestiary").select("*").eq("game_id", gid).order("name"));
  const box = h("div", {});
  const render = () => box.replaceChildren(
    h("p", { class: "muted small" }, "Il tuo archivio di mostri e PNG con statistiche segrete. Da qui li metti sulla mappa e nel combattimento con un clic."),
    rows.length ? h("div", { class: "map-list" }, rows.map((b) => h("div", { class: "map-row" },
      h("div", { class: "map-row-main" }, h("strong", {}, b.name), h("span", { class: "muted small" }, ` · ${b.kind === "npc" ? "PNG" : "Mostro"} · PF ${b.hp} · CA ${b.ac} · Iniz. ${b.init_bonus >= 0 ? "+" : ""}${b.init_bonus}`),
        b.attacks ? h("div", { class: "muted small pre" }, b.attacks) : null),
      h("div", { class: "row-btns" },
        h("button", { class: "btn btn-sm btn-primary", title: "Metti sulla mappa aperta (nascosto)", onclick: () => place(b, false) }, "Sulla mappa"),
        h("button", { class: "btn btn-sm", title: "Sulla mappa e nel combattimento in corso", onclick: () => place(b, true) }, "+ combattimento"),
        h("button", { class: "btn btn-sm", onclick: () => edit(b) }, "Modifica"))))) : h("p", {}, "Archivio vuoto."),
    h("button", { class: "btn btn-sm btn-primary", html: `${icon("plus")} Nuovo mostro o PNG`, onclick: () => edit(null) }));

  const edit = (b) => {
    let image = b?.image || null;
    const f = {
      name: h("input", { maxlength: 80, value: b?.name || "", placeholder: "es. Goblin, Capitano della guardia" }),
      kind: h("select", {}, h("option", { value: "monster", selected: b?.kind !== "npc" }, "Mostro"), h("option", { value: "npc", selected: b?.kind === "npc" }, "PNG")),
      hp: h("input", { type: "number", min: 0, max: 9999, value: b?.hp ?? 7 }), ac: h("input", { type: "number", min: 0, max: 50, value: b?.ac ?? 13 }),
      init: h("input", { type: "number", min: -20, max: 30, value: b?.init_bonus ?? 2 }), speed: h("input", { maxlength: 40, value: b?.speed || "9 m" }),
      size: h("select", {}, [[0.5, "Minuscola"], [1, "Piccola/Media"], [2, "Grande"], [3, "Enorme"], [4, "Mastodontica"]].map(([v, l]) => h("option", { value: v, selected: Number(b?.size || 1) === v }, l))),
      color: h("input", { type: "color", value: b?.color || "#b3261e" }),
      attacks: h("textarea", { rows: 4, maxlength: 4000, placeholder: "es. Scimitarra: +4 per colpire, 1d6+2 taglienti" }, b?.attacks || ""),
      notes: h("textarea", { rows: 4, maxlength: 8000, placeholder: "Tratti, resistenze, tattica, tesoro…" }, b?.notes || ""),
      file: h("input", { type: "file", accept: "image/*" }),
    };
    f.file.onchange = async () => { if (f.file.files[0]) image = await resizeImage(f.file.files[0], 128); };
    const actions = [{ label: "Annulla" }, {
      label: "Salva", primary: true,
      onClick: async () => {
        if (!f.name.value.trim()) { toast("Scrivi un nome", "error"); return false; }
        const row = { name: f.name.value.trim(), kind: f.kind.value, hp: Number(f.hp.value) || 0, ac: Number(f.ac.value) || 0, init_bonus: Number(f.init.value) || 0,
          speed: f.speed.value, size: Number(f.size.value), color: f.color.value, attacks: f.attacks.value, notes: f.notes.value, image };
        const saved = b ? await must(sb.from("bestiary").update(row).eq("id", b.id).select().single()) : await must(sb.from("bestiary").insert({ ...row, game_id: gid }).select().single());
        const i = rows.findIndex((x) => x.id === saved.id); if (i >= 0) rows[i] = saved; else rows.push(saved);
        render();
      },
    }];
    if (b) actions.unshift({ label: "Elimina", danger: true, onClick: async () => { if (!(await confirmDialog(`Eliminare ${b.name} dall'archivio?`))) return false; await must(sb.from("bestiary").delete().eq("id", b.id)); rows.splice(rows.indexOf(b), 1); render(); } });
    modal({
      title: b ? "Modifica" : "Nuovo mostro o PNG", wide: true,
      body: h("div", { class: "form-cols" },
        h("div", {}, h("div", { class: "row2" }, h("label", {}, "Nome", f.name), h("label", {}, "Tipo", f.kind)),
          h("div", { class: "row2" }, h("label", {}, "Punti ferita", f.hp), h("label", {}, "Classe Armatura", f.ac)),
          h("div", { class: "row2" }, h("label", {}, "Bonus iniziativa", f.init), h("label", {}, "Velocità", f.speed)),
          h("div", { class: "row2" }, h("label", {}, "Taglia", f.size), h("label", {}, "Colore", f.color)),
          h("label", {}, "Immagine (facoltativa)", f.file)),
        h("div", {}, h("label", {}, "Attacchi", f.attacks), h("label", {}, "Note", f.notes))),
      actions,
    });
  };

  const place = async (b, combat) => {
    const T = tableState();
    const map = T.maps.get(T.viewMapId);
    if (!map) { toast("Apri prima una mappa sul tavolo.", "error"); return; }
    const sameName = [...T.view.tokens.values()].filter((t) => t.name.startsWith(b.name)).length;
    const name = sameName ? `${b.name} ${sameName + 1}` : b.name;
    const c = T.view.viewCenter();
    const p = snap(gridOf(map), c.x + (Math.random() - 0.5) * map.grid_size * 2, c.y + (Math.random() - 0.5) * map.grid_size * 2, b.size);
    try {
      const tok = await must(sb.from("tokens").insert({ game_id: gid, map_id: map.id, kind: b.kind, name, x: p.x, y: p.y, size: b.size, color: b.color, image: b.image, hidden: b.kind === "monster" }).select().single());
      T.view.upsertToken(tok);
      if (combat) {
        if (!activeEncounter()) { toast("Nessun combattimento in corso: il token è sulla mappa (nascosto).", "info"); return; }
        await addToCombat({ name, kind: b.kind, token_id: tok.id, init_bonus: b.init_bonus, hidden: tok.hidden, hp: b.hp, ac: b.ac });
      }
      toast(`${name} sulla mappa${tok.hidden ? " (nascosto: selezionalo e premi «Mostra» quando vuoi)" : ""}${combat ? " e nel combattimento" : ""}.`, "ok", { timeout: 5000 });
    } catch (e) { toast(e.message, "error"); }
  };
  render();
  return box;
}

// ================================================================== IMMAGINI DA MOSTRARE
async function handoutsTab() {
  const gid = store.game.id;
  const rows = await must(sb.from("handouts").select("*").eq("game_id", gid).order("created_at", { ascending: false }));
  const box = h("div", {});
  const thumbs = new Map();
  const thumb = (x) => {
    const img = h("img", { alt: "", class: "ho-thumb" });
    if (thumbs.has(x.image_path)) img.src = thumbs.get(x.image_path);
    else sb.storage.from("maps").createSignedUrl(x.image_path, 3600).then(({ data }) => { if (data) { thumbs.set(x.image_path, data.signedUrl); img.src = data.signedUrl; } });
    return img;
  };
  const title = h("input", { maxlength: 160, placeholder: "Titolo (es. Lettera del barone)" });
  const file = h("input", { type: "file", accept: "image/*" });
  const render = () => box.replaceChildren(
    h("p", { class: "muted small" }, "Carica in anticipo immagini, lettere, ritratti di PNG o indizi. I giocatori non le vedono finché non premi «Mostra a tutti»."),
    h("div", { class: "row-btns" }, title, file, h("button", { class: "btn btn-sm btn-primary", onclick: upload }, "Carica")),
    rows.length ? h("div", { class: "map-list" }, rows.map((x) => h("div", { class: "map-row" }, thumb(x),
      h("div", { class: "map-row-main" }, h("strong", {}, x.title || "Immagine"), x.shown_at ? h("span", { class: "pill pill-live" }, "già mostrata") : h("span", { class: "muted small" }, " · non ancora mostrata")),
      h("div", { class: "row-btns" },
        h("button", { class: "btn btn-sm btn-primary", onclick: async () => { const r = await must(sb.from("handouts").update({ shown_at: new Date().toISOString() }).eq("id", x.id).select().single()); Object.assign(x, r); render(); toast("Immagine mostrata a tutti.", "ok"); } }, x.shown_at ? "Mostra di nuovo" : "Mostra a tutti"),
        x.shown_at ? h("button", { class: "btn btn-sm", title: "Torna privata", onclick: async () => { await must(sb.from("handouts").update({ shown_at: null }).eq("id", x.id)); x.shown_at = null; render(); } }, "Ritira") : null,
        h("button", { class: "btn btn-sm btn-danger", onclick: async () => { if (!(await confirmDialog("Eliminare l'immagine?"))) return; await must(sb.from("handouts").delete().eq("id", x.id)); sb.storage.from("maps").remove([x.image_path]).catch(() => {}); rows.splice(rows.indexOf(x), 1); render(); } }, "Elimina"))))) : h("p", {}, "Nessuna immagine."));
  async function upload() {
    const f = file.files[0]; if (!f) { toast("Scegli un'immagine", "error"); return; }
    const blob = await shrink(f, 2048);
    const path = `${gid}/handouts/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("maps").upload(path, blob, { contentType: "image/jpeg" });
    if (error) { toast("Caricamento non riuscito: " + error.message, "error"); return; }
    const r = await must(sb.from("handouts").insert({ game_id: gid, title: title.value.trim() || f.name.replace(/\.[^.]+$/, ""), image_path: path }).select().single());
    rows.unshift(r); title.value = ""; file.value = ""; render();
  }
  render();
  return box;
}

function shrink(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => b ? res(b) : rej(new Error("Conversione non riuscita")), "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Immagine non valida")); };
    img.src = url;
  });
}

// ================================================================== NOTE PRIVATE
async function notesTab() {
  const gid = store.game.id;
  const rows = await must(sb.from("dm_notes").select("*").eq("game_id", gid).order("pinned", { ascending: false }).order("updated_at", { ascending: false }));
  let sel = rows[0] || null, timer;
  const box = h("div", { class: "notes-wrap" });
  const status = h("span", { class: "muted small" });
  const save = () => {
    clearTimeout(timer); status.textContent = "…";
    timer = setTimeout(async () => {
      try { const r = await must(sb.from("dm_notes").update({ title: sel.title, body: sel.body, pinned: sel.pinned }).eq("id", sel.id).select().single()); Object.assign(sel, r); status.textContent = "Salvato ✓"; renderList(); }
      catch (e) { status.textContent = "Errore: " + e.message; }
    }, 600);
  };
  const list = h("div", { class: "notes-list" });
  const editor = h("div", { class: "notes-editor" });
  const renderList = () => list.replaceChildren(
    h("button", { class: "btn btn-sm btn-primary", html: `${icon("plus")} Nuova nota`, onclick: async () => { const r = await must(sb.from("dm_notes").insert({ game_id: gid, title: "Nuova nota" }).select().single()); rows.unshift(r); sel = r; renderList(); renderEditor(); } }),
    ...rows.map((n) => h("button", { class: `note-item ${n === sel ? "active" : ""}`, onclick: () => { sel = n; renderList(); renderEditor(); } }, (n.pinned ? "📌 " : "") + (n.title || "Senza titolo"))));
  const renderEditor = () => {
    if (!sel) { editor.replaceChildren(h("p", { class: "muted" }, "Crea una nota: trame, segreti, nomi dei PNG, cosa preparare per la prossima sessione. Le vedi solo tu.")); return; }
    editor.replaceChildren(
      h("div", { class: "row-btns" },
        h("input", { class: "grow", value: sel.title, maxlength: 120, oninput: (e) => { sel.title = e.target.value; save(); } }),
        h("label", { class: "check small" }, h("input", { type: "checkbox", checked: sel.pinned, onchange: (e) => { sel.pinned = e.target.checked; save(); } }), " in evidenza"),
        h("button", { class: "btn btn-sm btn-danger", onclick: async () => { if (!(await confirmDialog("Eliminare la nota?"))) return; await must(sb.from("dm_notes").delete().eq("id", sel.id)); rows.splice(rows.indexOf(sel), 1); sel = rows[0] || null; renderList(); renderEditor(); } }, "Elimina")),
      (() => { const t = h("textarea", { rows: 16, maxlength: 50000, oninput: (e) => { sel.body = e.target.value; save(); } }); t.value = sel.body; return t; })(),
      status);
  };
  renderList(); renderEditor();
  box.append(list, editor);
  return box;
}

// ================================================================== CAMPAGNA
async function campaignTab() {
  const g = store.game;
  const days = Number(g.settings?.retention_days || 0);
  const imgs = h("input", { type: "checkbox", checked: true });
  const chat = h("input", { type: "checkbox" });
  const prog = h("p", { class: "muted small" });
  const ret = h("select", {}, [[0, "Per sempre"], [7, "7 giorni"], [30, "30 giorni"], [90, "90 giorni"], [365, "1 anno"]].map(([v, l]) => h("option", { value: v, selected: days === v }, l)));
  const impFile = h("input", { type: "file", accept: "application/json,.json" });
  const impChars = h("input", { type: "checkbox", checked: true });
  return h("div", { class: "dm-panel" },
    h("section", {},
      h("h3", { html: `${icon("download")} Esporta la campagna (JSON)` }),
      h("p", { class: "small" }, "Salva sul tuo dispositivo una copia completa: mappe, elementi, disegni, scene, archivio mostri, immagini, note private, cronaca e schede dei personaggi. Utile come backup o per spostare la campagna."),
      h("label", { class: "check" }, imgs, " Includi le immagini (file più grande)"),
      h("label", { class: "check" }, chat, " Includi i messaggi pubblici della chat"),
      h("button", { class: "btn btn-primary", onclick: async () => { try { await exportCampaign({ includeImages: imgs.checked, includeChat: chat.checked, onProgress: (t) => { prog.textContent = t; } }); } catch (e) { toast(e.message, "error"); } } }, "Esporta"),
      prog),
    h("section", {},
      h("h3", { html: `${icon("plus")} Importa una campagna` }),
      h("p", { class: "small" }, "Crea una NUOVA partita (di cui sei il DM) da un file esportato. Questa partita non viene modificata. I giocatori dovranno entrare con il nuovo codice e collegare i loro personaggi."),
      impFile, h("label", { class: "check" }, impChars, " Importa anche le schede dei personaggi (come tue copie)"),
      h("button", { class: "btn", onclick: async () => {
        const f = impFile.files[0]; if (!f) { toast("Scegli il file .json", "error"); return; }
        try { const id = await importCampaign(f, { includeCharacters: impChars.checked, onProgress: (t) => { prog.textContent = t; } }); toast("Campagna importata.", "ok"); document.querySelector(".modal-wrap")?.remove(); navigate(`#/game/${id}`); }
        catch (e) { toast(e.message, "error"); }
      } }, "Importa come nuova partita")),
    h("section", {},
      h("h3", { html: `${icon("chat")} Conservazione dei messaggi` }),
      h("p", { class: "small" }, "Per quanto tempo tenere chat e tiri di dado. La pulizia avviene quando entri al tavolo come DM, oppure subito con il pulsante."),
      h("div", { class: "row-btns" }, ret,
        h("button", { class: "btn btn-sm", onclick: async () => {
          const settings = { ...(store.game.settings || {}), retention_days: Number(ret.value) };
          await must(sb.from("games").update({ settings }).eq("id", g.id)); store.game.settings = settings;
          const n = await rpc("purge_messages", { p_game: g.id, p_all: false }); toast(`Impostazione salvata${n ? `, cancellati ${n} messaggi vecchi` : ""}.`, "ok");
        } }, "Salva e applica"),
        h("button", { class: "btn btn-sm btn-danger", onclick: async () => {
          if (!(await confirmDialog("Cancellare TUTTI i messaggi della chat di questa partita?", { danger: true, okLabel: "Cancella tutto" }))) return;
          const n = await rpc("purge_messages", { p_game: g.id, p_all: true }); toast(`Cancellati ${n} messaggi.`, "ok");
        } }, "Cancella tutta la chat"))));
}
