// Schermata di gioco: layout, partecipanti, canali, comandi vocali, tempo reale
import { sb, rpc, must } from "./supabase.js";
import { store, emit, on, isDM, memberName } from "./store.js";
import { h, icon, toast, modal, avatar, isTypingTarget, beep, formatCode, isMobile, savePref, loadPref, confirmDialog } from "./ui.js";
import {
  voice, connectVoice, disconnectVoice, pttDown, pttUp, setMicMode, setCamera, setAudioOnly, setVideosHidden,
  switchChannel, channelsUpdated, setParticipantVolume, setParticipantMutedLocal, unlockAudio, listDevices,
  switchDevice, supportsOutputSelection, setPttKey, setSounds, setDuck, isOnline,
} from "./voice.js";
import { mountVideoDock, unmountVideoDock } from "./video.js";
import { mountChat, unmountChat, loadInitial, catchUp, addMessage, clearUnread, setChatTarget } from "./chat.js";
import { openDmPanel, approveMember, banMember, serverMute } from "./dm-panel.js";
import { openInviteModal } from "./lobby.js";
import { listMyCharacters, characterSummary } from "./characters.js";
import { navigate } from "./main.js";
import { mountTable, unmountTable, reloadTable, tableRealtime } from "./map/table.js";
import { mountDice, unmountDice, addRoll, reloadDice } from "./dice.js";

let root, rt, heartbeat, unsubs = [], keyHandlers = null, groupPick = new Set(), wasSubscribed = false;
let els = {};

// ================================================================== ingresso / uscita

export async function enterGame(app, gameId) {
  await leaveGameScreen();
  app.replaceChildren(h("div", { class: "boot" }, h("div", { class: "boot-crest" }), h("p", {}, "Preparazione del tavolo…")));
  try {
    const game = await must(sb.from("games").select("*").eq("id", gameId).maybeSingle());
    const me = await must(sb.from("members").select("*").eq("game_id", gameId).eq("user_id", store.user.id).maybeSingle());
    if (!game || !me || me.status !== "active") {
      toast(me?.status === "pending" ? "Il DM non ti ha ancora ammesso." : "Non hai accesso a questa partita.", "error");
      navigate("#/");
      return;
    }
    store.game = game;
    store.me = me;
    await reloadState();
  } catch (e) {
    toast(e.message, "error");
    navigate("#/");
    return;
  }

  buildLayout(app);
  subscribeRealtime(gameId);
  await loadInitial().catch((e) => toast(e.message, "error"));
  await reloadTable().catch((e) => toast("Mappa: " + e.message, "error"));
  touch();
  heartbeat = setInterval(touch, 60000);
  installKeys();
  unsubs.push(on("voice:state", renderControls), on("voice:state", renderBanners),
    on("voice:participants", renderMembers), on("voice:speaking", markSpeakingMembers),
    on("members:changed", renderMembers), on("channels:changed", renderControls),
    on("chat:unread", (n) => { els.chatBadge.textContent = n ? String(n) : ""; els.chatBadge.hidden = !n; }));
  window.addEventListener("online", resync);
  document.addEventListener("visibilitychange", onVisible);
  showJoinOverlay();
}

export async function leaveGameScreen() {
  if (!root) return;
  clearInterval(heartbeat);
  unsubs.forEach((u) => u()); unsubs = [];
  removeKeys();
  window.removeEventListener("online", resync);
  document.removeEventListener("visibilitychange", onVisible);
  if (rt) { await sb.removeChannel(rt); rt = null; }
  await disconnectVoice();
  unmountVideoDock();
  unmountChat();
  unmountTable();
  unmountDice();
  root.remove(); root = null;
  document.querySelectorAll(".modal-wrap").forEach((m) => m.remove());
  store.game = null; store.me = null; store.members.clear(); store.channels.clear(); store.characters.clear();
  document.title = "D&D Virtual Adventure";
}

async function reloadState() {
  const gid = store.game.id;
  const [game, members, channels] = await Promise.all([
    must(sb.from("games").select("*").eq("id", gid).maybeSingle()),
    must(sb.from("members").select("*").eq("game_id", gid)),
    must(sb.from("voice_channels").select("*").eq("game_id", gid).eq("active", true)),
  ]);
  if (!game) {
    toast("La partita non esiste più o non hai più accesso.", "error");
    navigate("#/");
    throw new Error("Partita non disponibile");
  }
  store.game = game;
  store.members = new Map(members.map((m) => [m.user_id, m]));
  store.me = store.members.get(store.user.id);
  store.channels = new Map(channels.map((c) => [c.id, c]));
  const charIds = members.map((m) => m.character_id).filter(Boolean);
  if (charIds.length) {
    const chars = await must(sb.from("characters").select("id,name,species,class,level,portrait").in("id", charIds));
    store.characters = new Map(chars.map((c) => [c.id, c]));
  }
  emit("members:changed");
  emit("channels:changed");
  channelsUpdated();
}

