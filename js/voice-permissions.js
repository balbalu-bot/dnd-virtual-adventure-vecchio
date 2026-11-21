// Calcolo dei permessi di ascolto delle MIE tracce audio/video.
// Questi permessi vengono applicati dal server LiveKit (SFU): chi non è
// autorizzato non riceve proprio i pacchetti audio, non è un semplice "volume a zero".

/**
 * @param {object} p
 * @param {string[]|null} p.channelMembers  membri del canale privato attivo (null = canale generale)
 * @param {string} p.selfId                  la mia identità
 * @param {string[]} p.remoteIdentities      partecipanti collegati in questo momento
 * @param {string|undefined} p.cameraSid     id della mia traccia video (se pubblicata)
 * @returns {{allowAll: boolean, list: Array<{participantIdentity: string, allowAll: boolean, allowedTrackSids?: string[]}>}}
 */
export function computeTrackPermissions({ channelMembers, selfId, remoteIdentities, cameraSid }) {
  if (!channelMembers) return { allowAll: true, list: [] };
  const allowed = new Set(channelMembers.filter((id) => id && id !== selfId));
  const seen = new Set();
  const list = [];
  for (const id of remoteIdentities) {
    if (id === selfId || seen.has(id)) continue;
    seen.add(id);
    if (allowed.has(id)) list.push({ participantIdentity: id, allowAll: true });
    // Gli esclusi continuano a vedere SOLO la mia videocamera, mai il microfono
    else list.push({ participantIdentity: id, allowAll: false, allowedTrackSids: cameraSid ? [cameraSid] : [] });
  }
  for (const id of allowed) {
    if (!seen.has(id)) list.push({ participantIdentity: id, allowAll: true });
  }
  return { allowAll: false, list };
}
