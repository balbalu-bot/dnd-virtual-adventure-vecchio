// Stato condiviso dell'app + semplice sistema di eventi

export const store = {
  user: null,            // utente Supabase (anche anonimo)
  game: null,            // riga "games" della partita aperta
  me: null,              // mia riga "members"
  members: new Map(),    // user_id -> riga members
  characters: new Map(), // character_id -> personaggio (ritratti)
  channels: new Map(),   // voice_channels attivi a cui partecipo
};

const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(name, handler);
  return () => bus.removeEventListener(name, handler);
}

export function memberName(id) {
  const m = store.members.get(id);
  return m ? m.display_name : "Sconosciuto";
}

export function isDM() {
  return !!(store.game && store.user && store.game.dm_id === store.user.id);
}
