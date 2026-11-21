// =====================================================================
//  Voce, ricetrasmittente (PTT), canali privati e videocamere — LiveKit
//
//  Come funziona la privacy dei canali privati:
//  ogni partecipante pubblica UNA traccia microfono nella stanza della
//  partita. Quando entri in un canale privato, chiedi al server LiveKit
//  di inoltrare il tuo microfono SOLO ai membri di quel canale
//  (setTrackSubscriptionPermissions). Il server smette di inviare il tuo
//  audio a tutti gli altri: non lo ricevono proprio. La videocamera resta
//  visibile a tutti, il microfono no.
// =====================================================================
import {
  Room, RoomEvent, Track, ConnectionState, VideoPresets, createLocalAudioTrack, DisconnectReason,
} from "../vendor/livekit-client.js";
import { callFunction } from "./supabase.js";
import { store, emit } from "./store.js";
import { loadPref, savePref, beep, toast } from "./ui.js";
import { computeTrackPermissions } from "./voice-permissions.js";

const DUCK_LEVEL = 0.3;

export const voice = {
  room: null,
  gameId: null,
  state: {
    status: "idle",          // idle | connecting | connected | reconnecting | error
    error: "",
    micReady: false,         // traccia microfono pubblicata
    transmitting: false,     // sto trasmettendo la voce
    micMode: loadPref("micMode", "ptt-hold"), // open | ptt-hold | ptt-toggle
    activeChannelId: null,   // null = canale generale
    camOn: false,
    audioOnly: loadPref("audioOnly", false),
    videosHidden: loadPref("videosHidden", false),
    duck: loadPref("duck", true),
    sounds: loadPref("sounds", true),
    pttKey: loadPref("pttKey", "Space"),
    needsAudioUnlock: false,
  },
  speaking: new Set(),
  volumes: {},               // identity -> 0..1.5
  mutedLocal: new Set(),     // partecipanti che IO ho silenziato
  _wantTx: false,
  _switching: false,
  _manualDisconnect: false,
  _retry: 0,
};

function setState(patch) {
  Object.assign(voice.state, patch);
  emit("voice:state", voice.state);
}

function activeChannelMembers() {
  const id = voice.state.activeChannelId;
  if (!id) return null;
  const ch = store.channels.get(id);
  return ch && ch.active ? ch.members : null;
}

// ------------------------------------------------------------------ connessione

export async function connectVoice(gameId, { mic = true, cam = false } = {}) {
  voice.gameId = gameId;
  voice._manualDisconnect = false;
  voice.volumes = loadPref(`vol:${gameId}`, {});
  voice.mutedLocal = new Set(loadPref(`muted:${gameId}`, []));
  setState({ status: "connecting", error: "", activeChannelId: null });

  let tok;
  try {
    tok = await callFunction("livekit-token", { game_id: gameId });
  } catch (e) {
    setState({ status: "error", error: e.message });
    return false;
  }

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: true, // permette il volume per persona anche su iPhone
    disconnectOnPageLeave: true,
    audioCaptureDefaults: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      deviceId: loadPref("dev:audioinput", undefined),
    },
    videoCaptureDefaults: {
      resolution: VideoPresets.h360.resolution,
      deviceId: loadPref("dev:videoinput", undefined),
      facingMode: "user",
    },
    publishDefaults: {
      videoSimulcastLayers: [VideoPresets.h180],
      dtx: true,
      red: true,
    },
  });
  voice.room = room;
  wireRoom(room);

  try {
    await room.connect(tok.url, tok.token, { autoSubscribe: false });
  } catch (e) {
    voice.room = null;
    setState({ status: "error", error: "Connessione audio/video non riuscita: " + e.message });
    return false;
  }
  voice._retry = 0;
  setState({ status: "connected", needsAudioUnlock: !room.canPlaybackAudio });
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) decideSubscription(pub, p);
  }
  applyPermissions();
  emit("voice:participants");

  const out = loadPref("dev:audiooutput", null);
  if (out) room.switchActiveDevice("audiooutput", out).catch(() => {});

  if (mic) await prepareMic();
  if (cam && !voice.state.audioOnly) await setCamera(true);
  return true;
}

