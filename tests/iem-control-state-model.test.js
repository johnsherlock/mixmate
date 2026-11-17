import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createControlScope, createControlState, transitionControl, OBSERVATION_WINDOW_MS } from '../src/iem/control-state-model.js';
import { continuousFaderDB, GROUP_MAX_DB } from '../src/iem/relative-groups.js';

function fixture(kind = 'level', linked = false, levels = [0.4, 0.6]) {
  const received = new Map([['model', 'ui24'], ['a.0.stereoIndex', linked ? 0 : -1], ['a.0.matrix', false], ['i.0.stereoIndex', -1], ['i.1.stereoIndex', -1]]);
  if (linked) { received.set('a.1.stereoIndex', 1); received.set('a.1.matrix', false); }
  for (let a = 0; a < (linked ? 2 : 1); a++) {
    received.set(`a.${a}.mix`, levels[0]); received.set(`a.${a}.eq.bypass`, false);
    for (let b = 0; b < 31; b++) received.set(`a.${a}.eq.peak.${b}`, 0.5);
    for (let i = 0; i < 2; i++) { received.set(`i.${i}.aux.${a}.value`, levels[i]); received.set(`i.${i}.aux.${a}.pan`, 0.5); }
  }
  const receipts = new Map([...received.keys()].map(path => [path, 1]));
  const target = kind === 'level' ? { kind: 'master', auxIndex: 0 } : kind === 'pan' ? { sourceId: 'i.0', auxIndex: 0 } : { auxIndex: 0 };
  const group = { id: 'band', members: ['i.0', 'i.1'] };
  const scope = () => createControlScope({ kind, received, receipts, target, group });
  let state = createControlState({ scope: scope(), generation: 1, revision: 1, now: { mono: 0, wall: 10000 } });
  let time = 0;
  const step = (type, fields = {}, advance = 1) => { time += advance; state = transitionControl(state, { type, now: { mono: time, wall: 10000 + time }, ...fields }); return state; };
  const receive = (path, value, extra = {}) => {
    const receipt = state.lastReceipt + 1;
    const result = step('receive', { generation: state.generation, path, value, receipt, ...extra });
    if (!extra.generation || extra.generation === state.generation) { received.set(path, value); receipts.set(path, receipt); }
    return result;
  };
  const gesture = value => { step('begin'); const token = state.gesture.token; step('preview', { token, value }); step('commit', { token }); return state.operation?.id; };
  const dispatch = () => {
    const id = state.operation.id, count = state.operation.expected.length;
    for (let ordinal = 0; ordinal < count; ordinal++) { step('authorize', { id, ordinal }); step('returned', { id, ordinal }); }
    return id;
  };
  return { get state() { return state; }, step, receive, gesture, dispatch, received, receipts, scope };
}

test('no-echo absolute gestures retain permission, raw actual and repeated explicit command intent', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.65); a.dispatch();
  assert.equal(a.state.status, 'pending'); assert.throws(() => a.step('begin'));
  a.step('tick', {}, OBSERVATION_WINDOW_MS);
  assert.equal(a.state.status, 'sent-unverified'); assert.equal(a.state.armed, true);
  assert.equal(a.state.actual[0].value, 0.4); assert.equal(a.state.chain.requested[0].value, 0.65);
  a.gesture(0.7); a.dispatch(); a.step('tick', {}, OBSERVATION_WINDOW_MS);
  assert.equal(a.state.chain.requested[0].value, 0.7); assert.equal(a.state.actual[0].value, 0.4);
  assert.equal(a.state.operation.returned, 1); assert.equal(a.state.operation.status, 'sent-unverified');
});

test('repeated linked and relative gestures preserve requested offsets against one actual anchor only', () => {
  for (const linked of [false, true]) {
    const a = fixture('group', linked); a.step('arm'); const anchor = a.state.chain.anchor;
    a.gesture(3); a.dispatch(); a.step('tick', {}, 2500); a.gesture(4); a.dispatch();
    assert.equal(a.state.chain.anchor, anchor); assert.equal(a.state.chain.delta, 7);
    assert.equal(a.state.operation.expected.length, linked ? 4 : 2);
    for (const [i, requested] of a.state.chain.requested.entries()) assert.ok(Math.abs(continuousFaderDB(requested.value) - anchor[i].db - 7) < 1e-10);
    assert.deepEqual(a.state.actual.map(x => x.value), anchor.map(x => x.value));
    // These are target-vector properties. Silent partial hardware application
    // cannot be detected or certified by send returns and is not simulated as fact.
    a.step('tick', {}, 2500); a.gesture(100);
    const p = a.state.operation;
    assert.equal(p.delta, Math.min(...anchor.map(x => GROUP_MAX_DB - x.db)));
    assert.ok(p.expected.every(x => x.value > 0 && x.value <= 1));
  }
});

