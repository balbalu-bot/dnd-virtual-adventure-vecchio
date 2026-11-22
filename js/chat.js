// Chat testuale: generale, privata, al DM, a gruppi + messaggi di sistema
// La riservatezza è garantita dal database (Row Level Security): un
// messaggio privato non viene nemmeno inviato a chi non è destinatario.
import { sb, must } from "./supabase.js";
import { store, on, emit, memberName } from "./store.js";
import { h, icon, toast, fmtTime, beep, modal, isMobile, escapeHtml } from "./ui.js";

let root, list, input, target, filterSel, counter, gameId;
const messages = new Map(); // id -> riga
let lastId = 0;
let unread = 0;
let unsub = [];
let groupSel = []; // destinatari scelti per "gruppo"

export function mountChat(container, gid) {
  gameId = gid;
  messages.clear(); lastId = 0; unread = 0;
  list = h("div", { class: "chat-list", role: "log", "aria-live": "polite" });
  target = h("select", { class: "chat-target", title: "A chi scrivi", onchange: onTargetChange });
  filterSel = h("select", { class: "chat-filter", title: "Filtra", onchange: renderAll },
    h("option", { value: "all" }, "Tutti i messaggi"),
    h("option", { value: "private" }, "Solo privati e gruppi"),
    h("option", { value: "public" }, "Solo chat generale"));
  input = h("textarea", {
    rows: 1, maxlength: 2000, placeholder: "Scrivi un messaggio…", enterkeyhint: "send",
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } },
    oninput: autoGrow,
  });
  counter = h("span", { class: "chat-target-label" });
  root = h("div", { class: "chat" },
    h("div", { class: "chat-head" }, filterSel),
    list,
    h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); send(); } },
      h("div", { class: "chat-to" }, h("span", { html: icon("send") }), target, counter),
      h("div", { class: "chat-input-row" }, input,
        h("button", { class: "btn btn-primary btn-send", type: "submit", "aria-label": "Invia", html: icon("send") }))));
  container.append(root);
  renderTargets();
  unsub = [on("members:changed", () => { renderTargets(); renderAll(); })];
  return root;
}

export function unmountChat() { unsub.forEach((u) => u()); unsub = []; root?.remove(); }

export async function loadInitial() {
  const rows = await must(sb.from("messages").select("*").eq("game_id", gameId).order("id", { ascending: false }).limit(200));
  rows.reverse().forEach((r) => addMessage(r, { silent: true }));
  scrollBottom(true);
}

/** Recupera i messaggi persi durante una disconnessione */
export async function catchUp() {
  if (!gameId) return;
  const rows = await must(sb.from("messages").select("*").eq("game_id", gameId).gt("id", lastId).order("id").limit(500));
  rows.forEach((r) => addMessage(r, { silent: true }));
}

function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; }

function renderTargets() {
  if (!target) return;
  const prev = target.value || "all";
  const me = store.user.id;
  const others = [...store.members.values()].filter((m) => m.status === "active" && m.user_id !== me)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const iAmDM = store.game?.dm_id === me;
  target.replaceChildren(
    h("option", { value: "all" }, "Tutti (chat generale)"),
    !iAmDM ? h("option", { value: "dm" }, "Solo il Dungeon Master") : null,
    h("optgroup", { label: "Messaggio privato a…" },
      others.map((m) => h("option", { value: "u:" + m.user_id }, m.display_name + (m.role === "dm" ? " (DM)" : "")))),
    h("option", { value: "group" }, groupSel.length ? `Gruppo: ${groupSel.map(memberName).join(", ")}` : "Gruppo selezionato…"));
  target.value = [...target.options].some((o) => o.value === prev) ? prev : "all";
  updateTargetLabel();
}

function updateTargetLabel() {
  const v = target.value;
  root?.classList.toggle("is-private", v !== "all");
  counter.textContent = v === "all" ? "" : "🔒 riservato";
}

function onTargetChange() {
  if (target.value === "group") pickGroup();
  updateTargetLabel();
}

export function setChatTarget(userId) {
  if (!target) return;
  target.value = "u:" + userId;
  updateTargetLabel();
  input.focus();
}