async function resync() {
  if (!store.game) return;
  try { await reloadState(); await catchUp(); await reloadTable(); await reloadDice(); renderHeader(); renderBanners(); } catch { /* riproverà */ }
}

let hiddenAt = 0;
function onVisible() {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (Date.now() - hiddenAt > 20000) resync();
}

function touch() {
  if (!store.game) return;
  const gid = store.game.id;
  sb.from("members").update({ last_seen: new Date().toISOString() })
    .eq("game_id", gid).eq("user_id", store.user.id).select("status")
    .then(({ data, error }) => {
      if (error || !store.game || store.game.id !== gid) return;
      if (!data?.length || data[0].status !== "active") {
        toast("Non fai più parte di questa partita (eliminata o accesso revocato).", "error", { timeout: 9000 });
        navigate("#/");
      }
    });
}

// ================================================================== tempo reale

function subscribeRealtime(gid) {
  wasSubscribed = false;
  rt = sb.channel(`game-${gid}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `game_id=eq.${gid}` }, (p) => onMessage(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `game_id=eq.${gid}` }, (p) => onMember(p))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gid}` }, (p) => onGame(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "voice_channels", filter: `game_id=eq.${gid}` }, (p) => onChannel(p))
    .on("postgres_changes", { event: "*", schema: "public", table: "maps", filter: `game_id=eq.${gid}` }, (p) => tableRealtime.map(p))
    .on("postgres_changes", { event: "*", schema: "public", table: "tokens", filter: `game_id=eq.${gid}` }, (p) => tableRealtime.token(p))
    .on("postgres_changes", { event: "*", schema: "public", table: "drawings", filter: `game_id=eq.${gid}` }, (p) => tableRealtime.drawing(p))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "map_signals", filter: `game_id=eq.${gid}` }, (p) => tableRealtime.signal(p.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "dice_rolls", filter: `game_id=eq.${gid}` }, (p) => onRoll(p.new))
    .on("broadcast", { event: "table" }, ({ payload }) => tableRealtime.broadcast(payload))
    .subscribe((status) => {
      if (!els.syncDot) return;
      els.syncDot.dataset.state = status === "SUBSCRIBED" ? "ok" : "warn";
      els.syncDot.title = status === "SUBSCRIBED" ? "Sincronizzato in tempo reale" : "Sincronizzazione in corso…";
      if (status === "SUBSCRIBED") { if (wasSubscribed) resync(); wasSubscribed = true; }
    });
}

function sendBroadcast(payload) {
  if (rt) rt.send({ type: "broadcast", event: "table", payload }).catch?.(() => {});
}

function onRoll(r) {
  if (!r?.id) return;
  addRoll(r, { animate: true, mine: r.roller_id === store.user.id });
}

function onMessage(m) {
  addMessage(m);
  if (m.kind === "system" && m.meta?.event === "join_request" && isDM()) {
    beep("alert");
    toast(m.body, "private", { timeout: 12000, action: { label: "Gestisci", onClick: openDmPanel } });
  }
}

async function onMember(p) {
  if (p.eventType === "DELETE") {
    if (p.old?.user_id) { store.members.delete(p.old.user_id); emit("members:changed"); }
    return;
  }
  const row = p.new && Object.keys(p.new).length ? p.new : null;
  if (!row) return;
  const prev = store.members.get(row.user_id);
  store.members.set(row.user_id, row);
  if (row.character_id && !store.characters.has(row.character_id)) {
    const { data } = await sb.from("characters").select("id,name,species,class,level,portrait").eq("id", row.character_id).maybeSingle();
    if (data) store.characters.set(data.id, data);
  }
  if (row.user_id === store.user.id) {
    store.me = row;
    if (row.status === "banned") {
      toast("Il Dungeon Master ti ha allontanato dalla partita.", "error", { timeout: 9000 });
      navigate("#/");
      return;
    }
    if (prev && prev.role !== row.role) { renderHeader(); }
  }
  emit("members:changed");
}

function onGame(g) {
  const wasPaused = store.game?.paused;
  const dmChanged = store.game && store.game.dm_id !== g.dm_id;
  const mapChanged = store.game && store.game.active_map_id !== g.active_map_id;
  store.game = { ...store.game, ...g };
  if (mapChanged) tableRealtime.activeMapChanged();
  if (!wasPaused && g.paused) toast("Il DM ha messo in pausa la sessione.", "info");
  renderHeader(); renderBanners();
  if (dmChanged) { reloadState(); }
}

