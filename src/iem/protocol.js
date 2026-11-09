// Receive-only Ui24R schema. Evidence/limits: docs/iem-protocol-contract.md.
// This module has no transport, sender, state persistence or implicit defaults.
export const IEM_RECEIVE_LIMITS = Object.freeze({
  frameBytes: 2 * 1024 * 1024,
  lines: 32768,
  lineBytes: 4096,
  nameBytes: 1024,
  metadataBytes: 128,
});
export const UI24_SOURCE_FAMILIES = Object.freeze({
  i: Object.freeze({ type: 'input', count: 24, stereo: 'received-link' }),
  l: Object.freeze({ type: 'line', count: 2, stereo: 'received-link' }),
  p: Object.freeze({ type: 'player', count: 2, stereo: 'received-link' }),
  f: Object.freeze({ type: 'fx', count: 4, stereo: 'intrinsic-stereo' }),
});
export const UI24_AUX_COUNT = 10;
const encoder = new TextEncoder();
const sizeWithin = (text, maximum) => text.length <= maximum && encoder.encode(text).byteLength <= maximum;
const AUX_FIELDS = Object.freeze({ name: 'name', mix: 'level', pan: 'pan', mute: 'mute', stereoIndex: 'stereoIndex', matrix: 'matrix' });
const SEND_FIELDS = Object.freeze({ value: 'level', pan: 'pan', mute: 'mute', post: 'post', postproc: 'postproc' });
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function sourceDescriptor(family, rawIndex) {
  const profile = UI24_SOURCE_FAMILIES[family];
  const sourceIndex = Number(rawIndex);
  if (!profile || sourceIndex >= profile.count) return null;
  return { sourceId: `${family}.${sourceIndex}`, sourceType: profile.type, sourceIndex };
}
function describePath(path) {
  if (path === 'model' || path === 'firmware') return { kind: 'device', field: path, path };
  const aux = /^a\.([0-9])\.(name|mix|pan|mute|stereoIndex|matrix)$/.exec(path);
  if (aux) return { kind: 'aux', auxIndex: Number(aux[1]), field: AUX_FIELDS[aux[2]], path };
  const source = /^([ilpf])\.(0|[1-9][0-9]?)\.(name|stereoIndex)$/.exec(path);
  if (source) {
    const descriptor = sourceDescriptor(source[1], source[2]);
    // FX returns are individual stereo sources, not adjacent-link channels.
    if (!descriptor || (source[1] === 'f' && source[3] === 'stereoIndex')) return null;
    return { kind: 'source', ...descriptor, field: source[3], path };
  }
  const send = /^([ilpf])\.(0|[1-9][0-9]?)\.aux\.([0-9])\.(value|pan|mute|post|postproc)$/.exec(path);
  if (!send) return null;
  const descriptor = sourceDescriptor(send[1], send[2]);
  return descriptor ? { kind: 'send', ...descriptor, auxIndex: Number(send[3]), field: SEND_FIELDS[send[4]], path } : null;
}
function decodeValue(command, raw, field) {
  if (field === 'name' || field === 'firmware' || field === 'model') {
    if (command !== 'SETS' || !sizeWithin(raw, field === 'name' ? IEM_RECEIVE_LIMITS.nameBytes : IEM_RECEIVE_LIMITS.metadataBytes)) return undefined;
    if (field === 'model' && !['ui12', 'ui16', 'ui24'].includes(raw)) return undefined;
    return raw;
  }
  if (command !== 'SETD') return undefined;
  const numberText = raw.trim();
  if (numberText.length > 64 || !NUMERIC.test(numberText)) return undefined;
  const value = Number(numberText);
  if (!Number.isFinite(value)) return undefined;
  if (field === 'stereoIndex') return [-1, 0, 1].includes(value) ? value : undefined;
  if (['mute', 'matrix', 'post', 'postproc'].includes(field)) return value === 0 ? false : value === 1 ? true : undefined;
  return value >= 0 && value <= 1 ? value : undefined;
}

