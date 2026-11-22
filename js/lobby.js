// Schermata iniziale: profilo, personaggio, crea / entra / riprendi partita
import { sb, rpc, must, appUrl } from "./supabase.js";
import { store } from "./store.js";
import { h, icon, toast, modal, loadPref, savePref, formatCode, fmtTime, avatar, copyText } from "./ui.js";
import { listMyCharacters, editCharacter, characterSummary } from "./characters.js";
import { navigate } from "./main.js";

let chars = [];

export function inviteLink(code) {
  return `${appUrl()}#/join/${code}`;
}

export function openInviteModal(game) {
  const link = inviteLink(game.invite_code);
  const text = `🎲 Ti invito alla mia partita di D&D «${game.name}»!\nCodice: ${formatCode(game.invite_code)}\nEntra da qui: ${link}`;
  modal({
    title: "Invita i tuoi amici",
    body: h("div", { class: "invite" },
      h("p", {}, "Condividi il codice o il collegamento. Funziona da PC, tablet e smartphone, senza installare nulla."),
      h("div", { class: "invite-code", title: "Codice di invito" }, formatCode(game.invite_code)),
      h("div", { class: "invite-link" }, h("input", { value: link, readonly: true, onclick: (e) => e.target.select() })),
      h("div", { class: "invite-actions" },
        h("a", { class: "btn btn-whatsapp", href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener", html: `${icon("phone")} WhatsApp` }),
        h("button", { class: "btn", html: `${icon("copy")} Copia link`, onclick: () => copyText(link) }),
        navigator.share ? h("button", {
          class: "btn", html: `${icon("share")} Condividi…`,
          onclick: () => navigator.share({ title: "D&D Virtual Adventure", text, url: link }).catch(() => {}),
        }) : null),
      h("p", { class: "muted small" }, "Manda il codice SOLO agli amici che giocano. Chi lo usa può solo chiedere di entrare: decidi tu. Se il codice finisce in giro, rigeneralo da Strumenti DM → Sala.")),
    actions: [{ label: "Fatto", primary: true }],
  });
}

function profileName() { return loadPref("name", ""); }

async function refreshChars() {
  try { chars = await listMyCharacters(); } catch (e) { chars = []; toast(e.message, "error"); }
  const sel = loadPref("characterId", null);
  if (sel && !chars.find((c) => c.id === sel)) savePref("characterId", null);
}

function selectedCharacter() {
  const id = loadPref("characterId", null);
  return chars.find((c) => c.id === id) || null;
}

function requireName(nameInput) {
  const n = nameInput.value.trim();
  if (!n) { toast("Scrivi prima il tuo nome", "error"); nameInput.focus(); return null; }
  savePref("name", n);
  return n;
}

export async function renderLobby(app, { joinCode } = {}) {
  await refreshChars();
  const root = h("div", { class: "lobby" });
  app.replaceChildren(root);

  const nameInput = h("input", {
    maxlength: 40, value: profileName(), placeholder: "Come ti chiamano al tavolo?", autocomplete: "nickname",
    oninput: () => savePref("name", nameInput.value.trim()),
  });

  const charBox = h("div", { class: "char-box" });
  function renderCharBox() {
    const c = selectedCharacter();
    charBox.replaceChildren(
      c ? h("div", { class: "char-card" }, avatar(c.name, c.portrait, "avatar-lg"),
        h("div", {}, h("strong", {}, c.name), h("div", { class: "muted small" }, characterSummary(c) || "—")),
        h("button", { class: "btn btn-sm btn-ghost", onclick: async () => { const r = await editCharacter(c); if (r) { await refreshChars(); renderCharBox(); } } }, "Modifica"))
        : h("div", { class: "char-card empty" }, h("span", { class: "muted" }, "Nessun personaggio selezionato (puoi sceglierlo anche dopo).")),
      h("div", { class: "char-actions" },
        chars.length ? h("select", {
          onchange: (e) => { savePref("characterId", e.target.value || null); renderCharBox(); },
        }, h("option", { value: "" }, "— Scegli un personaggio —"),
        chars.map((x) => h("option", { value: x.id, selected: x.id === c?.id }, `${x.name}${x.class ? " (" + x.class + ")" : ""}`))) : null,
        h("button", {
          class: "btn btn-sm", html: `${icon("plus")} Nuovo personaggio`,
          onclick: async () => {
            const r = await editCharacter();
            if (r && r.id) { savePref("characterId", r.id); await refreshChars(); renderCharBox(); }
          },
        })));
  }
  renderCharBox();

  const gamesBox = h("div", { class: "games-list" }, h("p", { class: "muted" }, "Caricamento…"));

  root.append(
    h("header", { class: "lobby-hero" },
      h("div", { class: "lobby-tools" },
        h("button", { class: "btn btn-sm", html: `${icon("help")} Guida`, onclick: () => import("./guide.js").then((m) => m.openGuide()) }),
        h("button", { class: "btn btn-sm", html: `${icon("sliders")} Opzioni`, onclick: () => import("./options.js").then((m) => m.openOptions()) })),
      h("div", { class: "crest" }),
      h("h1", { class: "title-font" }, "D&D Virtual Adventure"),
      h("p", { class: "tagline" }, "Il vostro tavolo da gioco, ovunque voi siate.")),
    h("div", { class: "lobby-grid" },
      h("section", { class: "parchment card" },
        h("h2", {}, "Il tuo profilo"),
        h("label", {}, "Il tuo nome", nameInput),
        h("div", { class: "label" }, "Personaggio"), charBox,
        accountBox()),
      h("section", { class: "parchment card card-actions" },
        h("h2", {}, "Al tavolo!"),
        h("button", {
          class: "btn btn-primary btn-big", html: `${icon("crown")} Crea una nuova partita <small>come Dungeon Master</small>`,
          onclick: () => { const n = requireName(nameInput); if (n) openCreate(n); },
        }),
        h("button", {
          class: "btn btn-big", html: `${icon("key")} Entra con un codice <small>come giocatore</small>`,
          onclick: () => { const n = requireName(nameInput); if (n) openJoin(n, ""); },
        }),
        installButton(),
        h("p", { class: "safety-note" }, "👨‍👩‍👧 Gioco pensato per un gruppo privato di amici. Se a giocare sono ragazzi minorenni, va usato con la presenza di un adulto. Non condividete il codice fuori dal gruppo e non scrivete in chat dati personali (indirizzo, telefono, scuola).")),
      h("section", { class: "parchment card card-wide" },
        h("h2", {}, "Le tue partite"), gamesBox,
        h("div", { class: "row-btns", style: { marginTop: ".8em" } },
          h("button", { class: "btn btn-sm btn-ghost", html: `${icon("download")} Importa una campagna (file JSON)`, onclick: () => importDialog(nameInput) })))),
    h("footer", { class: "lobby-foot" },
      h("p", {}, "Progetto amatoriale non ufficiale, non affiliato a Wizards of the Coast. ",
        "Le regole di gioco provengono dal System Reference Document 5.1 (CC BY 4.0)."),
      h("p", {}, "Funziona da browser su PC, tablet, Android e iPhone. Serve il permesso per il microfono; la videocamera è facoltativa e resta spenta finché non la accendi. Audio e video non vengono mai registrati.")));

  loadMyGames(gamesBox);

  if (joinCode) {
    const n = nameInput.value.trim();
    openJoin(n, joinCode);
    history.replaceState(null, "", appUrl() + "#/");
  }
}

function installButton() {
  const btn = h("button", { class: "btn btn-ghost", hidden: !window.__installPrompt, html: `${icon("download")} Installa come app` });
  btn.onclick = async () => {
    const p = window.__installPrompt; if (!p) return;
    p.prompt(); await p.userChoice.catch(() => {}); window.__installPrompt = null; btn.hidden = true;
  };
  document.addEventListener("pwa-installable", () => { btn.hidden = false; }, { once: true });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;
  return h("div", {}, btn, ios ? h("p", { class: "muted small" },
    "Su iPhone: tocca Condividi → \"Aggiungi alla schermata Home\". Così l'app tiene a lungo i tuoi dati di accesso.") : null);
}

function accountBox() {
  const u = store.user;
  const box = h("div", { class: "account-box" });
  if (u?.is_anonymous) {
    box.append(
      h("p", { class: "small" }, h("strong", {}, "Accesso ospite"), " su questo dispositivo. Per ritrovare le tue partite anche da altri dispositivi, o se cancelli i dati del browser, collega un'email."),
      h("div", { class: "row-btns" },
        h("button", { class: "btn btn-sm", html: `${icon("mail")} Proteggi con email`, onclick: linkEmail }),
        h("button", { class: "btn btn-sm btn-ghost", onclick: loginEmail }, "Ho già un account")));
  } else if (u) {
    box.append(h("p", { class: "small" }, "Account collegato: ", h("strong", {}, u.email || "—")),
      h("button", {
        class: "btn btn-sm btn-ghost",
        onclick: async () => { await sb.auth.signOut(); },
      }, "Esci da questo dispositivo"));
  }
  return box;
}

function linkEmail() {
  const email = h("input", { type: "email", placeholder: "nome@esempio.it", autocomplete: "email" });
  modal({
    title: "Proteggi il tuo accesso",
    body: h("div", {}, h("p", {}, "Ti invieremo un'email di conferma. Dopo averla confermata potrai entrare con lo stesso profilo da qualunque dispositivo."), h("label", {}, "Email", email)),
    actions: [{ label: "Annulla" }, {
      label: "Invia conferma", primary: true,
      onClick: async () => {
        const { error } = await sb.auth.updateUser({ email: email.value.trim() }, { emailRedirectTo: appUrl() });
        if (error) throw new Error(error.message);
        toast("Controlla la posta e apri il collegamento di conferma.", "ok", { timeout: 8000 });
      },
    }],
  });
}

function loginEmail() {
  const email = h("input", { type: "email", placeholder: "nome@esempio.it", autocomplete: "email" });
  modal({
    title: "Accedi con la tua email",
    body: h("div", {}, h("p", {}, "Riceverai un collegamento di accesso. Aprilo su questo dispositivo."), h("label", {}, "Email", email)),
    actions: [{ label: "Annulla" }, {
      label: "Inviami il collegamento", primary: true,
      onClick: async () => {
        const { error } = await sb.auth.signInWithOtp({ email: email.value.trim(), options: { shouldCreateUser: false, emailRedirectTo: appUrl() } });
        if (error) throw new Error(error.message);
        toast("Email inviata: apri il collegamento da questo dispositivo.", "ok", { timeout: 8000 });
      },
    }],
  });
}

async function loadMyGames(box) {
  try {
    const rows = await must(sb.from("members")
      .select("game_id,role,status,character_name,last_seen,games(id,name,invite_code,updated_at,paused)")
      .eq("user_id", store.user.id)
      .order("last_seen", { ascending: false }));
    const list = rows.filter((r) => r.status !== "banned");
    if (!list.length) {
      box.replaceChildren(h("p", { class: "muted" }, "Non hai ancora partite. Creane una o entra con il codice di un amico."));
      return;
    }
    box.replaceChildren(...list.map((r) => {
      const g = r.games;
      const pending = r.status === "pending";
      return h("div", { class: "game-row" },
        h("div", { class: "game-row-main" },
          h("strong", {}, g?.name || "Partita in attesa di approvazione"),
          h("div", { class: "muted small" },
            r.role === "dm" ? "Dungeon Master" : "Giocatore",
            r.character_name ? ` · ${r.character_name}` : "",
            ` · ultimo accesso ${fmtTime(r.last_seen)}`,
            g?.paused ? " · in pausa" : "")),
        h("button", {
          class: `btn ${pending ? "" : "btn-primary"}`,
          onclick: () => pending ? waitApproval(r.game_id, "") : navigate(`#/game/${r.game_id}`),
        }, pending ? "In attesa…" : "Riprendi"));
    }));
  } catch (e) {
    box.replaceChildren(h("p", { class: "error" }, e.message));
  }
}

function importDialog(nameInput) {
  if (!nameInput.value.trim()) { toast("Scrivi prima il tuo nome", "error"); nameInput.focus(); return; }
  savePref("name", nameInput.value.trim());
  const file = h("input", { type: "file", accept: "application/json,.json" });
  const chars = h("input", { type: "checkbox", checked: true });
  const prog = h("p", { class: "muted small" });
  modal({
    title: "Importa una campagna",
    body: h("div", {}, h("p", {}, "Scegli un file esportato da «Strumenti DM → Campagna». Verrà creata una nuova partita di cui sarai il Dungeon Master."),
      file, h("label", { class: "check" }, chars, " Importa anche le schede dei personaggi (come tue copie)"), prog),
    actions: [{ label: "Annulla" }, {
      label: "Importa", primary: true, close: false,
      onClick: async (close) => {
        if (!file.files[0]) { toast("Scegli il file", "error"); return false; }
        const { importCampaign } = await import("./campaign-io.js");
        const id = await importCampaign(file.files[0], { includeCharacters: chars.checked, onProgress: (t) => { prog.textContent = t; } });
        close(); navigate(`#/game/${id}`);
      },
    }],
  });
}

function openCreate(name) {
  const gname = h("input", { maxlength: 80, placeholder: "es. La Miniera Perduta" });
  const maxP = h("select", {}, [2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => h("option", { value: n, selected: n === 8 }, `${n} partecipanti (DM incluso)`)));
  modal({
    title: "Nuova partita",
    body: h("div", {},
      h("label", {}, "Nome della partita / campagna", gname),
      h("label", {}, "Numero massimo di partecipanti", maxP),
      h("p", { class: "small" }, "🔐 Partita privata: chi usa il codice entra solo dopo la tua approvazione. Quando il gruppo è completo chiudi la stanza da Strumenti DM → Sala."),
      h("p", { class: "muted small" }, "Sarai il Dungeon Master: avrai il controllo della partita. Potrai trasferire il ruolo a un altro partecipante.")),
    actions: [{ label: "Annulla" }, {
      label: "Crea partita", primary: true,
      onClick: async () => {
        if (!gname.value.trim()) { toast("Dai un nome alla partita", "error"); return false; }
        const res = await rpc("create_game", {
          p_name: gname.value.trim(), p_display_name: name,
          p_character_id: loadPref("characterId", null), p_max_players: parseInt(maxP.value, 10),
          p_require_approval: true,
        });
        openInviteModal({ name: res.name, invite_code: res.invite_code });
        navigate(`#/game/${res.game_id}`);
      },
    }],
  });
}

function openJoin(name, code) {
  const codeIn = h("input", { value: formatCode((code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")), placeholder: "ABCD-EF23", maxlength: 12, class: "code-input", autocapitalize: "characters", autocomplete: "off" });
  const nameIn = h("input", { value: name || loadPref("name", ""), maxlength: 40, placeholder: "Il tuo nome" });
  modal({
    title: "Entra in una partita",
    body: h("div", {},
      h("label", {}, "Codice di invito", codeIn),
      h("label", {}, "Il tuo nome", nameIn),
      h("p", { class: "muted small" }, "Il personaggio selezionato nel profilo verrà portato al tavolo.")),
    actions: [{ label: "Annulla" }, {
      label: "Entra", primary: true,
      onClick: async () => {
        const n = nameIn.value.trim();
        if (!n) { toast("Scrivi il tuo nome", "error"); return false; }
        savePref("name", n);
        const res = await rpc("join_game", { p_code: codeIn.value, p_display_name: n, p_character_id: loadPref("characterId", null) });
        if (res.status === "pending") waitApproval(res.game_id, res.name);
        else navigate(`#/game/${res.game_id}`);
      },
    }],
  });
}

function waitApproval(gameId, gameName) {
  let ch;
  const check = async () => {
    const { data } = await sb.from("members").select("status").eq("game_id", gameId).eq("user_id", store.user.id).maybeSingle();
    if (data?.status === "active") { m.close(); navigate(`#/game/${gameId}`); }
    if (data?.status === "banned" || !data) { m.close(); toast("Il DM non ha accettato la richiesta.", "error"); }
  };
  const m = modal({
    title: "Sala d'attesa",
    body: h("div", { class: "center" },
      h("div", { class: "spinner" }),
      h("p", {}, `Hai chiesto di entrare${gameName ? " in «" + gameName + "»" : ""}.`),
      h("p", { class: "muted" }, "Il Dungeon Master deve approvare il tuo ingresso. Questa finestra si aggiornerà da sola.")),
    actions: [{ label: "Chiudi" }],
    onClose: () => { if (ch) sb.removeChannel(ch); clearInterval(timer); },
  });
  ch = sb.channel(`wait-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "members", filter: `user_id=eq.${store.user.id}` }, check)
    .subscribe();
  const timer = setInterval(check, 15000);
}