function onChannel(p) {
  const row = p.new && p.new.id ? p.new : null;
  if (!row) return;
  const me = store.user.id;
  const known = store.channels.has(row.id);
  if (row.active && row.members.includes(me)) store.channels.set(row.id, row);
  else store.channels.delete(row.id);
  if (!known && row.active && row.members.includes(me) && row.created_by !== me) {
    const who = memberName(row.created_by);
    beep("private");
    if (!voice.state.activeChannelId) {
      switchChannel(row.id);
      toast(`📻 ${who} ti ha aperto un canale privato: ora parli solo con ${channelLabel(row)}.`, "private", {
        timeout: 9000, action: { label: "Torna al generale", onClick: () => switchChannel(null) },
      });
    } else {
      toast(`📻 ${who} ti invita in un canale privato (${channelLabel(row)}).`, "private", {
        timeout: 12000, action: { label: "Passa", onClick: () => switchChannel(row.id) },
      });
    }
  }
  channelsUpdated();
  emit("channels:changed");
}

export function channelLabel(ch) {
  const others = ch.members.filter((id) => id !== store.user.id).map(memberName);
  return ch.name ? `${ch.name} (${others.join(", ")})` : others.join(", ");
}

async function openPrivate(ids) {
  try {
    const cid = await rpc("open_voice_channel", { p_game: store.game.id, p_members: ids, p_name: "" });
    const row = await must(sb.from("voice_channels").select("*").eq("id", cid).single());
    store.channels.set(row.id, row);
    emit("channels:changed");
    await switchChannel(row.id);
    toast(`Canale privato con ${channelLabel(row)}: gli altri non ti sentono.`, "private", { timeout: 5000 });
  } catch (e) { toast(e.message, "error"); }
}

async function leaveChannel(id) {
  try {
    if (voice.state.activeChannelId === id) await switchChannel(null);
    await rpc("leave_voice_channel", { p_channel: id });
    store.channels.delete(id);
    emit("channels:changed");
  } catch (e) { toast(e.message, "error"); }
}

// ================================================================== layout

function buildLayout(app) {
  root = h("div", { class: "game", dataset: { tab: loadPref("mobileTab", "table") } });
  els = {};

  // --- barra superiore
  els.title = h("div", { class: "topbar-title" });
  els.syncDot = h("span", { class: "sync-dot", dataset: { state: "warn" } });
  els.voiceChip = h("span", { class: "voice-chip" });
  els.txChip = h("span", { class: "tx-chip", hidden: true, html: `${icon("radio")} IN TRASMISSIONE` });
  els.dmBtn = h("button", { class: "btn btn-sm btn-gold", html: `${icon("crown")} <span>Pannello DM</span>`, onclick: openDmPanel });
  const topbar = h("header", { class: "topbar" },
    h("button", { class: "icon-btn", title: "Torna alla schermata iniziale", html: icon("back"), onclick: () => navigate("#/") }),
    els.title,
    h("div", { class: "topbar-status" }, els.syncDot, els.voiceChip, els.txChip),
    h("div", { class: "topbar-actions" },
      els.dmBtn,
      h("button", { class: "btn btn-sm", html: `${icon("share")} <span>Invita</span>`, onclick: () => openInviteModal(store.game) }),
      h("button", { class: "icon-btn", title: "Impostazioni", html: icon("gear"), onclick: openSettings })));

  els.banners = h("div", { class: "banners" });

  // --- colonne
  els.members = h("div", { class: "members" });
  els.groupBar = h("div", { class: "group-bar", hidden: true });
  const left = h("aside", { class: "col col-left", dataset: { pane: "party" } },
    h("div", { class: "panel" },
      h("h3", { class: "panel-title", html: `${icon("users")} Il gruppo` }),
      els.members, els.groupBar),
    h("div", { class: "panel panel-soon" },
      h("h3", { class: "panel-title", html: `${icon("sword")} Iniziativa e combattimento` }),
      h("p", { class: "muted small" }, "Ordine di iniziativa, turni, round e PF in combattimento: Fase 3.")),
    h("div", { class: "panel" },
      h("h3", { class: "panel-title", html: `${icon("map")} Elementi sulla mappa` }),
      els.tokenList = h("div", { class: "tok-list" })),
    h("div", { class: "panel panel-help small muted" },
      h("p", {}, "✋ trascina i token · rotellina o due dita per lo zoom · trascina il vuoto per spostarti · 📏 righello · 📍 segnala un punto (Alt+clic)")));

  els.stageChannel = h("div", { class: "stage-channel" });
  const center = h("main", { class: "col col-center", dataset: { pane: "table" } },
    els.stage = h("div", { class: "stage" }, els.stageChannel));

  els.chatPane = h("div", { class: "panel panel-chat" });
  els.dicePane = h("div", { class: "panel panel-dice", hidden: true });
  const rtab = (id, ic, label) => h("button", {
    class: "right-tab", dataset: { rt: id }, html: `${icon(ic)} ${label}`,
    onclick: () => setRightTab(id),
  });
  const right = h("aside", { class: "col col-right", dataset: { pane: "chat" } },
    h("div", { class: "right-tabs" },
      rtab("chat", "chat", "Chat"), rtab("dice", "dice", "Dadi"),
      h("span", { class: "right-tab soon", title: "Fase 3", html: `${icon("scroll")} Scheda` })),
    els.chatPane, els.dicePane);

  const layout = h("div", { class: "layout" }, left, center, right);

  // --- barra comandi inferiore
  els.controls = h("footer", { class: "controlbar" });

  // --- schede smartphone
  els.chatBadge = h("span", { class: "badge", hidden: true });
  const tab = (id, ic, label, extra) => h("button", {
    class: "mtab", dataset: { tab: id },
    onclick: () => { root.dataset.tab = id; savePref("mobileTab", id); if (id === "chat") clearUnread(); },
  }, h("span", { html: icon(ic) }), h("span", {}, label), extra || null);
  const mtabs = h("nav", { class: "mobile-tabs" },
    tab("table", "map", "Tavolo"), tab("party", "users", "Gruppo"), tab("chat", "chat", "Chat", els.chatBadge), tab("video", "cam", "Video"));

  root.append(topbar, els.banners, layout, els.controls, mtabs);
  app.replaceChildren(root);

  mountVideoDock(root);
  root.insertBefore(root.querySelector(".video-dock"), layout);
  mountChat(els.chatPane, store.game.id);
  mountTable(els.stage, els.tokenList, { gameId: store.game.id, sendBroadcast });
  mountDice(els.dicePane, store.game.id, els.stage);
  setRightTab(loadPref("rightTab", "chat"));

  renderHeader(); renderBanners(); renderMembers(); renderControls();
}