export async function disconnectVoice() {
  voice._manualDisconnect = true;
  voice._wantTx = false;
  const r = voice.room;
  voice.room = null;
  if (r) await r.disconnect().catch(() => {});
  voice.speaking.clear();
  setState({ status: "idle", micReady: false, transmitting: false, camOn: false, activeChannelId: null });
  emit("voice:participants");
}

function wireRoom(room) {
  room
    .on(RoomEvent.ParticipantConnected, () => { applyPermissions(); emit("voice:participants"); })
    .on(RoomEvent.ParticipantDisconnected, (p) => { voice.speaking.delete(p.identity); emit("voice:participants"); })
    .on(RoomEvent.TrackPublished, (pub, p) => decideSubscription(pub, p))
    .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.dataset.identity = p.identity;
        document.getElementById("audio-sink").append(el);
        applyVolume(p);
      }
      emit("voice:track", { identity: p.identity });
    })
    .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
      track.detach().forEach((el) => el.remove());
      emit("voice:track", { identity: p.identity });
    })
    .on(RoomEvent.TrackMuted, (pub, p) => emit("voice:track", { identity: p.identity }))
    .on(RoomEvent.TrackUnmuted, (pub, p) => emit("voice:track", { identity: p.identity }))
    .on(RoomEvent.LocalTrackPublished, () => { applyPermissions(); emit("voice:track", { identity: store.user.id }); })
    .on(RoomEvent.LocalTrackUnpublished, () => { applyPermissions(); emit("voice:track", { identity: store.user.id }); })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      voice.speaking = new Set(speakers.filter((s) => {
        if (s.isLocal) return voice.state.transmitting;
        const pub = s.getTrackPublication(Track.Source.Microphone);
        return pub?.isSubscribed && !pub.isMuted; // mostro solo chi sento davvero
      }).map((s) => s.identity));
      emit("voice:speaking", voice.speaking);
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => setState({ needsAudioUnlock: !room.canPlaybackAudio }))
    .on(RoomEvent.Reconnecting, () => setState({ status: "reconnecting" }))
    .on(RoomEvent.SignalReconnecting, () => setState({ status: "reconnecting" }))
    .on(RoomEvent.Reconnected, () => { setState({ status: "connected" }); applyPermissions(); })
    .on(RoomEvent.MediaDevicesError, (e) => toast(deviceErrorText(e), "error", { timeout: 8000 }))
    .on(RoomEvent.Disconnected, (reason) => {
      if (voice.room !== room) return;
      voice.room = null;
      voice.speaking.clear();
      setState({ status: "idle", micReady: false, transmitting: false, camOn: false });
      emit("voice:participants");
      if (voice._manualDisconnect) return;
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        setState({ status: "error", error: "Il DM ti ha scollegato dall'audio/video." });
        return;
      }
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        setState({ status: "error", error: "Sei collegato da un'altra finestra o dispositivo con lo stesso profilo." });
        return;
      }
      // riconnessione automatica con nuovo token
      const delay = Math.min(15000, 2000 * 2 ** voice._retry++);
      setState({ status: "reconnecting" });
      setTimeout(() => { if (!voice.room && voice.gameId && !voice._manualDisconnect) connectVoice(voice.gameId, { mic: true, cam: false }); }, delay);
    });
}

function deviceErrorText(e) {
  const n = e?.name || "";
  if (n === "NotAllowedError") return "Permesso negato per microfono/videocamera. Abilitalo dalle impostazioni del browser (icona del lucchetto accanto all'indirizzo).";
  if (n === "NotFoundError") return "Nessun microfono o videocamera trovati.";
  if (n === "NotReadableError") return "Il dispositivo è già usato da un'altra applicazione.";
  return "Errore dispositivo: " + (e?.message || n);
}

// ------------------------------------------------------------------ ricezione

function decideSubscription(pub, participant) {
  if (!pub || pub.kind === undefined) return;
  if (pub.kind === Track.Kind.Audio) {
    pub.setSubscribed(!voice.mutedLocal.has(participant.identity));
  } else if (pub.kind === Track.Kind.Video) {
    pub.setSubscribed(!(voice.state.audioOnly || voice.state.videosHidden));
  }
}

