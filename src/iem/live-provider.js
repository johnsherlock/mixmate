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
function sendProcessing(state, prefix) {
  return { mute: state.get(`${prefix}.mute`), post: state.get(`${prefix}.post`), postproc: state.get(`${prefix}.postproc`),
    stateText: `Send mute: ${flagText(state, `${prefix}.mute`, 'Muted', 'Unmuted')} · ${flagText(state, `${prefix}.post`, 'Post-fader', 'Pre-fader')} · ${flagText(state, `${prefix}.postproc`, 'Post-processing', 'Pre-processing')}` };
}
function commonProcessing(sides) {
  const same = ['mute', 'post', 'postproc'].every(field => sides.every(side => typeof side[field] === 'boolean' && side[field] === sides[0][field]));
  return same ? sides[0].stateText : sides.map(side => `Output ${side.auxIndex + 1}: ${side.stateText}`).join(' · ');
}
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
const sideLevels = sides => sides.map(side => `Output ${side.auxIndex + 1}: ${side.levelText ?? 'not received'}`).join(' · ');
const sideActuals = sides => sides.map(side => `Output ${side.auxIndex + 1}: ${side.levelText ?? 'not received'}${typeof side.position === 'number' ? ` (raw ${side.position})` : ''}`).join(' · ');
const commonLevel = sides => sides.every(side => typeof side.position === 'number' && side.position === sides[0].position)
  ? sides[0].levelText : `${sides.every(side => typeof side.position === 'number') ? 'Unequal · ' : ''}${sideLevels(sides)}`;