function setRightTab(id) {
  savePref("rightTab", id);
  els.chatPane.hidden = id !== "chat";
  els.dicePane.hidden = id !== "dice";
  root.querySelectorAll(".right-tab[data-rt]").forEach((b) => b.classList.toggle("active", b.dataset.rt === id));
  if (id === "chat") clearUnread();
}

function compassSvg() {
  return `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="100" cy="100" r="88" opacity=".5"/><circle cx="100" cy="100" r="70" stroke-dasharray="3 6" opacity=".6"/>
    <path d="M100 8 L114 100 L100 192 L86 100 Z" fill="currentColor" fill-opacity=".18"/>
    <path d="M8 100 L100 86 L192 100 L100 114 Z" fill="currentColor" fill-opacity=".1"/>
    <path d="M100 8 L114 100 L100 100 Z" fill="currentColor" fill-opacity=".55"/>
    <text x="100" y="30" text-anchor="middle" font-size="16" fill="currentColor" stroke="none" font-family="Cinzel, serif">N</text></svg>`;
}

function renderHeader() {
  if (!els.title || !store.game) return;
  const dm = isDM();
  els.title.replaceChildren(
    h("strong", { class: "title-font" }, store.game.name),
    h("span", { class: `role-badge ${dm ? "dm" : ""}` }, dm ? "DM" : "Giocatore"),
    h("span", { class: "code-chip", title: "Codice di invito" }, formatCode(store.game.invite_code)));
  els.dmBtn.hidden = !dm;
  document.title = `${store.game.name} — D&D VA`;
}

function renderBanners() {
  if (!els.banners) return;
  const b = [];
  const st = voice.state;
  if (store.game?.paused) b.push(h("div", { class: "banner banner-pause", html: `${icon("pause")} Sessione in pausa: il Dungeon Master ha fermato il gioco.` }));
  if (st.status === "reconnecting") b.push(h("div", { class: "banner banner-warn", html: `${icon("wifi")} Connessione audio/video instabile: riconnessione in corso…` }));
  if (st.status === "error") b.push(h("div", { class: "banner banner-error" }, st.error + " ",
    h("button", { class: "btn btn-sm", onclick: () => connectVoice(store.game.id, { mic: true, cam: false }) }, "Riprova")));
  if (st.needsAudioUnlock) b.push(h("div", { class: "banner banner-warn" }, "Il browser ha bloccato l'audio. ",
    h("button", { class: "btn btn-sm btn-primary", onclick: unlockAudio }, "Tocca qui per sentire gli altri")));
  els.banners.replaceChildren(...b);
  els.voiceChip.dataset.state = st.status;
  els.voiceChip.innerHTML = {
    idle: `${icon("headphones")} audio spento`, connecting: `${icon("headphones")} collegamento…`,
    connected: `${icon("headphones")} audio ok`, reconnecting: `${icon("wifi")} riconnessione…`, error: `${icon("headphones")} audio non disponibile`,
  }[st.status] || "";
}

// ================================================================== partecipanti