test('exact all-path fresh matches are observations, raw unequal partials block further gestures', () => {
  const a = fixture('level', true); a.step('arm'); a.gesture(0.7); a.dispatch();
  const expected = a.state.operation.expected;
  a.receive(expected[0].path, 0.7); assert.equal(a.state.status, 'pending'); assert.throws(() => a.step('begin'));
  a.receive(expected[1].path, 0.7); assert.equal(a.state.status, 'observed-match'); assert.equal(a.state.armed, true);
  a.gesture(0.8); assert.equal(a.state.status, 'dispatching');
});

test('raw rounding never receives tolerance authority; pan normalization is prevalidated and field specific', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.39619533446252725); a.dispatch();
  a.receive('a.0.mix', 0.3961953345); assert.equal(a.state.status, 'precision-or-native-conflict');
  assert.equal(a.state.actual[0].value, 0.3961953345); assert.equal(a.state.armed, false); assert.equal(a.state.chain, null);
  const p = fixture('pan', true); p.step('arm'); p.step('begin'); const token = p.state.gesture.token;
  for (const value of [NaN, Infinity, -1e-12, 1 + 1e-12, '0.5']) assert.throws(() => p.step('preview', { token, value }));
  p.step('preview', { token, value: 0.12349 }); p.step('commit', { token });
  assert.ok(p.state.operation.expected.every(x => x.value === 0.123));
  p.dispatch(); p.receive(p.state.operation.expected[0].path, 0.12300000001); assert.equal(p.state.armed, false);
});

test('same-value preauthorization receipts cannot confirm and reentrant receipts stop all remaining ordinals', () => {
  const a = fixture('geq'); a.step('arm'); const values = Array(31).fill(0.6); values[0] = 0.5; a.gesture(values);
  // Same received value before authorization advances receipt but not a match.
  a.receive('a.0.eq.peak.0', 0.5); a.dispatch();
  assert.equal(a.state.operation.expected[0].cutpoint, 2); assert.equal(a.state.status, 'pending');
  for (let b = 1; b < 31; b++) a.receive(`a.0.eq.peak.${b}`, 0.6);
  assert.equal(a.state.status, 'pending'); a.receive('a.0.eq.peak.0', 0.5); assert.equal(a.state.status, 'observed-match');
  const b = fixture('level', true); b.step('arm'); const id = b.gesture(0.8); b.step('authorize', { id, ordinal: 0 });
  b.receive('a.0.mix', 0.8); assert.equal(b.state.status, 'reentrant-invalidated');
  b.step('returned', { id, ordinal: 0 }); assert.equal(b.state.operation.returned, 1);
  assert.throws(() => b.step('authorize', { id, ordinal: 1 })); assert.equal(b.state.chain, null);
});

test('native away/back invalidates immutable ownership and stale prewrite anchor cannot recover', () => {
  const a = fixture('group'); a.step('arm'); a.gesture(2); a.dispatch(); a.step('tick', {}, 2500);
  const first = a.state.scope.members[0].path, original = a.state.actual[0].value;
  a.receive(first, 0.9); a.receive(first, original);
  assert.equal(a.state.armed, false); assert.equal(a.state.chain, null); assert.throws(() => a.step('arm'));
  // Even an explicit select with the old full snapshot cannot erase the barrier.
  a.step('select', { scope: a.scope(), revision: 2 }); assert.throws(() => a.step('arm'));
  for (const member of a.state.scope.members) a.receive(member.path, member.value);
  a.step('select', { scope: a.scope(), revision: 3 }); a.step('arm'); assert.equal(a.state.armed, true);
});

