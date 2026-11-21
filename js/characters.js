// Personaggi: creazione e selezione (la scheda completa arriverà nella Fase 3)
import { sb, must } from "./supabase.js";
import { store } from "./store.js";
import { h, modal, toast, resizeImage, avatar, confirmDialog } from "./ui.js";

export async function listMyCharacters() {
  return must(sb.from("characters")
    .select("id,name,species,class,level,background,portrait,updated_at")
    .eq("owner_id", store.user.id)
    .order("updated_at", { ascending: false }));
}

export function characterSummary(c) {
  if (!c) return "";
  const parts = [c.species, c.class && `${c.class} ${c.level || 1}`].filter(Boolean);
  return parts.join(" · ");
}

/** Apre il modulo di creazione/modifica. Restituisce il personaggio salvato (o null). */
export function editCharacter(existing = null) {
  return new Promise((resolve) => {
    let portrait = existing?.portrait || null;
    let saved = null;
    const f = {
      name: h("input", { maxlength: 60, value: existing?.name || "", placeholder: "es. Elara Lunargento", required: true }),
      species: h("input", { maxlength: 60, value: existing?.species || "", placeholder: "es. Elfo, Nano, Umano…", list: "dl-species" }),
      cls: h("input", { maxlength: 60, value: existing?.class || "", placeholder: "es. Guerriero, Mago…", list: "dl-classes" }),
      level: h("input", { type: "number", min: 1, max: 20, value: existing?.level || 1 }),
      background: h("input", { maxlength: 60, value: existing?.background || "", placeholder: "es. Soldato, Accolito…" }),
    };
    const preview = h("div", { class: "portrait-preview" }, avatar(existing?.name || "?", portrait, "avatar-xl"));
    const file = h("input", {
      type: "file", accept: "image/*", class: "visually-hidden", id: "portrait-file",
      onchange: async () => {
        if (!file.files[0]) return;
        try {
          portrait = await resizeImage(file.files[0]);
          preview.replaceChildren(avatar(f.name.value, portrait, "avatar-xl"));
        } catch (e) { toast(e.message, "error"); }
      },
    });
    // Suggerimenti: nomi generici di specie e classi del SRD 5.1 (CC BY 4.0)
    const dlS = h("datalist", { id: "dl-species" }, ["Dragonide", "Elfo", "Gnomo", "Halfling", "Mezzelfo", "Mezzorco", "Nano", "Tiefling", "Umano"].map((x) => h("option", { value: x })));
    const dlC = h("datalist", { id: "dl-classes" }, ["Barbaro", "Bardo", "Chierico", "Druido", "Guerriero", "Ladro", "Mago", "Monaco", "Paladino", "Ranger", "Stregone", "Warlock"].map((x) => h("option", { value: x })));

    const actions = [
      { label: "Annulla" },
      {
        label: existing ? "Salva modifiche" : "Crea personaggio", primary: true,
        onClick: async () => {
          const row = {
            name: f.name.value.trim(), species: f.species.value.trim(), class: f.cls.value.trim(),
            level: Math.max(1, Math.min(20, parseInt(f.level.value, 10) || 1)),
            background: f.background.value.trim(), portrait,
          };
          if (!row.name) { toast("Dai un nome al personaggio", "error"); return false; }
          if (existing) {
            saved = await must(sb.from("characters").update(row).eq("id", existing.id).select().single());
          } else {
            saved = await must(sb.from("characters").insert({ ...row, owner_id: store.user.id }).select().single());
          }
          toast(existing ? "Personaggio aggiornato" : "Personaggio creato", "ok");
        },
      },
    ];
    if (existing) {
      actions.unshift({
        label: "Elimina", danger: true, close: false,
        onClick: async (close) => {
          if (!(await confirmDialog(`Eliminare definitivamente ${existing.name}?`, { danger: true, okLabel: "Elimina" }))) return false;
          await must(sb.from("characters").delete().eq("id", existing.id));
          saved = { deleted: true, id: existing.id };
          close();
        },
      });
    }

    modal({
      title: existing ? "Modifica personaggio" : "Nuovo personaggio",
      onClose: () => resolve(saved),
      body: h("div", { class: "form-grid" },
        h("div", { class: "portrait-col" }, preview,
          h("label", { class: "btn btn-sm", for: "portrait-file" }, "Scegli ritratto"), file,
          h("small", { class: "muted" }, "Usa una tua immagine.")),
        h("div", { class: "fields-col" },
          h("label", {}, "Nome", f.name),
          h("div", { class: "row2" }, h("label", {}, "Specie", f.species), h("label", {}, "Classe", f.cls)),
          h("div", { class: "row2" }, h("label", {}, "Livello", f.level), h("label", {}, "Background", f.background)),
          h("p", { class: "muted small" }, "La scheda completa (caratteristiche, PF, CA, abilità, incantesimi, inventario) arriverà nella Fase 3."),
          dlS, dlC)),
      actions,
    });
  });
}
