import { resolveAuxLevelTargets, resolveAuxLevelTopology } from './aux-level-protocol.js';
import { FADER_SCALE_MIN, FADER_SCALE_TOP_DB, positionToScale, scaleToPosition } from './fader-scale.js';

// The desk fader law lives in fader-law.js (provenance there); re-exported for
// existing callers.
export { GROUP_MIN_DB, GROUP_MAX_DB, continuousFaderDB, continuousDBToFader } from './fader-law.js';
// Full-range group travel (F09-S05). User decision 2026-11-20 (F09-S08,
// docs/iem-relative-groups.md) supersedes the F09-S06/S07 dB floor: a group
// applies ONE common delta in display-scale units (src/iem/fader-scale.js).
// Above -70 dB a scale unit is a dB (equal dB = equal distance); in the short
// bottom segment members keep moving equal on-screen distance. Upward travel
// stops when the LOUDEST member reaches the top (scale +10, desk position 1);
// downward travel stops when the QUIETEST member reaches the bottom (scale -75,
// desk position 0, -inf). A member already at position 0 is a valid finite
// anchor (scale -75): the group can move up, but allows no further downward
// travel.
export const GROUP_TOP_SCALE = FADER_SCALE_TOP_DB;
export const GROUP_FLOOR_SCALE = FADER_SCALE_MIN;
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
      // Fresh finite received position (0 included): its scale value anchors
      // the common delta. resolveAuxLevelTargets already requires strict 0..1.
      const scale = positionToScale(member.value);
      if (!Number.isFinite(scale)) throw Error('Group members require finite received levels.');
      targets.set(member.path, Object.freeze({ ...member, scale }));
    }
  }
  return Object.freeze({ groupId: saved.id, membership: Object.freeze(saved.members), members: Object.freeze([...targets.values()]) });
}
const scaleOf = member => {
  if (typeof member?.scale !== 'number' || !Number.isFinite(member.scale)) throw Error('Finite group anchor required.');
  return member.scale;
};
export function relativeGroupChange(baseline, requestedDelta) {
  if (typeof requestedDelta !== 'number' || !Number.isFinite(requestedDelta) || !baseline?.members?.length) throw Error('Finite relative delta and baseline required.');
  const scales = baseline.members.map(scaleOf);
  const lower = Math.min(0, Math.max(...scales.map(scale => GROUP_FLOOR_SCALE - scale)));
  const upper = Math.max(0, Math.min(...scales.map(scale => GROUP_TOP_SCALE - scale)));
  let delta = Math.max(lower, Math.min(upper, requestedDelta));
  const atTop = upper > 0 && delta === upper, atBottom = lower < 0 && delta === lower;
  // At most floating-point addition error at a shared endpoint: move the ONE
  // common delta inward, never clamp or round independent members.
  if (delta > 0 && scales.some(scale => scale + delta > GROUP_TOP_SCALE)) delta = Math.max(0, delta - 1e-12);
  if (delta < 0 && scales.some(scale => scale + delta < GROUP_FLOOR_SCALE)) delta = Math.min(0, delta + 1e-12);
  if (Math.abs(delta) < 1e-12) delta = 0; // Shared numerical no-op, not member rounding.
  // The endpoint member lands exactly on the limit: the loudest at position 1,
  // the quietest at position 0 (-inf), even after the inward nudge.
  const position = scale => atTop && scale + delta >= GROUP_TOP_SCALE - 1e-9 ? 1
    : atBottom && scale + delta <= GROUP_FLOOR_SCALE + 1e-9 ? 0 : scaleToPosition(scale + delta);
  const commands = baseline.members.map((member, i) => Object.freeze({ ...member.target, value: delta === 0 ? member.value : position(scales[i]) }));
  return Object.freeze({ delta: delta === 0 ? 0 : delta, limited: delta !== requestedDelta, commands: Object.freeze(commands) });
}

// One common scale-unit delta range for a fresh immutable anchor: the reference
// is the loudest member; lower is 0 when the quietest is already at -inf.
export function groupTravel(baseline) {
  const members = baseline?.members;
  if (!Array.isArray(members) || !members.length) throw Error('Finite group anchor required.');
  const scales = members.map(scaleOf);
  return Object.freeze({
    referenceScale: Math.max(...scales),
    lower: Math.min(0, Math.max(...scales.map(scale => GROUP_FLOOR_SCALE - scale))),
    upper: Math.max(0, Math.min(...scales.map(scale => GROUP_TOP_SCALE - scale))),
  });
}
// The group cap is the loudest member's fader position on the display scale.
// requested delta = scale(position) - scale(reference anchor) is one common
// scale-unit offset, clamped to the whole-group travel (top: loudest at 1;
// bottom: quietest at 0 / -inf).
export function groupReferenceDelta(baseline, position) {
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) throw Error('Group reference position must be finite from zero to one.');
  const { referenceScale, lower, upper } = groupTravel(baseline);
  if (position === 1) return upper;
  return Math.max(lower, Math.min(upper, positionToScale(position) - referenceScale));
}
export function groupReferencePosition(baseline, delta) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) throw Error('Finite group delta required.');
  const { referenceScale, upper } = groupTravel(baseline);
  if (delta === upper && upper > 0) return 1;
  return scaleToPosition(referenceScale + delta);
}