test('selection away/back retains per-closure uncertainty barrier, disjoint closure stays independent', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); a.step('tick', {}, 2500);
  const originalScope = a.scope();
  a.received.set('a.2.stereoIndex', -1); a.received.set('a.2.matrix', false); a.received.set('a.2.mix', 0.3); a.receipts.set('a.2.mix', 1);
  const other = createControlScope({ kind: 'level', received: a.received, receipts: a.receipts, target: { kind: 'master', auxIndex: 2 }, group: undefined });
  a.step('select', { scope: other, revision: 2 }); a.step('arm'); assert.equal(a.state.armed, true);
  a.step('select', { scope: originalScope, revision: 3 }); assert.throws(() => a.step('arm'));
  a.receive('a.0.mix', 0.7); a.step('arm'); assert.equal(a.state.chain.anchor[0].value, 0.7);
});

test('interrupted dispatch counts known returns and unknown throw without rollback, replay or recovery shortcut', () => {
  const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.8);
  a.step('authorize', { id, ordinal: 0 }); a.step('returned', { id, ordinal: 0 }); a.step('authorize', { id, ordinal: 1 }); a.step('threw', { id, ordinal: 1 });
  assert.equal(a.state.operation.authorized, 2); assert.equal(a.state.operation.returned, 1); assert.equal(a.state.operation.unknownDelivery, true);
  assert.equal(a.state.status, 'interrupted'); assert.throws(() => a.step('arm')); assert.throws(() => a.step('authorize', { id, ordinal: 1 }));
  a.receive('a.0.mix', 0.8); assert.throws(() => a.step('arm')); a.receive('a.1.mix', 0.8); a.step('arm'); assert.equal(a.state.armed, true);
});

test('late send returns update canceled operation only and cannot resurrect permission', () => {
  const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.8); a.step('authorize', { id, ordinal: 0 });
  a.step('invalidate', { reason: 'cancel', revision: 2 });
  a.step('select', { scope: a.scope(), revision: 3 });
  a.step('returned', { id, ordinal: 0 }); assert.equal(a.state.retired.at(-1).returned, 1); assert.equal(a.state.armed, false);
  assert.throws(() => a.step('returned', { id, ordinal: 0 }));
  a.receive('a.0.mix', 0.8); a.receive('a.1.mix', 0.8); a.step('select', { scope: a.scope(), revision: 4 }); a.step('arm'); const newer = a.gesture(0.9);
  assert.notEqual(newer, id); assert.throws(() => a.step('returned', { id, ordinal: 0 }));
});

test('late exact receipts update actual but never retroconfirm terminal operation; old value conflicts with newer intent', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); a.step('tick', {}, 2500);
  a.receive('a.0.mix', 0.7); assert.equal(a.state.operation.status, 'sent-unverified'); assert.equal(a.state.actual[0].value, 0.7); assert.equal(a.state.armed, true);
  a.gesture(0.8); a.dispatch(); a.receive('a.0.mix', 0.7); assert.equal(a.state.status, 'precision-or-native-conflict');
});

test('deadline checked on entry before delayed matching receipt; clock anomalies and sleep invalidate', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch();
  a.step('receive', { generation: 1, path: 'a.0.mix', value: 0.7, receipt: 2 }, 2500);
  assert.equal(a.state.operation.status, 'sent-unverified');
  for (const now of [{ mono: -1, wall: 10000 }, { mono: 0, wall: 10000 }, { mono: 100, wall: 13000 }]) {
    const b = fixture(); b.step('arm');
    if (now.mono < 0) assert.throws(() => transitionControl(b.state, { type: 'tick', now }));
    else assert.equal(transitionControl(b.state, { type: 'tick', now }).status, 'clock-invalidated');
  }
  const b = fixture(); b.step('arm'); b.gesture(0.7); b.dispatch(); b.step('invalidate', { reason: 'sleep', revision: 2 });
  assert.deepEqual(b.state.actual, []); assert.equal(b.state.armed, false);
});