function renderMembers() {
  if (!els.members) return;
  const me = store.user.id;
  const dm = isDM();
  const all = [...store.members.values()];
  const active = all.filter((m) => m.status === "active")
    .sort((a, b) => (b.role === "dm") - (a.role === "dm") || (b.user_id === me) - (a.user_id === me) || a.display_name.localeCompare(b.display_name));
  const pending = dm ? all.filter((m) => m.status === "pending") : [];
  const channelMembers = voice.state.activeChannelId ? store.channels.get(voice.state.activeChannelId)?.members || [] : null;

  els.members.replaceChildren(
    ...pending.map((m) => h("div", { class: "member pending" },
      h("span", { class: "avatar avatar-txt", html: icon("hourglass") }),
      h("div", { class: "member-main" }, h("strong", {}, m.display_name), h("div", { class: "muted small" }, "chiede di entrare")),
      h("div", { class: "member-actions" },
        h("button", { class: "btn btn-sm btn-primary", onclick: () => approveMember(m.user_id).catch((e) => toast(e.message, "error")) }, "Ammetti"),
        h("button", { class: "btn btn-sm btn-danger", onclick: () => rpc("reject_member", { p_game: store.game.id, p_user: m.user_id }).catch((e) => toast(e.message, "error")) }, "Rifiuta")))),
    ...active.map((m) => memberRow(m, { me, dm, channelMembers })));
  markSpeakingMembers(voice.speaking);
  renderGroupBar();
}

function memberRow(m, { me, dm, channelMembers }) {
  const isMe = m.user_id === me;
  const online = isOnline(m.user_id);
  const ch = m.character_id ? store.characters.get(m.character_id) : null;
  const inMyChannel = channelMembers && channelMembers.includes(m.user_id);
  const mutedLocal = voice.mutedLocal.has(m.user_id);
  const vol = Math.round((voice.volumes[m.user_id] ?? 1) * 100);

  const actions = [];
  if (!isMe) {
    actions.push(
      h("label", { class: "pick", title: "Seleziona per un canale/gruppo" },
        h("input", { type: "checkbox", checked: groupPick.has(m.user_id), onchange: (e) => { e.target.checked ? groupPick.add(m.user_id) : groupPick.delete(m.user_id); renderGroupBar(); } })),
      h("button", { class: "icon-btn radio-btn", title: `Parla in privato con ${m.display_name}`, html: icon("radio"), onclick: () => openPrivate([m.user_id]) }),
      h("button", { class: "icon-btn", title: `Messaggio privato a ${m.display_name}`, html: icon("chat"), onclick: () => { setChatTarget(m.user_id); if (isMobile()) { root.dataset.tab = "chat"; clearUnread(); } } }),
      h("button", {
        class: `icon-btn ${mutedLocal ? "on-danger" : ""}`, title: mutedLocal ? "Riattiva il suo audio (per te)" : "Silenzia (solo per te)",
        html: icon(mutedLocal ? "volumeOff" : "volume"), onclick: () => setParticipantMutedLocal(m.user_id, !mutedLocal),
      }));
    if (dm) {
      actions.push(
        h("button", { class: "icon-btn", title: "Spegni il suo microfono per tutti", html: icon("micOff"), onclick: () => serverMute(m.user_id) }),
        h("button", { class: "icon-btn on-danger-hover", title: "Allontana dalla partita", html: icon("ban"), onclick: () => banMember(m.user_id).catch((e) => toast(e.message, "error")) }));
    }
  }
  return h("div", { class: `member ${online ? "online" : "offline"} ${inMyChannel ? "in-channel" : ""} ${isMe ? "me" : ""}`, dataset: { id: m.user_id } },
    h("div", { class: "member-av" }, avatar(m.display_name, ch?.portrait), h("span", { class: "dot", title: online ? "Collegato" : "Non collegato" })),
    h("div", { class: "member-main" },
      h("div", { class: "member-name" },
        m.role === "dm" ? h("span", { class: "crown", title: "Dungeon Master", html: icon("crown") }) : null,
        h("strong", {}, m.display_name + (isMe ? " (tu)" : "")),
        inMyChannel ? h("span", { class: "pill pill-private" }, "privato") : null),
      h("div", { class: "muted small" }, m.character_name ? `${m.character_name}${ch ? " · " + characterSummary(ch) : ""}` : (m.role === "dm" ? "Dungeon Master" : "senza personaggio")),
      !isMe ? h("input", {
        type: "range", min: 0, max: 150, value: vol, class: "vol", title: `Volume ${vol}%`, disabled: mutedLocal,
        oninput: (e) => { setParticipantVolume(m.user_id, e.target.value / 100); e.target.title = `Volume ${e.target.value}%`; },
      }) : null),
    h("div", { class: "member-actions" }, actions));
}

function markSpeakingMembers(set) {
  els.members?.querySelectorAll(".member[data-id]").forEach((el) => el.classList.toggle("speaking", !!set?.has(el.dataset.id)));
}

