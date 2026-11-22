// Pannello del Dungeon Master (Fase 1: gestione stanza, accessi e partecipanti)
import { sb, rpc, must, callFunction } from "./supabase.js";
import { store } from "./store.js";
import { h, icon, modal, toast, confirmDialog, formatCode } from "./ui.js";
import { openInviteModal } from "./lobby.js";
import { navigate } from "./main.js";

async function updateGame(patch) {
  await must(sb.from("games").update(patch).eq("id", store.game.id));
}

/**
 * Prima di ammettere un giocatore il DM sceglie sulla mappa dove comparirà il
 * suo personaggio. Restituisce true se è stato ammesso.
 */
export async function approveMember(userId) {
  const m = store.members.get(userId);
  if (!m) return false;
  const { placePlayer } = await import("./map/table.js");
  const r = await placePlayer(m);
  if (r === "cancel") { toast("Ingresso in sospeso: il giocatore aspetta ancora.", "info"); return false; }
  await rpc("set_member_status", { p_game: store.game.id, p_user: userId, p_status: "active" });
  toast(r === "placed" ? `${m.display_name} è entrato ed è sulla mappa` : `${m.display_name} è entrato (nessuna mappa attiva: aggiungerai il personaggio dopo)`, "ok");
  return true;
}

export async function banMember(userId) {
  const m = store.members.get(userId);
  if (!(await confirmDialog(`Allontanare ${m?.display_name} dalla partita? Non potrà rientrare finché non lo riammetti.`, { danger: true, okLabel: "Allontana" }))) return;
  await rpc("set_member_status", { p_game: store.game.id, p_user: userId, p_status: "banned" });
  callFunction("livekit-moderate", { game_id: store.game.id, action: "kick", target: userId }).catch(() => {});
  toast(`${m?.display_name} è stato allontanato`, "ok");
}

export async function serverMute(userId) {
  const m = store.members.get(userId);
  try {
    await callFunction("livekit-moderate", { game_id: store.game.id, action: "mute", target: userId });
    toast(`Microfono di ${m?.display_name} spento per tutti`, "ok");
  } catch (e) { toast(e.message, "error"); }
}

export function openDmPanel(tab) { import("./dm-tools.js").then((m) => m.openDmTools(tab)); }

export function roomBody() {
  const g = store.game;
  const members = [...store.members.values()];
  const pending = members.filter((m) => m.status === "pending");
  const banned = members.filter((m) => m.status === "banned");
  const active = members.filter((m) => m.status === "active" && m.user_id !== store.user.id);

  const toggle = (label, field, hint) => h("label", { class: "check" },
    h("input", { type: "checkbox", checked: !!g[field], onchange: async (e) => {
      try { await updateGame({ [field]: e.target.checked }); } catch (err) { toast(err.message, "error"); e.target.checked = !e.target.checked; }
    } }), " ", label, hint ? h("small", { class: "muted" }, " — " + hint) : null);

  const name = h("input", { value: g.name, maxlength: 80 });

  return h("div", { class: "dm-panel" },
      h("section", {},
        h("h3", { html: `${icon("door")} Stanza` }),
        h("div", { class: "row-btns" },
          h("label", { class: "grow" }, "Nome della partita", name),
          h("button", { class: "btn", onclick: async () => { await updateGame({ name: name.value.trim() || g.name }); toast("Nome aggiornato", "ok"); } }, "Salva")),
        h("p", {}, "Codice di invito: ", h("strong", { class: "code-inline" }, formatCode(g.invite_code)), " ",
          h("button", { class: "btn btn-sm", onclick: () => openInviteModal(store.game) }, "Invita"), " ",
          h("button", {
            class: "btn btn-sm btn-ghost",
            onclick: async () => {
              if (!(await confirmDialog("Generare un nuovo codice? Il vecchio collegamento smetterà di funzionare (chi è già dentro resta)."))) return;
              const c = await rpc("regenerate_invite", { p_game: g.id });
              store.game.invite_code = c;
              toast("Nuovo codice: " + formatCode(c), "ok");
            },
          }, "Rigenera codice")),
        toggle("Stanza chiusa", "locked", "nessun nuovo ingresso"),
        toggle("Approvo io ogni nuovo ingresso", "require_approval", "sala d'attesa"),
        toggle("Sessione in pausa", "paused", "tutti vedono l'avviso di pausa")),

      pending.length ? h("section", {},
        h("h3", { html: `${icon("hourglass")} Richieste di ingresso` }),
        pending.map((m) => h("div", { class: "dm-row" }, h("strong", {}, m.display_name), h("span", { class: "muted" }, m.character_name),
          h("div", { class: "row-btns" },
            h("button", { class: "btn btn-sm btn-primary", onclick: async (e) => { const row = e.target.closest(".dm-row"); if (await approveMember(m.user_id)) row?.remove(); } }, "Ammetti e posiziona"),
            h("button", { class: "btn btn-sm btn-danger", onclick: async (e) => { await rpc("reject_member", { p_game: g.id, p_user: m.user_id }); e.target.closest(".dm-row").remove(); } }, "Rifiuta"))))) : null,

      h("section", {},
        h("h3", { html: `${icon("users")} Partecipanti` }),
        active.length ? active.map((m) => h("div", { class: "dm-row" },
          h("strong", {}, m.display_name), h("span", { class: "muted" }, m.character_name || "—"),
          h("div", { class: "row-btns" },
            h("button", { class: "btn btn-sm", title: "Spegne il microfono di questa persona per tutti", onclick: () => serverMute(m.user_id), html: `${icon("micOff")} Silenzia per tutti` }),
            h("button", {
              class: "btn btn-sm", html: `${icon("crown")} Rendi DM`,
              onclick: async () => {
                if (!(await confirmDialog(`Trasferire il ruolo di Dungeon Master a ${m.display_name}? Diventerai un giocatore.`))) return;
                await rpc("transfer_dm", { p_game: g.id, p_user: m.user_id });
                toast(`${m.display_name} è il nuovo DM`, "ok");
                location.reload();
              },
            }),
            h("button", { class: "btn btn-sm btn-danger", html: `${icon("ban")} Allontana`, onclick: () => banMember(m.user_id) }))))
          : h("p", { class: "muted" }, "Nessun altro partecipante per ora.")),

      banned.length ? h("section", {},
        h("h3", { html: `${icon("ban")} Allontanati / rifiutati` }),
        banned.map((m) => h("div", { class: "dm-row" }, h("strong", {}, m.display_name),
          h("button", { class: "btn btn-sm", onclick: async (e) => { const row = e.target.closest(".dm-row"); if (await approveMember(m.user_id)) row?.remove(); } }, "Riammetti")))) : null,

      h("section", { class: "danger-zone" },
        h("h3", {}, "Zona pericolosa"),
        h("button", {
          class: "btn btn-danger",
          onclick: async () => {
            if (!(await confirmDialog(`Eliminare per sempre la partita «${g.name}» con tutti i messaggi? L'operazione non si può annullare.`, { danger: true, okLabel: "Elimina per sempre" }))) return;
            await rpc("delete_game", { p_game: g.id });
            toast("Partita eliminata", "ok");
            document.querySelector(".modal-wrap")?.remove();
            navigate("#/");
          },
        }, "Elimina partita")));
}