test('fresh complete new generation is recovery only and cannot confirm old operation', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch();
  a.step('invalidate', { reason: 'disconnect', revision: 2 });
  a.received.set('a.0.mix', 0.7); a.receipts.set('a.0.mix', 1);
  a.step('new-generation', { generation: 2, revision: 3, scope: a.scope() });
  assert.equal(a.state.operation, null); assert.equal(a.state.retired.at(-1).status, 'disconnect-invalidated'); assert.equal(a.state.armed, false);
  a.receive('a.0.mix', 0.1, { generation: 1 }); assert.equal(a.state.actual[0].value, 0.7);
  a.step('arm'); assert.equal(a.state.chain.anchor[0].value, 0.7);
});

test('all owner invalidation classes cancel authority and touched recovery must be fresh and complete', () => {
  for (const reason of ['selection', 'profile', 'topology', 'membership', 'native', 'processing', 'hide', 'navigation', 'disconnect', 'sleep', 'cancel', 'missing']) {
    const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); a.step('invalidate', { reason, revision: 2 });
    assert.equal(a.state.armed, false, reason); assert.equal(a.state.chain, null, reason); assert.equal(a.state.barriers.length, 1, reason);
    assert.throws(() => a.step('arm'), undefined, reason);
  }
});

test('malformed events, wrong paths, generation, counts and sequences cannot confirm or grant sends', () => {
  const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.8);
  for (const ordinal of [-1, 1, NaN, Infinity, '0']) assert.throws(() => a.step('authorize', { id, ordinal }));
  assert.throws(() => a.step('authorize', { id: id + 1, ordinal: 0 })); a.dispatch();
  a.receive('a.9.mix', 0.8); assert.equal(a.state.status, 'pending'); assert.ok(a.state.operation.expected.every(x => !x.matched));
  for (const fields of [{ value: NaN }, { value: Infinity }, { value: '0.8' }, { value: 1.1 }, { receipt: a.state.lastReceipt }, { receipt: -1 }, { receipt: '9' }, { generation: NaN }, { path: {} }]) {
    assert.throws(() => a.step('receive', { generation: 1, path: 'a.0.mix', value: 0.8, receipt: a.state.lastReceipt + 1, ...fields }));
  }
  assert.throws(() => a.step('tick', { unauthorized: true })); assert.throws(() => a.step('mystery'));
  assert.throws(() => a.step('select', { scope: { ...a.state.scope }, revision: 2 }));
});

test('typed construction rejects missing metadata/readbacks/receipts, silent groups and unequal actual links', () => {
  for (const kind of ['level', 'pan', 'group', 'geq']) {
    const a = fixture(kind, true); a.received.delete(a.state.scope.members[0].path); assert.throws(a.scope);
    const b = fixture(kind, true); b.receipts.set(b.state.scope.members[0].path, NaN); assert.throws(b.scope);
    const c = fixture(kind, true); c.received.set(c.state.scope.members[0].path, 0.2); assert.throws(c.scope);
    const d = fixture(kind, true); d.received.delete('a.0.stereoIndex'); assert.throws(d.scope);
  }
  for (const levels of [[0, 0.4], [1e-12, 0.4], [NaN, 0.4]]) assert.throws(() => fixture('group', false, levels));
});

test('group deduplication uses canonical member closures and never averages unequal actuals', () => {
  const a = fixture('group', true); a.received.set('i.0.stereoIndex', 0); a.received.set('i.1.stereoIndex', 1);
  for (const aux of [0, 1]) a.received.set(`i.1.aux.${aux}.value`, 0.4);
  const scope = a.scope(); assert.equal(scope.members.length, 4); assert.equal(new Set(scope.members.map(x => x.path)).size, 4);
  a.received.set('i.1.aux.1.value', 0.41); assert.throws(a.scope);
});

test('31/62-path GEQ projection scales complete matching and partial failure without enabling writes', () => {
  for (const linked of [false, true]) {
    const a = fixture('geq', linked); a.step('arm'); const values = Array.from({ length: 31 }, (_, i) => 0.2 + i / 100);
    a.gesture(values); values.fill(1); a.dispatch(); const expected = a.state.operation.expected;
    assert.equal(expected.length, linked ? 62 : 31); assert.equal(expected[0].value, 0.2);
    expected.forEach((x, i) => { a.receive(x.path, x.value); assert.equal(a.state.status, i === expected.length - 1 ? 'observed-match' : 'pending'); });
    const b = fixture('geq', linked); b.step('arm'); const id = b.gesture(Array(31).fill(0.6));
    for (let ordinal = 0; ordinal < 15; ordinal++) { b.step('authorize', { id, ordinal }); b.step('returned', { id, ordinal }); }
    b.step('authorize', { id, ordinal: 15 }); b.step('threw', { id, ordinal: 15 });
    assert.equal(b.state.operation.returned, 15); assert.equal(b.state.operation.authorized, 16); assert.equal(b.state.barriers.length, expected.length);
  }
});