// Returned entries are received observations only. Missing paths produce no update;
// false, zero and empty names remain distinct from absence. Preserve order, including
// repeated paths: the later session store owns last-observation semantics.
export function parseIemStateFrame(frame) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || !sizeWithin(frame, IEM_RECEIVE_LIMITS.frameBytes)) return [];
  const lines = frame.slice(4).split('\n');
  if (lines.length > IEM_RECEIVE_LIMITS.lines) return [];
  const updates = [];
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!sizeWithin(line, IEM_RECEIVE_LIMITS.lineBytes)) continue;
    const first = line.indexOf('^');
    const second = line.indexOf('^', first + 1);
    if (first !== 4 || second < 0) continue;
    const command = line.slice(0, first);
    if (command !== 'SETD' && command !== 'SETS') continue;
    const descriptor = describePath(line.slice(first + 1, second));
    if (!descriptor) continue;
    const value = decodeValue(command, line.slice(second + 1), descriptor.field);
    if (value !== undefined) updates.push({ ...descriptor, value });
  }
  return updates;
}

// These pure selectors accept a Map built only from this parser's observations
// for ONE current socket. Clearing/replacing that Map on disconnect belongs to
// F03-S03's session store; these helpers do not merge sessions or retain state.
export function receivedIemField(received, path) {
  return describePath(path) && received.has(path) ? { received: true, value: received.get(path) } : { received: false };
}
export function receivedAuxMode(received, auxIndex) {
  if (!Number.isInteger(auxIndex) || auxIndex < 0 || auxIndex >= UI24_AUX_COUNT) return { received: false };
  const observed = receivedIemField(received, `a.${auxIndex}.matrix`);
  return observed.received ? { received: true, value: observed.value ? 'matrix' : 'aux' } : observed;
}
export function stereoRelationship(received, id) {
  const match = /^([ailpf])\.(0|[1-9][0-9]?)$/.exec(id);
  if (!match) return { status: 'unsupported' };
  const [, family, rawIndex] = match;
  const index = Number(rawIndex);
  const maximum = family === 'a' ? UI24_AUX_COUNT : UI24_SOURCE_FAMILIES[family].count;
  if (index >= maximum) return { status: 'unsupported' };
  if (family === 'f') return { status: 'intrinsic-stereo', members: [id], evidence: 'ui24-library-profile' };
  const ownState = receivedIemField(received, `${id}.stereoIndex`);
  if (!ownState.received) return { status: 'unknown' };
  if (ownState.value === -1) {
    // Keep a received mono value visible, but flag a known neighbour that still
    // claims this member. Do not present inconsistent halves as safe mono.
    if ((index > 0 && received.get(`${family}.${index - 1}.stereoIndex`) === 0) ||
        (index + 1 < maximum && received.get(`${family}.${index + 1}.stereoIndex`) === 1)) return { status: 'conflict' };
    return { status: 'mono', members: [id] };
  }
  const partnerIndex = index + (ownState.value === 0 ? 1 : -1);
  if (partnerIndex < 0 || partnerIndex >= maximum) return { status: 'conflict' };
  const partner = `${family}.${partnerIndex}`;
  const other = receivedIemField(received, `${partner}.stereoIndex`);
  if (!other.received) return { status: 'unknown' };
  if (other.value !== 1 - ownState.value) return { status: 'conflict' };
  const left = ownState.value === 0 ? index : partnerIndex;
  const right = left + 1;
  if ((left > 0 && received.get(`${family}.${left - 1}.stereoIndex`) === 0) ||
      (right + 1 < maximum && received.get(`${family}.${right + 1}.stereoIndex`) === 1)) return { status: 'conflict' };
  return { status: 'linked', members: [`${family}.${left}`, `${family}.${right}`] };
}

// Observation discovery, not a routing/capability guarantee. Metadata-only sources
// are not invented as available sends; a partially observed send can lack its level.
// A matrix/unknown-mode slot must not be presented as a verified AUX by its caller.
export function observedAuxSources(received, auxIndex) {
  if (!Number.isInteger(auxIndex) || auxIndex < 0 || auxIndex >= UI24_AUX_COUNT) return [];
  const sources = new Map();
  for (const path of received.keys()) {
    const descriptor = describePath(path);
    if (descriptor?.kind !== 'send' || descriptor.auxIndex !== auxIndex) continue;
    if (!sources.has(descriptor.sourceId)) sources.set(descriptor.sourceId, { sourceId: descriptor.sourceId, sourceType: descriptor.sourceType, sourceIndex: descriptor.sourceIndex, observedFields: [] });
    const fields = sources.get(descriptor.sourceId).observedFields;
    if (!fields.includes(descriptor.field)) fields.push(descriptor.field);
  }
  const order = Object.keys(UI24_SOURCE_FAMILIES);
  return [...sources.values()].sort((a, b) => order.indexOf(a.sourceId[0]) - order.indexOf(b.sourceId[0]) || a.sourceIndex - b.sourceIndex);
}