function refreshAllSubscriptions() {
  if (!voice.room) return;
  for (const p of voice.room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) decideSubscription(pub, p);
  }
}

function applyVolume(p) {
  const base = voice.volumes[p.identity] ?? 1;
  const members = activeChannelMembers();
  const duck = voice.state.duck && members && !members.includes(p.identity) ? DUCK_LEVEL : 1;
  try { p.setVolume(Math.max(0, Math.min(1.5, base * duck)), Track.Source.Microphone); } catch { /* traccia non pronta */ }
}

function applyAllVolumes() {
  if (!voice.room) return;
  for (const p of voice.room.remoteParticipants.values()) applyVolume(p);
}

export function setParticipantVolume(identity, v) {
  voice.volumes[identity] = v;
  savePref(`vol:${voice.gameId}`, voice.volumes);
  const p = voice.room?.remoteParticipants.get(identity);
  if (p) applyVolume(p);
}

export function setParticipantMutedLocal(identity, muted) {
  if (muted) voice.mutedLocal.add(identity); else voice.mutedLocal.delete(identity);
  savePref(`muted:${voice.gameId}`, [...voice.mutedLocal]);
  const p = voice.room?.remoteParticipants.get(identity);
  if (p) for (const pub of p.trackPublications.values()) decideSubscription(pub, p);
  emit("voice:participants");
}

export async function unlockAudio() {
  try { await voice.room?.startAudio(); } catch { /* serve un tocco dell'utente */ }
  setState({ needsAudioUnlock: !(voice.room?.canPlaybackAudio ?? true) });
}

// ------------------------------------------------------------------ permessi (privacy reale)

export function applyPermissions() {
  const room = voice.room;
  if (!room || !store.user) return;
  const lp = room.localParticipant;
  const camSid = lp.getTrackPublication(Track.Source.Camera)?.trackSid;
  const perms = computeTrackPermissions({
    channelMembers: activeChannelMembers(),
    selfId: store.user.id,
    remoteIdentities: [...room.remoteParticipants.values()].map((p) => p.identity),
    cameraSid: camSid,
  });
  lp.setTrackSubscriptionPermissions(perms.allowAll, perms.list);
}

// ------------------------------------------------------------------ microfono e PTT

async function prepareMic() {
  const room = voice.room;
  if (!room || voice.state.micReady) return true;
  try {
    const existing = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!existing) {
      const track = await createLocalAudioTrack({
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        deviceId: loadPref("dev:audioinput", undefined),
      });
      await track.mute(); // si pubblica "muto": nessuno sente nulla finché non trasmetti
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true });
    }
    setState({ micReady: true });
    if (voice.state.micMode === "open") await setTransmit(true);
    return true;
  } catch (e) {
    toast(deviceErrorText(e), "error", { timeout: 9000 });
    setState({ micReady: false });
    return false;
  }
}

async function setTransmit(on) {
  const room = voice.room;
  if (!room) return;
  if (on && !voice.state.micReady) { const ok = await prepareMic(); if (!ok) return; }
  voice._wantTx = on;
  if (voice._switching) return; // verrà riattivato a fine cambio canale
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  if (!pub?.track) return;
  if (on && pub.isMuted) await pub.unmute();
  if (!on && !pub.isMuted) await pub.mute();
  if (voice.state.transmitting !== on) {
    if (voice.state.sounds && voice.state.micMode !== "open") beep(on ? "tx-on" : "tx-off");
    setState({ transmitting: on });
  }
}

export function pttDown() {
  if (voice.state.micMode === "ptt-hold") setTransmit(true);
  else if (voice.state.micMode === "ptt-toggle") setTransmit(!voice.state.transmitting);
  else setTransmit(!voice.state.transmitting);
}
export function pttUp() {
  if (voice.state.micMode === "ptt-hold") setTransmit(false);
}
export function toggleMic() { setTransmit(!voice.state.transmitting); }

export function setMicMode(mode) {
  savePref("micMode", mode);
  setState({ micMode: mode });
  setTransmit(mode === "open");
}

