import { resolveAuxLevelTargets, resolveAuxLevelTopology } from './aux-level-protocol.js';

// Amplitude profile derived from soundcraft-ui-connection 7.1.0 (MIT),
// Copyright 2020 Ferdinand Malcher. Full notice is bundled at
// public/third-party/soundcraft-ui-connection-LICENSE.txt.
// Provenance and finite capability policy: docs/iem-relative-groups.md.
const amplitude = position => (position < 0.055 ? Math.sin(28.559933214452666 * position) : 1) *
  Math.exp((23.90844819639692 + (-26.23877598214595 + (12.195249692570245 - 0.4878099877028098 * position) * position) * position) * position) * 0.0002676529517952372;
export const GROUP_MIN_DB = -199;
export const GROUP_MAX_DB = 20 * Math.log10(amplitude(1));
export const GROUP_DELTA_WINDOW = 12;
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
