import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faderValueToDB } from 'soundcraft-ui-connection';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { continuousFaderDB, continuousDBToFader, GROUP_MIN_DB, GROUP_MAX_DB, resolveRelativeGroup, relativeGroupChange } from '../src/iem/relative-groups.js';
import { createAuxLevelGuard } from '../src/iem/aux-level-safety.js';
const group = { id: 'band', name: 'Band', members: ['i.0', 'l.0', 'p.0', 'f.0'] };
function state(levels = [0.4, 0.5, 0.6, 0.7]) {
  const received = new Map(parseIemStateFrame('3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.stereoIndex^-1').map(update => [update.path, update.value]));
  group.members.forEach((id, index) => { if (id[0] !== 'f') received.set(`${id}.stereoIndex`, -1); received.set(`${id}.aux.0.value`, levels[index]); });
  return received;
}
test('continuous profile is monotone with dense finite-window round trips and agrees with rounded pinned display', () => {
  let previous = 0, worst = 0;
  for (let n = 0; n <= 10000; n++) {
    const db = GROUP_MIN_DB + (GROUP_MAX_DB - GROUP_MIN_DB) * n / 10000;
    const position = continuousDBToFader(db), returned = continuousFaderDB(position);
    assert.ok(position > 0 && position <= 1 && position >= previous); assert.ok(Number.isFinite(returned));
    worst = Math.max(worst, Math.abs(returned - db)); previous = position;
  }
  assert.ok(worst < 1e-10, String(worst));
  for (const position of [continuousDBToFader(GROUP_MIN_DB), 0.05499999999, 0.055, 0.05500000001, 0.2, 0.5, 0.7647059, 1]) {
    assert.equal(Math.round(continuousFaderDB(position) * 10) / 10 || 0, faderValueToDB(position));
    assert.ok(Math.abs(continuousDBToFader(continuousFaderDB(position)) - position) < 1e-14);
  }
  assert.equal(continuousFaderDB(0), -Infinity); assert.equal(continuousFaderDB(1e-12), -Infinity);
  assert.equal(continuousDBToFader(GROUP_MAX_DB), 1); assert.ok(continuousDBToFader(GROUP_MIN_DB) > 0);
  for (const db of [GROUP_MIN_DB - 1, GROUP_MAX_DB + 1, NaN, Infinity, -Infinity, '0']) assert.throws(() => continuousDBToFader(db));
});
test('one common delta preserves every pairwise balance and hits the first member bound without individual clamp/round', () => {
  let seed = 71;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 600; n++) {
    const levels = group.members.map(() => continuousDBToFader(-190 + random() * 198));
    const baseline = resolveRelativeGroup(state(levels), group, 0);
    for (const request of [-1e6, -12, 0, 12, 1e6]) {
      const change = relativeGroupChange(baseline, request), deltas = change.commands.map((command, index) => continuousFaderDB(command.value) - baseline.members[index].db);
      assert.ok(deltas.every(delta => Math.abs(delta - change.delta) < 1e-10));
      assert.ok(Math.max(...deltas) - Math.min(...deltas) < 1e-10);
      assert.ok(change.commands.every(command => command.value > 0 && command.value <= 1));
      const dbs = change.commands.map(command => continuousFaderDB(command.value));
      assert.ok(Math.min(...dbs) >= GROUP_MIN_DB - 1e-10 && Math.max(...dbs) <= GROUP_MAX_DB + 1e-10);
      if (request === -1e6) assert.ok(Math.abs(Math.min(...dbs) - GROUP_MIN_DB) < 1e-9);
      if (request === 1e6) assert.ok(Math.abs(Math.max(...dbs) - GROUP_MAX_DB) < 1e-9);
      if (request === 0) assert.deepEqual(change.commands.map(command => command.value), levels);
    }
  }
});
test('both finite boundaries remain positive and clamping one member stops all without erasing balance', () => {
  const levels = [continuousDBToFader(GROUP_MIN_DB), continuousDBToFader(-30), continuousDBToFader(-10), 1];
  const baseline = resolveRelativeGroup(state(levels), group, 0);
  assert.equal(relativeGroupChange(baseline, -12).delta, 0); assert.equal(relativeGroupChange(baseline, 12).delta, 0);
  assert.deepEqual(relativeGroupChange(baseline, 12).commands.map(command => command.value), levels);
  const low = resolveRelativeGroup(state([0.4, 0.5, 0.6, 0.7]), group, 0), result = relativeGroupChange(low, -1000);
  assert.ok(result.commands.every(command => command.value > 0)); assert.ok(result.limited);
  assert.ok(Math.abs(Math.min(...result.commands.map(command => continuousFaderDB(command.value))) - GROUP_MIN_DB) < 1e-9);
});
test('group expansion deduplicates overlapping linked members across both output sides and retains family order', () => {
  const received = state(); received.set('a.0.stereoIndex', 0); received.set('a.1.stereoIndex', 1); received.set('a.1.matrix', false);
  received.set('i.0.stereoIndex', 0); received.set('i.1.stereoIndex', 1);
  for (const sourceId of ['i.0', 'i.1']) for (const aux of [0, 1]) received.set(`${sourceId}.aux.${aux}.value`, 0.4);
  const closure = resolveRelativeGroup(received, { id: 'overlap', members: ['i.1', 'i.0'] }, 0);
  assert.deepEqual(closure.members.map(item => item.path), ['i.0.aux.0.value', 'i.0.aux.1.value', 'i.1.aux.0.value', 'i.1.aux.1.value']);
  assert.equal(relativeGroupChange(closure, 3).commands.length, 4); assert.deepEqual(closure.membership, ['i.1', 'i.0']);
  received.set('i.1.aux.1.value', 0.5); assert.throws(() => resolveRelativeGroup(received, { id: 'overlap', members: ['i.1', 'i.0'] }, 0));
});
test('empty/unresolved/silent/below-window/unequal/conflicting members block the entire group', () => {
  for (const bad of [{ id: 'empty', members: [] }, { id: 'missing', members: ['i.20'] }, { id: 'duplicate', members: ['i.0', 'i.0'] }]) assert.throws(() => resolveRelativeGroup(state(), bad, 0));
  for (const value of [0, 1e-12, 1e-8, NaN, '0.4']) { const received = state(); received.set('l.0.aux.0.value', value); assert.throws(() => resolveRelativeGroup(received, group, 0)); }
  const received = state(); received.set('a.0.matrix', true); assert.throws(() => resolveRelativeGroup(received, group, 0));
  const invalid = state(); invalid.set('i.0.stereoIndex', 0); assert.throws(() => resolveRelativeGroup(invalid, group, 0));
});
test('relative guard freezes one baseline, previews without replacing it, and revalidates membership/epochs before each ordinal', () => {
  const observations = state(), receipts = new Map([...observations.keys()].map((path, index) => [path, index + 1])); let currentGroup = structuredClone(group);
  const context = { generation: 1, revision: 1, levelRevision: 0, open: true, visible: true, observations, receipts };
  const guard = createAuxLevelGuard({ readContext: () => context, readGroup: id => id === currentGroup.id ? currentGroup : null });
  guard.armGroup('band', 0); assert.equal(guard.previewRelative(3), 3); assert.equal(guard.previewRelative(6), 6); assert.equal(guard.previewRelative(3), 3);
  const plan = guard.prepareRelative(3), command = guard.authorizeNext(plan, 0).command;
  assert.ok(Math.abs(continuousFaderDB(command.value) - continuousFaderDB(0.4) - 3) < 1e-10);
  currentGroup.members = ['l.0', 'i.0']; assert.throws(() => guard.authorizeNext(plan, 1)); assert.equal(guard.readback(plan), 'invalidated');
  guard.armGroup('band', 0); const next = guard.prepareRelative(3); context.levelRevision++; assert.throws(() => guard.authorizeNext(next, 0));
});
