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
// F06-S05 (user request 2026-11-21): the AUX output's high-pass / low-pass
// filter positions. Exact forms 3:::SETD^a.<0..9>.eq.hpf^<0..1> and .eq.lpf;
// off = hpf exactly 0 / lpf exactly 1 (native display "OFF"). No slope, bypass or
// main-mix (m.*) filter forms. Provenance: docs/iem-aux-eq-contract.md.
export const AUX_EQ_FILTERS = Object.freeze(['hpf', 'lpf']);
function filterDescriptor(input, withValue = false) {
  const result = eqDataFields(input, ['auxIndex', 'filter', ...(withValue ? ['value'] : [])]);
  if (!Number.isInteger(result.auxIndex) || result.auxIndex < 0 || result.auxIndex > 9) throw Error('Invalid AUX EQ output.');
  if (!AUX_EQ_FILTERS.includes(result.filter)) throw Error('Invalid AUX EQ filter.');
  if (withValue && !auxEqPosition(result.value)) throw Error('EQ filter position must be finite from zero to one.');
  return Object.freeze(result);
}
export function auxEqFilterPath(target) {
  const { auxIndex, filter } = filterDescriptor(target);
  return `a.${auxIndex}.eq.${filter}`;
}
export function encodeAuxEqFilterCommand(input) {
  const { value, ...target } = filterDescriptor(input, true);
  return `3:::SETD^${auxEqFilterPath(target)}^${value}`;
}
export function auxEqPositionToDb(value) {
  if (!auxEqPosition(value)) throw Error('Invalid EQ position.');
  return 30 * value - 15;
}
export function auxEqDbToPosition(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -15 || value > 15) throw Error('Requested EQ gain exceeds the verified ±15 dB range.');
  return (value + 15) / 30;
}
// Separate bounded receive parser, used only by the private F06-S04 control
// session owner beside the main state parser. No mixer state is persisted.
export function parseAuxEqStateFrame(frame) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || !bounded(frame, IEM_RECEIVE_LIMITS.frameBytes)) return [];
  const lines = frame.slice(4).split('\n');
  if (lines.length > IEM_RECEIVE_LIMITS.lines) return [];
  const updates = [];
  for (let line of lines) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!bounded(line, IEM_RECEIVE_LIMITS.lineBytes)) continue;
    const match = /^SETD\^(a\.([0-9])\.eq\.(?:peak\.(0|[1-2][0-9]|30|[1-9])|(bypass)|(hpf|lpf)))\^([^\^]*)$/.exec(line);
    if (!match) continue;
    const raw = match[6].trim();
    if (raw.length > 64 || !numeric.test(raw)) continue;
    const value = Number(raw);
    if (!auxEqPosition(value) || match[4] && value !== 0 && value !== 1) continue;
    const field = match[4] ? 'bypass' : match[5] ? 'filter' : 'band';
    updates.push(Object.freeze({ kind: 'auxEq', path: match[1], auxIndex: Number(match[2]), field, ...(field === 'band' ? { bandIndex: Number(match[3]) } : {}), ...(field === 'filter' ? { filter: match[5] } : {}), value: field === 'bypass' ? value === 1 : value }));
  }
  return updates;
}
// Conservative receive-only change detector for selected-output processing that
// MixMate does not model (dynamics, presets, AFS, filter slopes and unknown
// fields; since F06-S05 the hpf/lpf positions are modelled and parsed above).
// Values stay opaque bounded text: no semantics, ranges or write forms are
// inferred. An overlong value is reported as raw null, meaning "always changed".
const KNOWN_OUTPUT_FIELD = /^(?:name|mix|pan|mute|stereoIndex|matrix|eq\.bypass|eq\.hpf|eq\.lpf|eq\.peak\.(?:0|[1-2][0-9]|30|[1-9]))$/;
export function parseAuxProcessingFrame(frame) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || !bounded(frame, IEM_RECEIVE_LIMITS.frameBytes)) return [];
  const lines = frame.slice(4).split('\n');
  if (lines.length > IEM_RECEIVE_LIMITS.lines) return [];
  const updates = [];
  for (let line of lines) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!bounded(line, IEM_RECEIVE_LIMITS.lineBytes)) continue;
    const match = /^SET[DS]\^(a\.([0-9])\.([A-Za-z0-9_.]{1,48}))\^(.*)$/.exec(line);
    if (!match || KNOWN_OUTPUT_FIELD.test(match[3])) continue;
    updates.push(Object.freeze({ path: match[1], auxIndex: Number(match[2]), raw: bounded(match[4], 128) ? match[4] : null }));
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

// Filter members of the selected output closure (F06-S05): hpf then lpf per
// output. `ok` only when every path has actual current readback and, for a
// verified reciprocal pair, both sides hold exactly equal raw values. Otherwise
// the filters stay read-only (`missing` / `unequal`) and join no write scope.
export function resolveAuxEqFilters(received, topology) {
  const members = [];
  // hpf of every side, then lpf of every side (a pair's two sides stay adjacent).
  for (const filter of AUX_EQ_FILTERS) for (const output of topology.outputs) {
    const target = Object.freeze({ auxIndex: output.auxIndex, filter }), path = auxEqFilterPath(target), value = received.get(path);
    if (!received.has(path) || !auxEqPosition(value)) return Object.freeze({ status: 'missing', members: Object.freeze([]) });
    members.push(Object.freeze({ target, path, value }));
  }
  if (topology.outputs.length === 2 && AUX_EQ_FILTERS.some((_, index) => members[2 * index].value !== members[2 * index + 1].value)) return Object.freeze({ status: 'unequal', members: Object.freeze([]) });
  return Object.freeze({ status: 'ok', members: Object.freeze(members) });
}