function renderGroupBar() {
  for (const id of [...groupPick]) if (!store.members.get(id) || store.members.get(id).status !== "active") groupPick.delete(id);
  els.groupBar.hidden = groupPick.size === 0;
  if (!groupPick.size) return;
  const names = [...groupPick].map(memberName).join(", ");
  els.groupBar.replaceChildren(
    h("div", { class: "small" }, `Selezionati: ${names}`),
    h("div", { class: "row-btns" },
      h("button", { class: "btn btn-sm btn-private", html: `${icon("radio")} Canale vocale privato`, onclick: () => { openPrivate([...groupPick]); groupPick.clear(); renderMembers(); } }),
      h("button", { class: "btn btn-sm btn-ghost", onclick: () => { groupPick.clear(); renderMembers(); } }, "Annulla")));
}

// ================================================================== comandi vocali

function renderControls() {
  if (!els.controls) return;
  const st = voice.state;
  const ch = st.activeChannelId ? store.channels.get(st.activeChannelId) : null;
  const priv = !!ch;
  root.classList.toggle("in-private", priv);
  root.classList.toggle("transmitting", st.transmitting);
  els.txChip.hidden = !st.transmitting;
  els.txChip.classList.toggle("private", priv);

  // indicatore canale anche sopra il tavolo
  els.stageChannel.className = `stage-channel ${priv ? "private" : ""}`;
  els.stageChannel.innerHTML = priv
    ? `${icon("lock")} <b>CANALE PRIVATO</b> con ${escapeHtml(channelLabel(ch))} — gli altri NON ti sentono`
    : `${icon("users")} <b>CANALE GENERALE</b> — ti sentono tutti`;

  const connected = st.status === "connected" || st.status === "reconnecting";
  const pttLabel = !connected ? "Audio non collegato"
    : !st.micReady ? "Attiva il microfono"
      : st.micMode === "open" ? (st.transmitting ? "Microfono APERTO" : "Microfono chiuso")
        : st.micMode === "ptt-toggle" ? (st.transmitting ? "IN TRASMISSIONE · clic per chiudere" : "Clic per parlare")
          : (st.transmitting ? "IN TRASMISSIONE" : "Tieni premuto per parlare");

  const ptt = h("button", {
    class: `ptt ${st.transmitting ? "tx" : ""} ${priv ? "private" : ""}`, disabled: !connected,
    "aria-pressed": String(st.transmitting), title: st.micMode === "ptt-hold" ? `Tieni premuto (o il tasto ${keyName(st.pttKey)})` : "",
  }, h("span", { class: "ptt-ico", html: icon(st.micMode === "open" ? (st.transmitting ? "mic" : "micOff") : "radio") }), h("span", { class: "ptt-label" }, pttLabel));
  wirePtt(ptt);

  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Modalità microfono" },
    [["open", "Aperto"], ["ptt-hold", "PTT premuto"], ["ptt-toggle", "PTT clic"]].map(([v, l]) =>
      h("button", { class: st.micMode === v ? "active" : "", onclick: () => setMicMode(v) }, l)));

  const channels = [...store.channels.values()].filter((c) => c.active);
  const chanBtn = h("button", {
    class: `chan-btn ${priv ? "private" : ""}`, onclick: (e) => openChannelMenu(e.currentTarget),
    html: `${icon(priv ? "lock" : "users")}<span class="chan-text"><small>Canale attivo</small><b>${priv ? "Privato: " + escapeHtml(channelLabel(ch)) : "Generale"}</b></span>${channels.length ? `<span class="chan-count">${channels.length}</span>` : ""}`,
  });

  els.controls.replaceChildren(
    h("div", { class: "cb-left" }, chanBtn,
      priv ? h("button", { class: "btn btn-back-general", onclick: () => switchChannel(null), html: `${icon("back")} Torna al generale` }) : null),
    h("div", { class: "cb-center" }, ptt),
    h("div", { class: "cb-right" },
      modeSeg,
      h("button", {
        class: `icon-btn big ${st.camOn ? "on" : ""}`, title: st.camOn ? "Spegni videocamera" : "Accendi videocamera", disabled: !connected || st.audioOnly,
        html: icon(st.camOn ? "cam" : "camOff"), onclick: () => setCamera(!st.camOn),
      }),
      h("button", {
        class: `icon-btn big ${st.audioOnly ? "on-warn" : ""}`, title: st.audioOnly ? "Modalità solo audio attiva (clic per disattivare)" : "Solo audio (connessione lenta)",
        html: icon("headphones"), onclick: () => setAudioOnly(!st.audioOnly),
      }),
      st.videosHidden ? h("button", { class: "icon-btn big", title: "Mostra i video", html: icon("eye"), onclick: () => setVideosHidden(false) }) : null,
      !connected && st.status !== "connecting" ? h("button", { class: "btn btn-sm btn-primary", onclick: showJoinOverlay }, "Collega audio") : null));
  renderBanners();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function wirePtt(btn) {
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("pointerdown", (e) => {
    if (btn.disabled || e.button > 0) return;
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    if (!voice.state.micReady) { pttDown(); return; }
    pttDown();
  });
  const up = () => { if (voice.state.micMode === "ptt-hold") pttUp(); };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("lostpointercapture", up);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pttDown(); } });
  btn.addEventListener("keyup", (e) => { if (e.key === "Enter") up(); });
}