test('opaque latest gesture identity and frozen copied values prevent forged previews/commits', () => {
  const a = fixture(); a.step('arm'); a.step('begin'); const token = a.state.gesture.token;
  assert.throws(() => a.step('preview', { token: { ...token }, value: 0.8 }));
  a.step('preview', { token, value: 0.8 }); a.step('commit', { token }); assert.throws(() => a.step('commit', { token }));
  assert.ok(Object.isFrozen(a.state) && Object.isFrozen(a.state.operation.expected));
  assert.equal('send' in a.state, false); assert.equal('socket' in a.state, false);
});

test('model is integrated only through private session owner in live entries', async () => {
  const root = resolve(new URL('..', import.meta.url).pathname), visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return; visited.add(file);

    const text = await readFile(file, 'utf8');
    const imports = [...text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(x => x[1]);
    if (file.endsWith('.html')) imports.push(...[...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x => x[1]));
    for (const ref of imports) if (ref.startsWith('.') || ref.startsWith('/src/')) {
      const child = ref.startsWith('/') ? resolve(root, ref.slice(1)) : resolve(dirname(file), ref);
      if (/\.(js|html)$/.test(child)) await visit(child);
    }
  }
  for (const entry of ['index.html', 'iem.html', 'demo.html', 'connection-test.html']) await visit(resolve(root, entry));
  assert.ok(visited.has(resolve(root, 'src/iem/session-core.js')));
  assert.ok(visited.has(resolve(root, 'src/iem/control-state-model.js')));
});

test('dispatch stalls expire without later ordinals; held result can settle diagnostics only', () => {
  const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.7); a.step('authorize', { id, ordinal: 0 });
  a.step('tick', {}, 2500); assert.equal(a.state.status, 'dispatch-expired'); assert.equal(a.state.armed, false);
  a.step('returned', { id, ordinal: 0 }); assert.equal(a.state.operation.returned, 1);
  assert.throws(() => a.step('authorize', { id, ordinal: 1 })); assert.throws(() => a.step('arm'));
});

test('cached group common boundary is committed exactly and zero move never creates dispatch', () => {
  const a = fixture('group', false, [0.99, 0.35]); a.step('arm'); a.step('begin'); let token = a.state.gesture.token;
  a.step('preview', { token, value: 12 }); const cached = a.state.gesture.preview;
  assert.notEqual(cached.gestureDelta, Math.round(cached.gestureDelta * 10) / 10);
  a.step('commit', { token }); assert.equal(a.state.operation.delta, cached.delta); assert.deepEqual(a.state.operation.expected.map(x => x.value), cached.expected.map(x => x.value));
  a.dispatch(); a.step('tick', {}, 2500); a.step('begin'); token = a.state.gesture.token;
  a.step('preview', { token, value: 0 }); a.step('commit', { token }); assert.equal(a.state.status, 'no-op');
  assert.equal(a.state.operation.returned, 2); assert.equal(a.state.chain.delta, cached.delta);
  const b = fixture(); b.step('arm'); b.gesture(0.4); assert.equal(b.state.operation, null); assert.equal(b.state.status, 'no-op');
});

test('context prerequisites cannot be rearmed from an invalidated prewrite scope', () => {
  for (const reason of ['topology', 'membership', 'missing', 'profile']) {
    const a = fixture(); a.step('arm'); a.step('invalidate', { reason, revision: 2 }); assert.throws(() => a.step('arm'));
    a.step('select', { scope: a.scope(), revision: 3 }); a.step('arm'); assert.equal(a.state.armed, true);
  }
});

