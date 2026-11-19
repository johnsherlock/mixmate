import { resolveAuxLevelTargets, resolveAuxLevelTopology } from './aux-level-protocol.js';

// Amplitude profile derived from soundcraft-ui-connection 7.1.0 (MIT),
// Copyright 2020 Ferdinand Malcher. Full notice is bundled at
// public/third-party/soundcraft-ui-connection-LICENSE.txt.
// Provenance and finite capability policy: docs/iem-relative-groups.md.
const amplitude = position => (position < 0.055 ? Math.sin(28.559933214452666 * position) : 1) *
  Math.exp((23.90844819639692 + (-26.23877598214595 + (12.195249692570245 - 0.4878099877028098 * position) * position) * position) * position) * 0.0002676529517952372;
export const GROUP_MIN_DB = -199;
export const GROUP_MAX_DB = 20 * Math.log10(amplitude(1));
// F09-S05 full-range group travel (docs/iem-relative-groups.md). Downward travel
// stops when the QUIETEST member reaches this finite floor (fader position about
// 0.00125, visually the bottom). It sits far inside the finite anchor window, so
// a desk-rounded echo still re-anchors the next gesture; a group never writes
// position 0 / -inf. Upward travel stops when the LOUDEST member reaches 1.
export const GROUP_FLOOR_DB = -100;
export function continuousFaderDB(position) {
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) throw Error('Invalid received fader position.');
  const value = amplitude(position);
  return value < 1e-10 ? -Infinity : 20 * Math.log10(value);
}
export function continuousDBToFader(db) {
  if (typeof db !== 'number' || !Number.isFinite(db) || db < GROUP_MIN_DB || db > GROUP_MAX_DB) throw Error('Outside finite group capability window.');
  if (db === GROUP_MAX_DB) return 1;
  const target = 10 ** (db / 20);
  let low = 0, high = 1;
  for (let n = 0; n < 72; n++) {
    const middle = (low + high) / 2;
    if (amplitude(middle) < target) low = middle; else high = middle;
  }
  return high;
}
function definition(group) {
  if (!group || typeof group.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(group.id) ||
      !Array.isArray(group.members) || group.members.length === 0 || group.members.length > 128 || new Set(group.members).size !== group.members.length) throw Error('A nonempty current local group is required.');
  return { id: group.id, members: [...group.members] };
}
export function resolveGroupTopology(received, group, auxIndex) {
  const saved = definition(group), targets = new Map();
  for (const sourceId of saved.members) {
    const closure = resolveAuxLevelTopology(received, { kind: 'send', auxIndex, sourceId });
    for (const member of closure.members) targets.set(member.path, member);
  }
  return Object.freeze({ groupId: saved.id, membership: Object.freeze(saved.members), members: Object.freeze([...targets.values()]) });
}
export function resolveRelativeGroup(received, group, auxIndex) {
  const saved = definition(group), targets = new Map();
  for (const sourceId of saved.members) {
    // Strict per-source equal-link closure remains mandatory; unrelated members
    // can have different levels and retain those differences after one delta.
    const closure = resolveAuxLevelTargets(received, { kind: 'send', auxIndex, sourceId });
    for (const member of closure.members) {
      const db = continuousFaderDB(member.value);
      if (!Number.isFinite(db) || db < GROUP_MIN_DB || db > GROUP_MAX_DB) throw Error('Group members require finite non-silent levels within the supported window.');
      targets.set(member.path, Object.freeze({ ...member, db }));
    }
  }
  return Object.freeze({ groupId: saved.id, membership: Object.freeze(saved.members), members: Object.freeze([...targets.values()]) });
}
export function relativeGroupChange(baseline, requestedDelta) {
  if (typeof requestedDelta !== 'number' || !Number.isFinite(requestedDelta) || !baseline?.members?.length) throw Error('Finite relative delta and baseline required.');
  const lower = Math.max(...baseline.members.map(member => GROUP_MIN_DB - member.db));
  const upper = Math.min(...baseline.members.map(member => GROUP_MAX_DB - member.db));
  let delta = Math.max(lower, Math.min(upper, requestedDelta));
  // At most floating-point addition error at a shared endpoint: move the ONE
  // common delta inward, never clamp or round independent members.
  if (delta > 0 && baseline.members.some(member => member.db + delta > GROUP_MAX_DB)) delta = Math.max(0, delta - 1e-12);
  if (delta < 0 && baseline.members.some(member => member.db + delta < GROUP_MIN_DB)) delta = Math.min(0, delta + 1e-12);
  if (Math.abs(delta) < 1e-12) delta = 0; // Shared numerical no-op, not member rounding.
  const commands = baseline.members.map(member => Object.freeze({ ...member.target, value: delta === 0 ? member.value : continuousDBToFader(member.db + delta) }));
  return Object.freeze({ delta: delta === 0 ? 0 : delta, limited: delta !== requestedDelta, commands: Object.freeze(commands) });
}

// One common dB delta range for a fresh immutable anchor: the reference is the
// loudest member; lower is 0 when the quietest is already below the floor.
export function groupTravel(baseline) {
  const members = baseline?.members;
  if (!Array.isArray(members) || !members.length || members.some(member => typeof member.db !== 'number' || !Number.isFinite(member.db))) throw Error('Finite group anchor required.');
  const dbs = members.map(member => member.db);
  return Object.freeze({
    referenceDb: Math.max(...dbs),
    lower: Math.min(0, Math.max(...dbs.map(db => GROUP_FLOOR_DB - db))),
    upper: Math.max(0, Math.min(...dbs.map(db => GROUP_MAX_DB - db))),
  });
}
// The group cap is the loudest member's fader position moved along the normal
// fader law: requested delta = dB(position) - dB(reference anchor), clamped to
// the whole-group travel (top: loudest at 1; bottom: quietest at the floor).
export function groupReferenceDelta(baseline, position) {
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) throw Error('Group reference position must be finite from zero to one.');
  const { referenceDb, lower, upper } = groupTravel(baseline);
  if (position === 1) return upper;
  return Math.max(lower, Math.min(upper, continuousFaderDB(position) - referenceDb));
}
export function groupReferencePosition(baseline, delta) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) throw Error('Finite group delta required.');
  const { referenceDb } = groupTravel(baseline);
  return continuousDBToFader(Math.max(GROUP_MIN_DB, Math.min(GROUP_MAX_DB, referenceDb + delta)));
}