export function setPttKey(code) { savePref("pttKey", code); setState({ pttKey: code }); }
export function setSounds(v) { savePref("sounds", v); setState({ sounds: v }); }
export function setDuck(v) { savePref("duck", v); setState({ duck: v }); applyAllVolumes(); }

// ------------------------------------------------------------------ canali privati

/** Cambia il canale su cui trasmetto. null = canale generale. */
export async function switchChannel(channelId) {
  if (channelId && !store.channels.get(channelId)?.active) channelId = null;
  if (voice.state.activeChannelId === channelId) return;
  const wasTx = voice.state.transmitting || voice._wantTx;
  voice._switching = true;
  // 1) chiudo il microfono, 2) cambio i permessi sul server, 3) attendo, 4) riapro
  const pub = voice.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  if (pub && !pub.isMuted) await pub.mute();
  setState({ activeChannelId: channelId, transmitting: false });
  applyPermissions();
  applyAllVolumes();
  if (voice.state.sounds) beep(channelId ? "private" : "tx-off");
  await new Promise((r) => setTimeout(r, 400));
  voice._switching = false;
  if (wasTx && (voice.state.micMode === "open" || voice.state.micMode === "ptt-toggle")) await setTransmit(true);
  else voice._wantTx = false;
  emit("voice:participants");
}

/** Chiamato quando cambia l'elenco dei canali (dal database in tempo reale) */
export function channelsUpdated() {
  const id = voice.state.activeChannelId;
  if (id && !store.channels.get(id)?.active) {
    switchChannel(null);
    toast("Il canale privato è stato chiuso: sei tornato al canale generale.", "info");
    return;
  }
  applyPermissions();
  applyAllVolumes();
}

// ------------------------------------------------------------------ videocamera

export async function setCamera(on) {
  const room = voice.room;
  if (!room) return;
  try {
    await room.localParticipant.setCameraEnabled(on, {
      resolution: VideoPresets.h360.resolution,
      deviceId: loadPref("dev:videoinput", undefined),
      facingMode: "user",
    });
    setState({ camOn: on });
  } catch (e) {
    toast(deviceErrorText(e), "error", { timeout: 8000 });
    setState({ camOn: false });
  }
  applyPermissions();
}

export async function setAudioOnly(v) {
  savePref("audioOnly", v);
  setState({ audioOnly: v });
  if (v && voice.state.camOn) await setCamera(false);
  refreshAllSubscriptions();
  emit("voice:participants");
}

export function setVideosHidden(v) {
  savePref("videosHidden", v);
  setState({ videosHidden: v });
  refreshAllSubscriptions();
}

// ------------------------------------------------------------------ dispositivi

export async function listDevices(kind) {
  try { return await Room.getLocalDevices(kind, true); } catch { return []; }
}

export async function switchDevice(kind, deviceId) {
  savePref(`dev:${kind}`, deviceId);
  if (!voice.room) return;
  try { await voice.room.switchActiveDevice(kind, deviceId); }
  catch (e) { toast("Impossibile cambiare dispositivo: " + e.message, "error"); }
}

export function supportsOutputSelection() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

// ------------------------------------------------------------------ info per l'interfaccia

export function participantInfo(identity) {
  const room = voice.room;
  if (!room) return null;
  const isLocal = identity === room.localParticipant.identity;
  const p = isLocal ? room.localParticipant : room.remoteParticipants.get(identity);
  if (!p) return null;
  const cam = p.getTrackPublication(Track.Source.Camera);
  const mic = p.getTrackPublication(Track.Source.Microphone);
  return {
    online: true,
    isLocal,
    participant: p,
    videoTrack: cam && !cam.isMuted && (isLocal || cam.isSubscribed) ? cam.track : null,
    micMuted: !mic || mic.isMuted,
    hearable: isLocal ? false : !!(mic && mic.isSubscribed),
    quality: p.connectionQuality,
  };
}

export function isOnline(identity) {
  const room = voice.room;
  if (!room) return false;
  return identity === room.localParticipant.identity || room.remoteParticipants.has(identity);
}

export { ConnectionState };