test('data-only pure scopes reject injected paths/accessors without invoking them', () => {
  const a = fixture(); let invoked = false;
  const target = { get kind() { invoked = true; return 'master'; }, auxIndex: 0 };
  assert.throws(() => createControlScope({ kind: 'level', received: a.received, receipts: a.receipts, target, group: undefined }));
  assert.equal(invoked, false);
  for (const bad of [{ kind: 'master', auxIndex: 10 }, { kind: 'master', auxIndex: 0, path: 'i.0.mix' }, { kind: 'send', sourceId: 'i.24', auxIndex: 0 }]) {
    assert.throws(() => createControlScope({ kind: 'level', received: a.received, receipts: a.receipts, target: bad, group: undefined }));
  }
});

test('old terminal expectations never exempt native changes in a new generation or context', () => {
  for (const replacement of ['new-generation', 'select']) {
    const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); a.step('tick', {}, 2500);
    if (replacement === 'new-generation') a.step(replacement, { generation: 2, revision: 2, scope: a.scope() });
    else {
      a.step('invalidate', { reason: 'selection', revision: 2 }); a.receive('a.0.mix', 0.4);
      a.step('select', { revision: 3, scope: a.scope() });
    }
    a.step('arm'); a.receive('a.0.mix', 0.7);
    assert.equal(a.state.status, 'native-invalidated'); assert.equal(a.state.armed, false); assert.equal(a.state.chain, null);
  }
});

test('old high receipt numbers cannot poison a fresh generation recovery barrier', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch();
  a.receive('a.9.mix', 0.1, { receipt: 1000000 }); a.step('invalidate', { reason: 'disconnect', revision: 2 });
  a.receipts.set('a.0.mix', 1); a.step('new-generation', { generation: 2, revision: 3, scope: a.scope() });
  assert.deepEqual(a.state.barriers, []); a.step('arm'); a.gesture(0.8); a.dispatch(); a.step('invalidate', { reason: 'cancel', revision: 4 });
  assert.equal(a.state.barriers[0].floor, 1); a.receive('a.0.mix', 0.8);
  a.step('select', { scope: a.scope(), revision: 5 }); a.step('arm'); assert.equal(a.state.armed, true);
});

test('cumulative wall skew cannot extend a pending window or confirm with held monotonic time', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); const start = a.state.now;
  let state = a.state;
  for (let n = 1; n <= 4; n++) {
    state = transitionControl(state, { type: 'tick', now: { mono: start.mono, wall: start.wall + n * 700 } });
  }
  assert.equal(state.armed, false); assert.equal(state.operation.status, 'clock-invalidated');
  const b = fixture(); b.step('arm'); b.gesture(0.7); b.dispatch(); const t = b.state.now;
  const end = transitionControl(b.state, { type: 'receive', generation: 1, path: 'a.0.mix', value: 0.7, receipt: 2, now: { mono: t.mono + 2200, wall: t.wall + 2500 } });
  assert.equal(end.operation.status, 'sent-unverified');
});

test('event schema validation precedes clocks and never invokes getters', () => {
  const a = fixture(); let invoked = false;
  for (const event of [{ get type() { invoked = true; return 'tick'; }, now: { mono: 0, wall: 0 } },
    { type: 'tick', get now() { invoked = true; return { mono: 0, wall: 0 }; } },
    { type: 'tick', now: { get mono() { invoked = true; return 0; }, wall: 0 } },
    { type: 'tick', now: { mono: 0, wall: 0 }, extra: true }]) {
    assert.throws(() => transitionControl(a.state, event));
  }
  assert.equal(invoked, false); assert.equal(a.state.status, 'idle');
});

test('reentrant generation replacement preserves new ownership and records late old return separately', () => {
  const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.8); a.step('authorize', { id, ordinal: 0 });
  a.step('new-generation', { generation: 2, revision: 2, scope: a.scope() }); a.step('arm'); const newer = a.gesture(0.9);
  const status = a.state.status; a.step('returned', { id, ordinal: 0 });
  assert.equal(a.state.operation.id, newer); assert.equal(a.state.operation.returned, 0); assert.equal(a.state.status, status); assert.equal(a.state.armed, true);
  assert.equal(a.state.retired.find(x => x.id === id).returned, 1);
  assert.throws(() => a.step('authorize', { id, ordinal: 1 }));
  const b = fixture('level', true); b.step('arm'); const prior = b.gesture(0.8); b.step('authorize', { id: prior, ordinal: 0 });
  b.step('select', { scope: b.scope(), revision: 2 }); assert.throws(() => b.step('arm'));
  b.step('returned', { id: prior, ordinal: 0 });
  assert.equal(b.state.operation, null); assert.equal(b.state.retired.at(-1).returned, 1); assert.equal(b.state.armed, false);
});