function pickGroup() {
  const me = store.user.id;
  const boxes = [...store.members.values()].filter((m) => m.status === "active" && m.user_id !== me).map((m) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value: m.user_id, checked: groupSel.includes(m.user_id) }), " ", m.display_name));
  modal({
    title: "Messaggio a un gruppo",
    body: h("div", { class: "check-list" }, boxes.length ? boxes : h("p", { class: "muted" }, "Non ci sono altri partecipanti.")),
    actions: [{ label: "Annulla", onClick: () => { if (!groupSel.length) target.value = "all"; updateTargetLabel(); } }, {
      label: "Usa questo gruppo", primary: true,
      onClick: () => {
        groupSel = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
        if (!groupSel.length) { target.value = "all"; } else { renderTargets(); target.value = "group"; }
        updateTargetLabel();
      },
    }],
  });
}

async function send() {
  const body = input.value.trim();
  if (!body) return;
  const v = target.value;
  let row = { game_id: gameId, kind: "general", body, sender_id: store.user.id };
  if (v === "dm") row.kind = "dm";
  else if (v.startsWith("u:")) { row.kind = "private"; row.recipients = [v.slice(2)]; }
  else if (v === "group") {
    if (!groupSel.length) { pickGroup(); return; }
    row.kind = "group"; row.recipients = groupSel;
  }
  input.value = ""; autoGrow();
  try {
    const saved = await must(sb.from("messages").insert(row).select().single());
    addMessage(saved, { silent: true });
    scrollBottom(true);
  } catch (e) {
    input.value = body;
    toast("Messaggio non inviato: " + e.message, "error");
  }
}

function visibleByFilter(m) {
  const f = filterSel?.value || "all";
  if (f === "all") return true;
  const priv = m.recipients && m.recipients.length;
  return f === "private" ? !!priv : !priv;
}

export function addMessage(m, { silent = false } = {}) {
  if (messages.has(m.id)) return;
  messages.set(m.id, m);
  lastId = Math.max(lastId, m.id);
  if (!visibleByFilter(m)) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(renderMessage(m));
  if (atBottom) scrollBottom();
  if (!silent && m.sender_id !== store.user.id) notify(m);
}

function renderAll() {
  list.replaceChildren(...[...messages.values()].sort((a, b) => a.id - b.id).filter(visibleByFilter).map(renderMessage));
  scrollBottom(true);
}

function describeRecipients(m) {
  const me = store.user.id;
  if (m.kind === "dm") return m.sender_id === me ? "al DM" : "riservato al DM";
  if (!m.recipients?.length) return "";
  const names = m.recipients.filter((id) => id !== me).map(memberName);
  if (m.sender_id === me) return "a " + names.join(", ");
  if (m.kind === "private") return "privato per te";
  return "gruppo: tu" + (names.length ? ", " + names.join(", ") : "");
}

function renderMessage(m) {
  const me = store.user.id;
  if (m.kind === "system") {
    return h("div", { class: `msg msg-system ${m.recipients ? "msg-secret" : ""}` },
      h("span", { class: "msg-time" }, fmtTime(m.created_at)), " ", m.body);
  }
  const priv = m.kind !== "general";
  const sender = store.members.get(m.sender_id);
  return h("div", { class: `msg ${m.sender_id === me ? "msg-mine" : ""} ${priv ? "msg-private" : ""}` },
    h("div", { class: "msg-head" },
      h("strong", { class: sender?.role === "dm" ? "is-dm" : "" }, m.sender_name || memberName(m.sender_id)),
      priv ? h("span", { class: "msg-badge", html: `${icon("lock")} ${escapeHtml(describeRecipients(m))}` }) : null,
      h("span", { class: "msg-time" }, fmtTime(m.created_at))),
    h("div", { class: "msg-body" }, m.body));
}

function scrollBottom(force) {
  requestAnimationFrame(() => { if (force || list) list.scrollTop = list.scrollHeight; });
}

function chatVisible() {
  const g = document.querySelector(".game");
  if (!g) return false;
  const pane = document.querySelector(".panel-chat");
  if (pane?.hidden) return false;
  if (isMobile()) return g.dataset.tab === "chat";
  return !document.hidden;
}

function notify(m) {
  const priv = m.kind !== "general" && m.kind !== "system";
  if (!chatVisible()) {
    unread++;
    emit("chat:unread", unread);
  }
  if (priv) {
    beep("message");
    if (!chatVisible() || isMobile()) toast(`🔒 Messaggio riservato da ${m.sender_name}`, "private", { timeout: 5000 });
  }
}

export function clearUnread() { unread = 0; emit("chat:unread", 0); }
