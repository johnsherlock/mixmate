import { stereoRelationship, UI24_SOURCE_FAMILIES, UI24_AUX_COUNT } from './protocol.js';

// No arbitrary path/raw-message argument; these encoders grant no socket capability.
const normalized = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const auxIndex = value => Number.isInteger(value) && value >= 0 && value < UI24_AUX_COUNT;
function descriptor(target, withValue = false) {
  if (!target || ![Object.prototype, null].includes(Object.getPrototypeOf(target))) throw Error('Invalid AUX level descriptor.');
  const keys = ['kind', 'auxIndex', ...(target.kind === 'send' ? ['sourceId'] : []), ...(withValue ? ['value'] : [])];
  if (Reflect.ownKeys(target).length !== keys.length || keys.some(key => !Object.hasOwn(target, key))) throw Error('Unexpected AUX level fields.');
  if (!['master', 'send'].includes(target.kind) || !auxIndex(target.auxIndex)) throw Error('Invalid AUX level target.');
  if (target.kind === 'send') {
    if (typeof target.sourceId !== 'string') throw Error('Invalid AUX source.');
    const match = /^([ilpf])\.(0|[1-9][0-9]?)$/.exec(target.sourceId);
    if (!match || Number(match[2]) >= UI24_SOURCE_FAMILIES[match[1]].count) throw Error('Invalid AUX source.');
  }
  if (withValue && !normalized(target.value)) throw Error('AUX level must be a finite number from zero to one.');
  return Object.freeze({ kind: target.kind, auxIndex: target.auxIndex, ...(target.kind === 'send' ? { sourceId: target.sourceId } : {}), ...(withValue ? { value: target.value === 0 ? 0 : target.value } : {}) });
}
export function auxLevelPath(target) {
  const value = descriptor(target);
  return value.kind === 'master' ? `a.${value.auxIndex}.mix` : `${value.sourceId}.aux.${value.auxIndex}.value`;
}
export function encodeAuxLevelCommand(command) {
  const { value, ...target } = descriptor(command, true);
  return `3:::SETD^${auxLevelPath(target)}^${value}`;
}
function linkedMembers(received, id) {
  if (id[0] !== 'f' && ![-1, 0, 1].includes(received.get(`${id}.stereoIndex`))) throw Error('Current stereo metadata is unavailable.');
  const relationship = stereoRelationship(received, id);
  if (!['mono', 'linked', 'intrinsic-stereo'].includes(relationship.status)) throw Error('Current stereo metadata is incomplete or conflicting.');
  return relationship.members;
}
export function resolveAuxLevelTopology(received, request) {
  const target = descriptor(request);
  if (!(received instanceof Map) || received.get('model') !== 'ui24') throw Error('Current Ui24 model is required.');
  const outputs = linkedMembers(received, `a.${target.auxIndex}`);
  for (const output of outputs) if (received.get(`${output}.matrix`) !== false) throw Error('Every output must have received AUX mode.');
  const sources = target.kind === 'send' ? linkedMembers(received, target.sourceId) : [null];
  const members = new Map();
  for (const sourceId of sources) for (const output of outputs) {
    const item = Object.freeze({ kind: target.kind, auxIndex: Number(output.slice(2)), ...(sourceId ? { sourceId } : {}) });
    const path = auxLevelPath(item);
    members.set(path, Object.freeze({ target: item, path }));
  }
  return Object.freeze({ target, members: Object.freeze([...members.values()]) });
}
export function resolveAuxLevelTargets(received, request) {
  const topology = resolveAuxLevelTopology(received, request);
  const result = topology.members.map(item => {
    const value = received.get(item.path);
    if (!received.has(item.path) || !normalized(value)) throw Error('Every target requires a received AUX level.');
    return Object.freeze({ ...item, value });
  });
  if (result.some(item => item.value !== result[0].value)) throw Error('Unequal linked levels are read-only; no equalization is allowed.');
  return Object.freeze({ target: topology.target, members: Object.freeze(result) });
}