function openChannelMenu(anchor) {
  document.querySelector(".chan-menu")?.remove();
  const st = voice.state;
  const channels = [...store.channels.values()].filter((c) => c.active);
  const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  const item = (label, active, onClick, extra) => h("div", { class: `chan-item ${active ? "active" : ""}` },
    h("button", { class: "chan-pick", onclick: () => { onClick(); close(); } }, label), extra || null);
  const menu = h("div", { class: "chan-menu" },
    h("div", { class: "chan-menu-title" }, "Su quale canale trasmetti?"),
    item(h("span", { html: `${icon("users")} Canale generale` }), !st.activeChannelId, () => switchChannel(null)),
    channels.map((c) => item(h("span", { html: `${icon("lock")} ${escapeHtml(channelLabel(c))}` }), st.activeChannelId === c.id, () => switchChannel(c.id),
      h("button", { class: "icon-btn", title: "Esci da questo canale", html: icon("x"), onclick: () => { leaveChannel(c.id); close(); } }))),
    h("button", { class: "btn btn-sm btn-private chan-new", html: `${icon("plus")} Nuovo canale privato…`, onclick: () => { close(); pickChannelMembers(); } }));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left)) + "px";
  menu.style.bottom = (window.innerHeight - r.top + 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}

function pickChannelMembers() {
  const me = store.user.id;
  const boxes = [...store.members.values()].filter((m) => m.status === "active" && m.user_id !== me)
    .map((m) => h("label", { class: "check" }, h("input", { type: "checkbox", value: m.user_id }), " ", m.display_name,
      m.character_name ? h("span", { class: "muted" }, ` (${m.character_name})`) : null,
      isOnline(m.user_id) ? null : h("span", { class: "muted small" }, " — non collegato")));
  modal({
    title: "Nuovo canale vocale privato",
    body: h("div", {}, h("p", {}, "Scegli con chi parlare. Solo le persone selezionate sentiranno la tua voce."),
      h("div", { class: "check-list" }, boxes.length ? boxes : h("p", { class: "muted" }, "Non ci sono altri partecipanti."))),
    actions: [{ label: "Annulla" }, {
      label: "Apri canale", primary: true,
      onClick: async () => {
        const ids = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
        if (!ids.length) { toast("Seleziona almeno una persona", "error"); return false; }
        await openPrivate(ids);
      },
    }],
  });
}

// ================================================================== scorciatoie da tastiera

function keyName(code) {
  return { Space: "SPAZIO", ControlLeft: "CTRL sinistro", ControlRight: "CTRL destro", AltLeft: "ALT", ShiftLeft: "MAIUSC" }[code] || code.replace(/^Key/, "").replace(/^Digit/, "");
}

function installKeys() {
  let down = false;
  const kd = (e) => {
    if (e.code !== voice.state.pttKey || e.repeat || isTypingTarget(e.target) || document.querySelector(".modal-wrap")) return;
    e.preventDefault();
    if (voice.state.micMode === "ptt-hold") { if (!down) { down = true; pttDown(); } }
    else pttDown();
  };
  const ku = (e) => {
    if (e.code !== voice.state.pttKey) return;
    if (down) { down = false; pttUp(); }
  };
  const blur = () => { if (down) { down = false; pttUp(); } };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);
  keyHandlers = { kd, ku, blur };
}

function removeKeys() {
  if (!keyHandlers) return;
  window.removeEventListener("keydown", keyHandlers.kd);
  window.removeEventListener("keyup", keyHandlers.ku);
  window.removeEventListener("blur", keyHandlers.blur);
  keyHandlers = null;
}

// ================================================================== ingresso audio/video

function showJoinOverlay() {
  if (document.querySelector(".join-overlay")) return;
  const mic = h("input", { type: "checkbox", checked: loadPref("joinMic", true) });
  const cam = h("input", { type: "checkbox", checked: loadPref("joinCam", !voice.state.audioOnly) });
  const ov = h("div", { class: "join-overlay" },
    h("div", { class: "parchment join-card" },
      h("h2", { class: "title-font" }, store.game.name),
      h("p", {}, "Stai per sederti al tavolo. Il browser ti chiederà il permesso per microfono e videocamera."),
      h("label", { class: "check" }, mic, " Microfono (consigliato: anche in modalità PTT)"),
      h("label", { class: "check" }, cam, " Videocamera"),
      h("p", { class: "muted small" }, "Consiglio: usa cuffie o auricolari per evitare l'eco."),
      h("div", { class: "row-btns center" },
        h("button", {
          class: "btn btn-primary btn-big", html: `${icon("door")} Entra al tavolo`,
          onclick: async () => {
            savePref("joinMic", mic.checked); savePref("joinCam", cam.checked);
            beep("tx-off"); // sblocca l'audio su iPhone (serve un tocco)
            ov.remove();
            const ok = await connectVoice(store.game.id, { mic: mic.checked, cam: cam.checked });
            if (ok) await unlockAudio();
          },
        }),
        h("button", { class: "btn btn-ghost", onclick: () => ov.remove() }, "Solo chat, senza audio"))));
  root.append(ov);
}