test('clock-invalid current and retired send outcomes settle exactly once without restoring authority', () => {
  for (const retired of [false, true]) for (const type of ['returned', 'threw']) for (const clock of ['backward', 'skew']) {
    const a = fixture('level', true); a.step('arm'); const id = a.gesture(0.8); a.step('authorize', { id, ordinal: 0 });
    if (retired) {
      a.step('new-generation', { generation: 2, revision: 2, scope: a.scope() }); a.step('arm'); a.gesture(0.9);
    }
    const before = a.state, now = clock === 'backward' ? { mono: before.now.mono - 1, wall: before.now.wall - 1 } : { mono: before.now.mono + 1, wall: before.now.wall + 2000 };
    for (const wrong of [{ id: id + 100, ordinal: 0 }, { id, ordinal: 1 }, { id, ordinal: NaN }, { id, ordinal: '0' }]) {
      assert.throws(() => transitionControl(before, { type, now, ...wrong }));
    }
    const after = transitionControl(before, { type, id, ordinal: 0, now });
    const op = retired ? after.retired.find(x => x.id === id) : after.operation;
    assert.equal(op.flight, null); assert.equal(op.returned, type === 'returned' ? 1 : 0); assert.equal(op.unknownDelivery, type === 'threw');
    assert.equal(after.status, 'clock-invalidated'); assert.equal(after.armed, false); assert.equal(after.chain, null);
    if (retired) {
      assert.notEqual(after.operation.id, id); assert.equal(after.operation.returned, 0); assert.equal(after.operation.unknownDelivery, false);
      assert.equal(op.status, 'generation-invalidated');
    } else assert.equal(op.status, 'clock-invalidated');
    assert.throws(() => transitionControl(after, { type, id, ordinal: 0, now }));
    // The input state remains immutable; rejected outcomes cannot silently settle it.
    const original = retired ? before.retired.find(x => x.id === id) : before.operation;
    assert.equal(original.flight, 0); assert.equal(original.returned, 0); assert.equal(original.unknownDelivery, false);
  }
});

test('changed historical disjoint readbacks preserve current permission and old uncertainty barriers', () => {
  const a = fixture(); a.step('arm'); a.gesture(0.7); a.dispatch(); a.step('tick', {}, 2500);
  a.received.set('a.2.stereoIndex', -1); a.received.set('a.2.matrix', false); a.received.set('a.2.mix', 0.3); a.receipts.set('a.2.mix', 1);
  const other = createControlScope({ kind: 'level', received: a.received, receipts: a.receipts, target: { kind: 'master', auxIndex: 2 }, group: undefined });
  a.step('select', { scope: other, revision: 2 }); a.step('arm'); const chain = a.state.chain, barriers = a.state.barriers;
  a.receive('a.0.mix', 0.8); // Previously selected and stored, but now disjoint.
  assert.equal(a.state.actual.find(x => x.path === 'a.0.mix').value, 0.8);
  assert.equal(a.state.armed, true); assert.deepEqual(a.state.chain, chain); assert.deepEqual(a.state.barriers, barriers);
  a.receive('a.9.mix', 0.9); // Never selected: same effect on current authority.
  assert.equal(a.state.armed, true); assert.deepEqual(a.state.chain, chain); assert.deepEqual(a.state.barriers, barriers);
  a.receive('a.2.mix', 0.4); assert.equal(a.state.armed, false); assert.equal(a.state.status, 'native-invalidated');
  // Membership overlap is relevant even when the path was also in an old scope.
  const b = fixture('group'); const groupScope = b.scope();
  const single = createControlScope({ kind: 'level', received: b.received, receipts: b.receipts, target: { kind: 'send', sourceId: 'i.0', auxIndex: 0 }, group: undefined });
  b.step('select', { scope: single, revision: 2 }); b.step('select', { scope: groupScope, revision: 3 }); b.step('arm');
  b.receive('i.0.aux.0.value', 0.7); assert.equal(b.state.armed, false); assert.equal(b.state.status, 'native-invalidated');
});
