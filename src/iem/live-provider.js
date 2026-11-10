import { faderValueToDB, vuValueToDB } from 'soundcraft-ui-connection';
import { parseIemStateFrame, receivedAuxMode, receivedIemField, stereoRelationship, observedAuxSources } from './protocol.js';

// Definitions/profile bounds never manufacture received availability.
export function createEmptyLiveProvider() {
  const empty = () => ({ status: 'Not connected — no received mixer state', mixes: [] });
  return { snapshot: empty, clear: empty };
}
export function createLiveProvider() {
  let observations = new Map();
  return {
    receive(frame) {
      const updates = parseIemStateFrame(frame);
      for (const { path, value } of updates) observations.set(path, value);
      return updates.length;
    },
    clear() { observations = new Map(); },
    snapshot: () => new Map(observations),
    model: () => observations.get('model'),
    hasAuxLevel() {
      if (observations.get('model') !== 'ui24') return false;
      return [...observations.keys()].some(path => /^a\.[0-9]\.mix$/.test(path) && observations.get(path.slice(0, 4) + 'matrix') === false);
    },
  };
}
function level(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return {};
  const db = faderValueToDB(value);
  return { position: value, levelText: db === -Infinity ? '−∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB` };
}
const observedName = (state, path, label) => {
  const field = receivedIemField(state, path);
  return field.received ? field.value || `${label} — unnamed` : `${label} — name not received`;
};
export function sourceLabel(id) {
  const names = { a: 'Output', i: 'Input', l: 'Line', p: 'Player', f: 'FX return' };
  return `${names[id[0]]} ${Number(id.slice(2)) + 1}`;
}
function relationshipText(state, id) {
  const link = stereoRelationship(state, id);
  if (link.status === 'linked') {
    const partner = link.members.find(member => member !== id);
    if (id.startsWith('a.')) {
      const mode = receivedAuxMode(state, Number(partner.slice(2)));
      if (!mode.received) return `Linked metadata with ${sourceLabel(partner)}; partner mode unknown`;
      if (mode.value !== 'aux') return `Link/mode conflict with ${sourceLabel(partner)}`;
    }
    return `Linked with ${sourceLabel(partner)}; individual readback`;
  }
  return { mono: 'Received mono', unknown: 'Stereo-link state unknown', conflict: 'Stereo-link metadata conflict', 'intrinsic-stereo': 'Stereo FX source · library profile' }[link.status] || 'Stereo unavailable';
}
const flagText = (state, path, yes, no) => state.has(path) ? (state.get(path) ? yes : no) : 'Unknown';
function projectMeter(session, id, source = false, allowed = true) {
  const label = source ? 'Source post-fader VU · NOT AUX send' : 'Output post-fader VU';
  const channelCount = id.startsWith('f.') ? 2 : 1;
  const observed = allowed ? session.meters?.get(id) : undefined;
  const status = observed ? session.meterState || 'missing' : 'missing';
  const fields = channelCount === 2 ? ['vuPostFaderL', 'vuPostFaderR'] : ['vuPostFader'];
  const values = status === 'fresh' ? fields.map(field => observed[field]) : [];
  const valid = values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return {
    status: valid ? status : 'missing', label, channelCount, revision: session.meterRevision ?? 0,
    provenance: '7.1.0 library scale; firmware unverified',
    values: valid ? values.map(value => ({ position: Math.min(value, 1), db: vuValueToDB(value), floor: value === 0 })) : [],
  };
}
export function projectLiveState(session, selectedAux = null) {
  const state = session.observations, model = state.get('model');
  const result = { ...(session.control ? { control: session.control } : {}), status: session.detail, connectionPhase: session.phase, selectedAux: null, modelLabel: model === 'ui24' ? 'Ui24 model received' : 'Ui24 model not verified', mixes: [], sources: [], selectedMix: null };
  if (model !== 'ui24') return result;
  const indices = [...new Set([...state.keys()].map(path => /^a\.([0-9])\./.exec(path)?.[1]).filter(value => value !== undefined).map(Number))].sort((a, b) => a - b);
  result.mixes = indices.map(index => {
    const id = `a.${index}`, mode = receivedAuxMode(state, index), aux = mode.received && mode.value === 'aux';
    const relationship = stereoRelationship(state, id);
    const linkedAux = aux && relationship.status === 'linked' && relationship.members.every(member => receivedAuxMode(state, Number(member.slice(2))).value === 'aux');
    return {
      id, auxIndex: index, browsable: aux, themeIndex: linkedAux ? Number(relationship.members[0].slice(2)) : index,
      name: observedName(state, `${id}.name`, `Output ${index + 1}`),
      detail: `${aux ? 'AUX' : mode.received ? 'MATRIX — outside IEM' : 'Output mode unknown'} ${index + 1} · ${relationshipText(state, id)}`,
      ...aux ? level(state.get(`${id}.mix`)) : {},
      panText: state.has(`${id}.pan`) ? `Pan ${state.get(`${id}.pan`).toFixed(3)} · normalized` : 'Pan not received',
      meter: projectMeter(session, id, false, aux),
      stateText: `Output mute: ${flagText(state, `${id}.mute`, 'Muted', 'Unmuted')}`,
    };
  });
  const selected = result.mixes.find(mix => mix.auxIndex === selectedAux && mix.browsable);
  if (!selected) return result;
  result.selectedAux = selectedAux; result.selectedMix = selected;
  result.sources = observedAuxSources(state, selectedAux).map(source => {
    const prefix = `${source.sourceId}.aux.${selectedAux}`;
    return {
      id: `${source.sourceId}@${selectedAux}`, sourceId: source.sourceId, auxIndex: selectedAux, themeIndex: result.selectedMix.themeIndex,
      name: observedName(state, `${source.sourceId}.name`, sourceLabel(source.sourceId)),
      detail: `${sourceLabel(source.sourceId)} · AUX ${selectedAux + 1} SEND · ${relationshipText(state, source.sourceId)}`,
      ...level(state.get(`${prefix}.value`)),
      panText: state.has(`${prefix}.pan`) ? `Pan ${state.get(`${prefix}.pan`).toFixed(3)} · normalized` : 'Pan not received',
      meter: projectMeter(session, source.sourceId, true),
      stateText: `Send mute: ${flagText(state, `${prefix}.mute`, 'Muted', 'Unmuted')} · ${flagText(state, `${prefix}.post`, 'Post-fader', 'Pre-fader')} · ${flagText(state, `${prefix}.postproc`, 'Post-processing', 'Pre-processing')}`,
    };
  });
  return result;
}
