import { IEM_RECEIVE_LIMITS, stereoRelationship } from './protocol.js';

// Independent factual protocol implementation. No vendor assets/code, transport
// or production import. Provenance and qualification: docs/iem-aux-eq-contract.md.
export const AUX_EQ_DISPLAY_CENTRES = Object.freeze([20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]);
export const auxEqPosition = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const encoder = new TextEncoder();
const bounded = (text, max) => text.length <= max && encoder.encode(text).byteLength <= max;
export function eqDataFields(input, keys) {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error('Invalid EQ descriptor.');
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value'))) throw Error('Unexpected EQ fields.');
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
export function eqArray(input, length, maximum = length) {
  if (!Array.isArray(input) || input.length < length || input.length > maximum) throw Error('Invalid bounded EQ array.');
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(fields).length !== input.length + 1) throw Error('Unexpected EQ array fields.');
  return Array.from({ length: input.length }, (_, index) => {
    if (!Object.hasOwn(fields, index) || !Object.hasOwn(fields[index], 'value')) throw Error('Sparse or accessor EQ arrays are unavailable.');
    return fields[index].value;
  });
}
function targetDescriptor(input, band = false, withValue = false) {
  const result = eqDataFields(input, ['auxIndex', ...(band ? ['bandIndex'] : []), ...(withValue ? ['value'] : [])]);
  if (!Number.isInteger(result.auxIndex) || result.auxIndex < 0 || result.auxIndex > 9) throw Error('Invalid AUX EQ output.');
  if (band && (!Number.isInteger(result.bandIndex) || result.bandIndex < 0 || result.bandIndex > 30)) throw Error('Invalid AUX EQ band.');
  if (withValue && !auxEqPosition(result.value)) throw Error('EQ position must be finite from zero to one.');
  return Object.freeze(result);
}
export function auxEqPath(target) {
  const { auxIndex, bandIndex } = targetDescriptor(target, true);
  return `a.${auxIndex}.eq.peak.${bandIndex}`;
}
export function encodeAuxEqCommand(input) {
  const { value, ...target } = targetDescriptor(input, true, true);
  return `3:::SETD^${auxEqPath(target)}^${value}`;
}
export function auxEqPositionToDb(value) {
  if (!auxEqPosition(value)) throw Error('Invalid EQ position.');
  return 30 * value - 15;
}
export function auxEqDbToPosition(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -15 || value > 15) throw Error('Requested EQ gain exceeds the verified ±15 dB range.');
  return (value + 15) / 30;
}
// Kept separate from the production state parser until S04's reviewed owner.
// Only synthetic fixtures are bundled; no actual mixer state is persisted.
export function parseAuxEqStateFrame(frame) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || !bounded(frame, IEM_RECEIVE_LIMITS.frameBytes)) return [];
  const lines = frame.slice(4).split('\n');
  if (lines.length > IEM_RECEIVE_LIMITS.lines) return [];
  const updates = [];
  for (let line of lines) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!bounded(line, IEM_RECEIVE_LIMITS.lineBytes)) continue;
    const match = /^SETD\^(a\.([0-9])\.eq\.(?:peak\.(0|[1-2][0-9]|30|[1-9])|(bypass)))\^([^\^]*)$/.exec(line);
    if (!match) continue;
    const raw = match[5].trim();
    if (raw.length > 64 || !numeric.test(raw)) continue;
    const value = Number(raw);
    if (!auxEqPosition(value) || match[4] && value !== 0 && value !== 1) continue;
    updates.push(Object.freeze({ kind: 'auxEq', path: match[1], auxIndex: Number(match[2]), field: match[4] ? 'bypass' : 'band', ...(match[4] ? {} : { bandIndex: Number(match[3]) }), value: match[4] ? value === 1 : value }));
  }
  return updates;
}
export function resolveAuxEqTopology(received, request) {
  const target = targetDescriptor(request);
  if (!(received instanceof Map) || received.get('model') !== 'ui24') throw Error('Current Ui24 model is required.');
  const relationship = stereoRelationship(received, `a.${target.auxIndex}`);
  if (!['mono', 'linked'].includes(relationship.status)) throw Error('Received non-conflicting output link metadata is required.');
  const outputs = relationship.members.map(id => {
    if (received.get(`${id}.matrix`) !== false) throw Error('Every output requires received AUX mode.');
    const bypass = received.get(`${id}.eq.bypass`);
    if (typeof bypass !== 'boolean') throw Error('Received EQ bypass state is required.');
    return Object.freeze({ auxIndex: Number(id.slice(2)), bypass });
  });
  return Object.freeze({ target, outputs: Object.freeze(outputs) });
}
export function resolveAuxEqTargets(received, request, { allowUnequal = false } = {}) {
  const topology = resolveAuxEqTopology(received, request);
  const members = topology.outputs.flatMap(output => AUX_EQ_DISPLAY_CENTRES.map((_, bandIndex) => {
    const target = Object.freeze({ auxIndex: output.auxIndex, bandIndex }), path = auxEqPath(target), value = received.get(path);
    if (!received.has(path) || !auxEqPosition(value)) throw Error('Every EQ band requires actual current readback.');
    return Object.freeze({ target, path, value });
  }));
  if (!allowUnequal && topology.outputs.length === 2 && (topology.outputs[0].bypass !== topology.outputs[1].bypass || members.slice(31).some((member, index) => member.value !== members[index].value))) throw Error('Unequal linked EQ profiles remain unavailable; no equalization.');
  return Object.freeze({ ...topology, members: Object.freeze(members) });
}
