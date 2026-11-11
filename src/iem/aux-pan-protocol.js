import { stereoRelationship, UI24_AUX_COUNT, UI24_SOURCE_FAMILIES } from './protocol.js';

// AUX send pan only. No raw path, input/master pan or stereo-balance fallback.
// Evidence and parked semantics: docs/iem-aux-pan-safety.md.
const position = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function descriptor(input, withValue = false) {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error('Invalid AUX pan descriptor.');
  const keys = ['sourceId', 'auxIndex', ...(withValue ? ['value'] : [])];
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value'))) throw Error('Unexpected AUX pan fields.');
  const sourceId = fields.sourceId.value, auxIndex = fields.auxIndex.value, value = withValue ? fields.value.value : undefined;
  if (typeof sourceId !== 'string') throw Error('A mono input, line or player source is required.');
  const match = /^([ilp])\.(0|[1-9][0-9]?)$/.exec(sourceId);
  if (!match || Number(match[2]) >= UI24_SOURCE_FAMILIES[match[1]].count) throw Error('Unsupported AUX pan source.');
  if (!Number.isInteger(auxIndex) || auxIndex < 0 || auxIndex >= UI24_AUX_COUNT) throw Error('Invalid AUX pan output.');
  if (withValue && !position(value)) throw Error('Pan position must be a finite number from zero to one.');
  return Object.freeze({ sourceId, auxIndex, ...(withValue ? { value: normalizeAuxPanPosition(value) } : {}) });
}
export function normalizeAuxPanPosition(value) {
  if (!position(value)) throw Error('Pan position must be a finite number from zero to one.');
  // Match the pinned setter's three-decimal W() normalization, not a DSP pan law.
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}
export function auxPanPath(target) {
  const value = descriptor(target);
  return `${value.sourceId}.aux.${value.auxIndex}.pan`;
}
export function encodeAuxPanCommand(command) {
  const { value, ...target } = descriptor(command, true);
  return `3:::SETD^${auxPanPath(target)}^${value}`;
}
export function resolveAuxPanTopology(received, request) {
  const target = descriptor(request);
  if (!(received instanceof Map) || received.get('model') !== 'ui24') throw Error('Current Ui24 model is required.');
  if (received.get(`${target.sourceId}.stereoIndex`) !== -1 || stereoRelationship(received, target.sourceId).status !== 'mono') throw Error('Only verified mono sources support normalized pan; stereo balance is unverified.');
  const output = `a.${target.auxIndex}`;
  if (![0, 1].includes(received.get(`${output}.stereoIndex`))) throw Error('Pan requires a verified stereo AUX pair.');
  const relationship = stereoRelationship(received, output);
  if (relationship.status !== 'linked') throw Error('Pan requires reciprocal non-conflicting stereo AUX metadata.');
  const members = relationship.members.map(id => {
    if (received.get(`${id}.matrix`) !== false) throw Error('Both linked outputs require received AUX mode.');
    const memberTarget = Object.freeze({ sourceId: target.sourceId, auxIndex: Number(id.slice(2)) });
    return Object.freeze({ target: memberTarget, path: auxPanPath(memberTarget) });
  });
  return Object.freeze({ target, members: Object.freeze(members) });
}
export function resolveAuxPanTargets(received, request) {
  const topology = resolveAuxPanTopology(received, request);
  const members = topology.members.map(member => {
    const value = received.get(member.path);
    if (!received.has(member.path) || !position(value)) throw Error('Both outputs require actual received send pan positions.');
    return Object.freeze({ ...member, value });
  });
  if (members.some(member => member.value !== members[0].value)) throw Error('Unequal linked pan readbacks remain unavailable; no equalization.');
  return Object.freeze({ target: topology.target, members: Object.freeze(members) });
}
