// =====================================================================
//  Diario della campagna: cronaca delle sessioni + immagini mostrate dal DM
// =====================================================================
import { sb, must } from "./supabase.js";
import { store, isDM } from "./store.js";
import { h, icon, toast, modal, confirmDialog, beep } from "./ui.js";

let root, listEl, galleryEl;
const entries = new Map();
const handouts = new Map();
const urls = new Map();

export function mountChronicle(container) {
  listEl = h("div", { class: "chron-list" });
  galleryEl = h("div", { class: "gallery" });
  root = h("div", { class: "chronicle" },
    h("div", { class: "row-btns" },
      h("button", { class: "btn btn-sm btn-primary", html: `${icon("plus")} Nuova voce`, onclick: () => editEntry() }),
      h("span", { class: "muted small" }, "Racconto delle sessioni, scritto insieme.")),
    h("h4", { class: "dice-title" }, "Immagini mostrate dal DM"), galleryEl,
    h("h4", { class: "dice-title" }, "Cronaca"), listEl);
  container.append(root);
  return root;
}
export function unmountChronicle() { root?.remove(); root = null; entries.clear(); handouts.clear(); }

export async function reloadChronicle() {
  if (!root) return;
  try {
    const [rows, hs] = await Promise.all([
      must(sb.from("chronicle").select("*").eq("game_id", store.game.id).order("happened_on", { ascending: false }).order("created_at", { ascending: false })),
      must(sb.from("handouts").select("*").eq("game_id", store.game.id).not("shown_at", "is", null).order("shown_at", { ascending: false })),
    ]);
    entries.clear(); rows.forEach((r) => entries.set(r.id, r));
    handouts.clear(); hs.forEach((x) => handouts.set(x.id, x));
    render();
  } catch (e) {
    listEl.replaceChildren(h("p", { class: "muted small" }, "Diario non disponibile: esegui schema-fase4.sql in Supabase. (" + e.message + ")"));
  }
}

export const chronicleRealtime = {
  entry(p) {
    if (p.eventType === "DELETE") { if (p.old?.id && entries.delete(p.old.id)) render(); return; }
    if (p.new?.id) { entries.set(p.new.id, p.new); render(); }
  },
  handout(p) {
    const x = p.new; if (!x?.id || !x.shown_at) { if (p.old?.id && handouts.delete(p.old.id)) render(); return; }
    const prev = handouts.get(x.id);
    handouts.set(x.id, x); render();
    if (!prev || prev.shown_at !== x.shown_at) showHandout(x);
  },
};

async function signed(path) {
  const c = urls.get(path); if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from("maps").createSignedUrl(path, 60 * 60 * 6);
  if (error) return null;
  urls.set(path, { url: data.signedUrl, exp: Date.now() + 5 * 3600 * 1000 });
  return data.signedUrl;
}

export async function showHandout(x) {
  const url = await signed(x.image_path);
  if (!url) { toast("Immagine non disponibile", "error"); return; }
  document.querySelector(".handout-overlay")?.remove();
  beep("private");
  const ov = h("div", { class: "handout-overlay", onclick: (e) => { if (e.target === ov) ov.remove(); } },
    h("figure", { class: "handout-frame" },
      h("img", { src: url, alt: x.title || "Immagine" }),
      h("figcaption", {}, x.title || ""),
      h("button", { class: "btn btn-primary", onclick: () => ov.remove() }, "Chiudi")));
  document.body.append(ov);
}

function render() {
  if (!root) return;
  const hs = [...handouts.values()];
  galleryEl.replaceChildren(...(hs.length ? hs.map((x) => {
    const img = h("img", { alt: x.title || "", loading: "lazy" });
    signed(x.image_path).then((u) => { if (u) img.src = u; });
    return h("button", { class: "gal-item", title: x.title || "", onclick: () => showHandout(x) }, img, h("span", {}, x.title || ""));
  }) : [h("p", { class: "muted small" }, "Ancora nessuna.")]));
  const list = [...entries.values()].sort((a, b) => String(b.happened_on).localeCompare(String(a.happened_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  listEl.replaceChildren(...(list.length ? list.map((e) => {
    const canEdit = isDM() || e.author_id === store.user.id;
    return h("article", { class: "chron" },
      h("div", { class: "chron-head" },
        e.session_no != null ? h("span", { class: "round-chip" }, `Sessione ${e.session_no}`) : null,
        h("strong", {}, e.title || "Senza titolo"),
        h("span", { class: "muted small" }, `${e.happened_on ? new Date(e.happened_on).toLocaleDateString("it-IT") : ""} · ${e.author_name}`),
        canEdit ? h("button", { class: "mini", title: "Modifica", onclick: () => editEntry(e) }, "✎") : null),
      h("div", { class: "chron-body" }, e.body));
  }) : [h("p", { class: "muted small" }, "La cronaca è vuota. Scrivete cosa è successo nelle sessioni!")]));
}

function editEntry(e = null) {
  const last = Math.max(0, ...[...entries.values()].map((x) => x.session_no || 0));
  const f = {
    session: h("input", { type: "number", min: 0, max: 9999, value: e?.session_no ?? (last || 1) }),
    date: h("input", { type: "date", value: e?.happened_on || new Date().toISOString().slice(0, 10) }),
    title: h("input", { maxlength: 160, value: e?.title || "", placeholder: "es. L'imboscata dei goblin" }),
    body: h("textarea", { rows: 10, maxlength: 20000, placeholder: "Cosa è successo, chi avete incontrato, cosa avete trovato…" }, e?.body || ""),
  };
  const actions = [{ label: "Annulla" }, {
    label: "Salva", primary: true,
    onClick: async () => {
      const row = { session_no: f.session.value === "" ? null : Number(f.session.value), happened_on: f.date.value || null, title: f.title.value.trim(), body: f.body.value };
      const saved = e
        ? await must(sb.from("chronicle").update(row).eq("id", e.id).select().single())
        : await must(sb.from("chronicle").insert({ ...row, game_id: store.game.id }).select().single());
      entries.set(saved.id, saved); render();
    },
  }];
  if (e) actions.unshift({ label: "Elimina", danger: true, onClick: async () => {
    if (!(await confirmDialog("Eliminare questa voce della cronaca?", { danger: true, okLabel: "Elimina" }))) return false;
    await must(sb.from("chronicle").delete().eq("id", e.id)); entries.delete(e.id); render();
  } });
  modal({
    title: e ? "Modifica voce" : "Nuova voce della cronaca", wide: true,
    body: h("div", {}, h("div", { class: "row2" }, h("label", {}, "Sessione n°", f.session), h("label", {}, "Data", f.date)), h("label", {}, "Titolo", f.title), h("label", {}, "Racconto", f.body)),
    actions,
  });
}
