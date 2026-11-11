import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { auxPanPath, normalizeAuxPanPosition, encodeAuxPanCommand, resolveAuxPanTargets, resolveAuxPanTopology } from '../src/iem/aux-pan-protocol.js';
import { createAuxPanGuard } from '../src/iem/aux-pan-safety.js';
const target = { sourceId: 'i.2', auxIndex: 1 };
function fixture(sourceId = 'i.2') {
  const context = { generation: 1, revision: 0, panRevision: 0, open: true, visible: true, observations: new Map(), receipts: new Map() }; let sequence = 0;
  function receive(frame) {
    for (const { path, field, value } of parseIemStateFrame(frame)) {
      const actual = context.observations.has(path) && context.observations.get(path) !== value;
      if (actual && field === 'pan') context.panRevision++;
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(field)) context.revision++;
      context.observations.set(path, value); context.receipts.set(path, ++sequence);
    }
  }
  receive(`3:::SETS^model^ui24\nSETD^a.1.matrix^0\nSETD^a.2.matrix^0\nSETD^a.1.stereoIndex^0\nSETD^a.2.stereoIndex^1\nSETD^${sourceId}.stereoIndex^-1\nSETD^${sourceId}.aux.1.pan^0.4\nSETD^${sourceId}.aux.2.pan^0.4`);
  return { context, receive, guard: createAuxPanGuard({ readContext: () => context }), target: { sourceId, auxIndex: 1 } };
}
test('pan encoder permits only bounded mono-family AUX-send paths and actual wire rounding', () => {
  for (const sourceId of ['i.0', 'i.23', 'l.0', 'l.1', 'p.0', 'p.1']) {
    for (const [requested, actual] of [[0, 0], [-0, 0], [0.5, 0.5], [1, 1], [0.12345, 0.123], [0.1235, 0.124], [0.00049, 0], [0.9995, 1]]) {
      assert.equal(normalizeAuxPanPosition(requested), actual);
      assert.equal(encodeAuxPanCommand({ sourceId, auxIndex: 9, value: requested }), `3:::SETD^${sourceId}.aux.9.pan^${actual}`);
    }
  }
  assert.equal(auxPanPath(target), 'i.2.aux.1.pan');
  for (const value of [undefined, null, true, false, '0.5', NaN, Infinity, -Infinity, -Number.EPSILON, 1 + Number.EPSILON]) {
    assert.throws(() => normalizeAuxPanPosition(value)); assert.throws(() => encodeAuxPanCommand({ ...target, value }));
  }
});
test('invalid descriptors cannot become master/input pan or arbitrary paths, including coercion/accessor shapes', () => {
  for (const sourceId of ['f.0', 'a.0', 'm', 'i.24', 'l.2', 'p.2', 'i.02', 'i.-1', 'i.0.pan^1\nSETD^gain', ['i.0'], 0]) assert.throws(() => encodeAuxPanCommand({ sourceId, auxIndex: 0, value: 0.5 }));
  for (const auxIndex of [-1, 10, 0.5, '0', true, NaN]) assert.throws(() => encodeAuxPanCommand({ sourceId: 'i.0', auxIndex, value: 0.5 }));
  assert.throws(() => encodeAuxPanCommand({ ...target, value: 0.5, path: 'i.0.pan' }));
  assert.throws(() => encodeAuxPanCommand({ ...target, value: 0.5, kind: 'send' }));
  assert.throws(() => encodeAuxPanCommand(Object.create({ ...target, value: 0.5 })));
  let calls = 0; const accessor = { auxIndex: 0, value: 0.5, get sourceId() { calls++; return 'i.0'; } };
  assert.throws(() => encodeAuxPanCommand(accessor)); assert.equal(calls, 0);
  assert.throws(() => encodeAuxPanCommand({ ...target, value: 0.5, [Symbol('extra')]: true }));
});
test('eligible mono input/line/player pan mirrors ONLY the destination pair with no level or source partner fallback', () => {
  for (const sourceId of ['i.2', 'l.0', 'p.1']) {
    const app = fixture(sourceId), closure = resolveAuxPanTargets(app.context.observations, app.target);
    assert.deepEqual(closure.members.map(member => member.path), [`${sourceId}.aux.1.pan`, `${sourceId}.aux.2.pan`]);
    assert.equal(closure.members.length, 2); assert.ok(Object.isFrozen(closure) && Object.isFrozen(closure.members));
    assert.equal(app.context.observations.has(`${sourceId}.aux.1.value`), false); // Pan observation, not unrelated level, establishes this field.
    assert.deepEqual(resolveAuxPanTargets(app.context.observations, { sourceId, auxIndex: 2 }).members, closure.members);
  }
});
test('mono/matrix/unknown/conflicting/overlapping destinations, linked/unknown sources and missing/unequal pan block all commands', () => {
  const mutations = [
    state => state.delete('model'), state => state.set('model', 'ui16'), state => state.delete('a.2.matrix'), state => state.set('a.2.matrix', true),
    state => state.set('a.1.stereoIndex', -1), state => state.delete('a.2.stereoIndex'), state => state.set('a.2.stereoIndex', -1), state => state.set('a.0.stereoIndex', 0), state => state.set('a.3.stereoIndex', 1),
    state => state.delete('i.2.stereoIndex'), state => state.set('i.2.stereoIndex', 0), state => state.set('i.1.stereoIndex', 0), state => state.set('i.3.stereoIndex', 1),
    state => state.delete('i.2.aux.2.pan'), state => state.set('i.2.aux.2.pan', 0.6), state => state.set('i.2.aux.2.pan', false), state => state.set('i.2.aux.2.pan', NaN),
  ];
  for (const mutate of mutations) { const app = fixture(); mutate(app.context.observations); assert.throws(() => resolveAuxPanTargets(app.context.observations, target)); assert.throws(() => app.guard.arm(target)); }
  const linked = fixture(); linked.receive('3:::SETD^i.2.stereoIndex^0\nSETD^i.3.stereoIndex^1'); assert.throws(() => linked.guard.arm(target));
  const fx = fixture('f.0'); assert.throws(() => resolveAuxPanTargets(fx.context.observations, fx.target));
});
test('zero/precise received pan differs from absence; unequal readbacks never round into eligibility', () => {
  const app = fixture(); app.receive('3:::SETD^i.2.aux.1.pan^0\nSETD^i.2.aux.2.pan^0');
  assert.deepEqual(resolveAuxPanTargets(app.context.observations, target).members.map(member => member.value), [0, 0]);
  app.receive('3:::SETD^i.2.aux.1.pan^0.12341\nSETD^i.2.aux.2.pan^0.12349'); assert.throws(() => app.guard.arm(target));
  app.receive('3:::SETD^i.2.aux.2.pan^0.12341'); assert.equal(resolveAuxPanTargets(app.context.observations, target).members[0].value, 0.12341);
});
test('pure explicit arm/prepare cannot send, and rounded wire command is the expected readback', () => {
  const app = fixture(); assert.throws(() => app.guard.prepare(0.5));
  assert.equal(app.guard.arm(target).count, 2); const plan = app.guard.prepare(0.1235); assert.equal(plan.value, 0.124); assert.ok(Object.isFrozen(plan));
  const sent = [];
  for (let ordinal = 0; ordinal < plan.count; ordinal++) { const grant = app.guard.authorizeNext(plan, ordinal); assert.equal(grant.command.value, 0.124); assert.equal(encodeAuxPanCommand(grant.command), grant.message); sent.push(grant.message); }
  assert.deepEqual(sent, ['3:::SETD^i.2.aux.1.pan^0.124', '3:::SETD^i.2.aux.2.pan^0.124']);
  assert.equal(app.guard.readback(plan), 'unconfirmed'); app.receive(sent[0]); assert.equal(app.guard.readback(plan), 'unconfirmed'); app.receive(sent[1]); assert.equal(app.guard.readback(plan), 'observed-match');
});
test('forged/cloned/reordered/replayed/superseded plans invalidate rather than queue or authorize a different operation', () => {
  for (const action of ['foreign', 'clone', 'skip', 'replay', 'new']) {
    const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.6);
    if (action === 'replay') app.guard.authorizeNext(plan, 0);
    if (action === 'new') app.guard.prepare(0.7);
    assert.throws(() => app.guard.authorizeNext(action === 'foreign' ? {} : action === 'clone' ? { ...plan } : plan, action === 'skip' ? 1 : 0));
    assert.throws(() => app.guard.prepare(0.8));
  }
});
test('actual pan away/back or generation/selection/topology/open/visible changes invalidate the fixed baseline', () => {
  for (const change of [app => app.context.generation++, app => app.context.revision++, app => app.context.panRevision++, app => app.context.open = false, app => app.context.visible = false,
    app => app.receive('3:::SETD^i.2.aux.1.pan^0.6\nSETD^i.2.aux.1.pan^0.4'), app => app.receive('3:::SETD^a.2.matrix^1'), app => app.receive('3:::SETD^i.2.stereoIndex^0')]) {
    const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.6); change(app); assert.throws(() => app.guard.authorizeNext(plan, 0)); assert.equal(app.guard.readback(plan), 'invalidated');
  }
  const app = fixture(); app.guard.arm(target); app.receive('3:::SETS^i.2.name^Synthetic <img>\nSETD^i.2.aux.1.pan^0.4'); assert.doesNotThrow(() => app.guard.prepare(0.6));
});
test('rounded same-value pan cutpoints are immediate preauthorization, never prepare time or an unrelated receipt', () => {
  const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.40049); assert.equal(plan.value, 0.4);
  app.receive('3:::SETD^i.2.aux.1.pan^0.4\nSETD^i.2.aux.2.pan^0.4'); app.guard.authorizeNext(plan, 0);
  app.receive('3:::SETD^i.2.aux.1.pan^0.4\nSETD^i.2.aux.2.pan^0.4'); app.guard.authorizeNext(plan, 1);
  assert.equal(app.guard.readback(plan), 'unconfirmed'); app.receive('3:::SETS^i.23.name^Unrelated'); assert.equal(app.guard.readback(plan), 'unconfirmed');
  app.receive('3:::SETD^i.2.aux.2.pan^0.4'); assert.equal(app.guard.readback(plan), 'observed-match');
});
test('partial fake dispatch interruptions and early expected echoes never allow remaining commands or false completion', () => {
  const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.6), sent = [app.guard.authorizeNext(plan, 0).message];
  app.receive(sent[0]); assert.equal(app.guard.readback(plan), 'invalidated'); assert.throws(() => app.guard.authorizeNext(plan, 1)); assert.equal(sent.length, 1);
  const stopped = fixture(); stopped.guard.arm(target); const pending = stopped.guard.prepare(0.6); stopped.guard.authorizeNext(pending, 0); stopped.guard.disarm(); assert.throws(() => stopped.guard.authorizeNext(pending, 1));
});
test('fresh wrong readback conflicts; malformed receipt journals cannot authorize or confirm', () => {
  const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.6); app.guard.authorizeNext(plan, 0); app.guard.authorizeNext(plan, 1);
  app.receive('3:::SETD^i.2.aux.1.pan^0.61'); assert.equal(app.guard.readback(plan), 'conflict'); assert.throws(() => app.guard.prepare(0.5));
  for (const invalid of [NaN, Infinity, -1, '5', undefined]) {
    const item = fixture(); item.guard.arm(target); const next = item.guard.prepare(0.6); item.context.receipts.set('i.2.aux.1.pan', invalid); assert.throws(() => item.guard.authorizeNext(next, 0));
  }
});
test('current pan modules are not wired into production session/entry, and unsupported readbacks remain parseable', async () => {
  for (const file of ['live-entry.js', 'session-core.js', 'live-session.js']) { const text = await readFile(new URL(`../src/iem/${file}`, import.meta.url), 'utf8'); assert.doesNotMatch(text, /aux-pan|createAuxPanGuard|encodeAuxPanCommand/); }
  assert.equal(parseIemStateFrame('3:::SETD^f.0.aux.0.pan^0.25\nSETD^i.2.aux.0.pan^0.75').length, 2);
  assert.throws(() => createAuxPanGuard({}));
});