function pairMeter(sides) {
  const meters = sides.map(side => side.meter);
  const fresh = meters.every(meter => meter.status === 'fresh' && meter.values.length === 1);
  return { ...meters[0], channelCount: 2, label: `Output ${sides.map(side => side.auxIndex + 1).join('/')} post-fader VU · individual sides`,
    status: fresh ? 'fresh' : meters.some(meter => meter.status === 'stale') ? 'stale' : 'missing',
    values: fresh ? meters.flatMap(meter => meter.values) : [] };
}
export function projectLiveState(session, selectedAux = null) {
  const state = session.observations, model = state.get('model');
  const result = { ...(session.control ? { control: session.control } : {}), status: session.detail, connectionPhase: session.phase, selectedAux: null, modelLabel: model === 'ui24' ? 'Ui24 model received' : 'Ui24 model not verified', mixes: [], sources: [], selectedMix: null };
  if (model !== 'ui24') return result;
  const indices = [...new Set([...state.keys()].map(path => /^a\.([0-9])\./.exec(path)?.[1]).filter(value => value !== undefined).map(Number))].sort((a, b) => a - b);
  const outputs = indices.map(index => {
    const id = `a.${index}`, mode = receivedAuxMode(state, index), aux = mode.received && mode.value === 'aux';
    const relationship = stereoRelationship(state, id);
    const linkedAux = aux && relationship.status === 'linked' && relationship.members.every(member => receivedAuxMode(state, Number(member.slice(2))).value === 'aux');
    return {
      id, auxIndex: index, browsable: aux, outputMembers: linkedAux ? relationship.members : [id], themeIndex: linkedAux ? Number(relationship.members[0].slice(2)) : index,
      name: observedName(state, `${id}.name`, `Output ${index + 1}`),
      detail: `${aux ? 'AUX' : mode.received ? 'MATRIX — outside IEM' : 'Output mode unknown'} ${index + 1} · ${relationshipText(state, id)}`,
      ...aux ? level(state.get(`${id}.mix`)) : {},
      panPosition: state.get(`${id}.pan`),
      panText: state.has(`${id}.pan`) ? `Pan ${state.get(`${id}.pan`).toFixed(3)} · normalized` : 'Pan not received',
      meter: projectMeter(session, id, false, aux),
      stateText: `Output mute: ${flagText(state, `${id}.mute`, 'Muted', 'Unmuted')}`,
    };
  });
  // Topology alone determines the logical identity. Names only supply display text.
  const byId = new Map(outputs.map(output => [output.id, output]));
  result.mixes = outputs.filter(output => output.outputMembers[0] === output.id).map(output => {
    const sides = output.outputMembers.map(id => byId.get(id));
    if (sides.length === 1) return { ...output, sides };
    const names = sides.map(side => side.name.trim());
    return { ...output, sides, name: [...new Set(names)].join(' '),
      detail: `AUX ${sides.map(side => side.auxIndex + 1).join(' / ')} · verified stereo pair · individual readbacks`,
      levelText: commonLevel(sides), actualLevelText: sideActuals(sides),
      stateText: sides.map(side => `Output ${side.auxIndex + 1}: ${side.stateText}`).join(' · '),
      panText: sides.every(side => side.panText === sides[0].panText) ? sides[0].panText : sides.map(side => `Output ${side.auxIndex + 1}: ${side.panText}`).join(' · '),
      meter: pairMeter(sides),
    };
  });
  const selected = result.mixes.find(mix => mix.outputMembers.includes(`a.${selectedAux}`) && mix.browsable);
  if (!selected) return result;
  selectedAux = selected.auxIndex;
  result.selectedAux = selectedAux; result.selectedMix = selected;
  const catalog = new Map(selected.outputMembers.flatMap(id => observedAuxSources(state, Number(id.slice(2)))).map(source => [source.sourceId, source]));
  const families = ['i', 'l', 'p', 'f'];
  result.sources = [...catalog.values()].sort((a, b) => families.indexOf(a.sourceId[0]) - families.indexOf(b.sourceId[0]) || a.sourceIndex - b.sourceIndex).map(source => {
    const prefix = `${source.sourceId}.aux.${selectedAux}`;
    const sides = selected.outputMembers.map(outputId => {
      const auxIndex = Number(outputId.slice(2)), path = `${source.sourceId}.aux.${auxIndex}`;
      return { auxIndex, ...level(state.get(`${path}.value`)), ...sendProcessing(state, path),
        panPosition: state.get(`${path}.pan`), panText: state.has(`${path}.pan`) ? `Pan ${state.get(`${path}.pan`).toFixed(3)} · normalized` : 'Pan not received' };
    });
    return {
      sides, levelPeerIds: stereoRelationship(state, source.sourceId).members || [source.sourceId],
      id: `${source.sourceId}@${selectedAux}`, sourceId: source.sourceId, auxIndex: selectedAux, themeIndex: result.selectedMix.themeIndex,
      name: observedName(state, `${source.sourceId}.name`, sourceLabel(source.sourceId)),
      detail: `${sourceLabel(source.sourceId)} · AUX ${selectedAux + 1} SEND · ${relationshipText(state, source.sourceId)}`,
      ...level(state.get(`${prefix}.value`)),
      panText: state.has(`${prefix}.pan`) ? `Pan ${state.get(`${prefix}.pan`).toFixed(3)} · normalized` : 'Pan not received',
      ...(sides.length === 2 ? { sides,
        levelText: commonLevel(sides), actualLevelText: sideActuals(sides),
        panText: sides.every(side => typeof side.panPosition === 'number' && side.panPosition === sides[0].panPosition) ? sides[0].panText : sides.map(side => `${side.auxIndex + 1}: ${side.panText}`).join(' · ') } : {}),
      meter: projectMeter(session, source.sourceId, true),
      stateText: sides.length === 2 ? commonProcessing(sides) : sides[0].stateText,
    };
  });
  return result;
}

// Editor catalog only: the union of sources whose sends were received on any
// currently browsable AUX output. It grants no control authority, and no name-
// only, meter-only or matrix/unknown-mode output contributes a source.
export function projectReceivedSourceCatalog(session) {
  const base = projectLiveState(session, null), catalog = new Map();
  for (const mix of base.mixes) {
    if (!mix.browsable) continue;
    for (const source of projectLiveState(session, mix.auxIndex).sources)
      if (!catalog.has(source.sourceId)) catalog.set(source.sourceId, { sourceId: source.sourceId, name: source.name });
  }
  const families = ['i', 'l', 'p', 'f'];
  return [...catalog.values()].sort((a, b) => families.indexOf(a.sourceId[0]) - families.indexOf(b.sourceId[0]) || Number(a.sourceId.slice(2)) - Number(b.sourceId.slice(2)));
}