// ================================================================== impostazioni

async function openSettings() {
  const st = voice.state;
  const keyBtn = h("button", { class: "btn btn-sm" }, keyName(st.pttKey));
  keyBtn.onclick = () => {
    keyBtn.textContent = "Premi un tasto…";
    const once = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code !== "Escape") setPttKey(e.code);
      keyBtn.textContent = keyName(voice.state.pttKey);
      window.removeEventListener("keydown", once, true);
    };
    window.addEventListener("keydown", once, true);
  };
  const devSel = (kind, label) => {
    const sel = h("select", { onchange: (e) => switchDevice(kind, e.target.value) }, h("option", {}, "Caricamento…"));
    listDevices(kind).then((list) => {
      const cur = loadPref(`dev:${kind}`, "default");
      sel.replaceChildren(...(list.length ? list : [{ deviceId: "", label: "Nessun dispositivo / permesso negato" }])
        .map((d, i) => h("option", { value: d.deviceId, selected: d.deviceId === cur }, d.label || `${label} ${i + 1}`)));
    });
    return h("label", {}, label, sel);
  };
  const nameIn = h("input", { value: store.me.display_name, maxlength: 40 });
  const charSel = h("select", {}, h("option", { value: "" }, "— nessuno —"));
  listMyCharacters().then((list) => charSel.append(...list.map((c) => h("option", { value: c.id, selected: c.id === store.me.character_id }, c.name)))).catch(() => {});
  const chk = (val, label, fn) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: val, onchange: (e) => fn(e.target.checked) }), " ", label);

  modal({
    title: "Impostazioni",
    wide: true,
    body: h("div", { class: "settings" },
      h("section", {},
        h("h3", { html: `${icon("radio")} Ricetrasmittente` }),
        h("label", {}, "Modalità microfono",
          h("select", { onchange: (e) => setMicMode(e.target.value) },
            [["open", "Microfono sempre aperto (comunicazione libera)"], ["ptt-hold", "Push-to-Talk: tieni premuto per parlare"], ["ptt-toggle", "Push-to-Talk: un clic per aprire, un clic per chiudere"]]
              .map(([v, l]) => h("option", { value: v, selected: st.micMode === v }, l)))),
        h("div", { class: "row-btns" }, h("span", {}, "Tasto PTT da tastiera: "), keyBtn),
        h("p", { class: "muted small" }, "Il tasto non funziona mentre scrivi nella chat, quindi non interferisce con la scrittura."),
        chk(st.sounds, "Segnali acustici di inizio/fine trasmissione", setSounds),
        chk(st.duck, "In canale privato abbassa il volume del canale generale", setDuck)),
      h("section", {},
        h("h3", { html: `${icon("mic")} Dispositivi` }),
        devSel("audioinput", "Microfono"),
        devSel("videoinput", "Videocamera"),
        supportsOutputSelection() ? devSel("audiooutput", "Uscita audio (casse / cuffie)") : h("p", { class: "muted small" }, "L'uscita audio (cuffie Bluetooth comprese) si sceglie dalle impostazioni del telefono."),
        chk(st.audioOnly, "Modalità solo audio (connessioni lente)", setAudioOnly)),
      h("section", {},
        h("h3", { html: `${icon("users")} Il tuo profilo in questa partita` }),
        h("label", {}, "Nome visualizzato", nameIn),
        h("label", {}, "Personaggio", charSel),
        h("button", {
          class: "btn btn-sm btn-primary",
          onclick: async () => {
            const cid = charSel.value || null;
            const cname = cid ? charSel.selectedOptions[0].textContent : "";
            await must(sb.from("members").update({ display_name: nameIn.value.trim() || store.me.display_name, character_id: cid, character_name: cname })
              .eq("game_id", store.game.id).eq("user_id", store.user.id));
            toast("Profilo aggiornato (il nome nell'audio si aggiorna al prossimo collegamento)", "ok");
          },
        }, "Salva profilo")),
      !isDM() ? h("section", { class: "danger-zone" },
        h("button", {
          class: "btn btn-danger btn-sm",
          onclick: async () => {
            if (!(await confirmDialog("Abbandonare definitivamente questa partita?", { danger: true, okLabel: "Abbandona" }))) return;
            await rpc("leave_game", { p_game: store.game.id });
            document.querySelector(".modal-wrap")?.remove();
            navigate("#/");
          },
        }, "Abbandona la partita")) : null),
    actions: [{ label: "Chiudi", primary: true }],
  });
}
