import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { faderValueToDB, DBToFaderValue } from 'soundcraft-ui-connection';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { auxLevelPath, encodeAuxLevelCommand, resolveAuxLevelTargets, resolveAuxLevelTopology } from '../src/iem/aux-level-protocol.js';
import { createAuxLevelGuard } from '../src/iem/aux-level-safety.js';
const master = { kind: 'master', auxIndex: 1 }, send = { kind: 'send', auxIndex: 1, sourceId: 'i.1' };
function fixture({ linked = true } = {}) {
  const observations = new Map(), receipts = new Map(); let sequence = 0;
  const context = { generation: 1, revision: 0, levelRevision: 0, open: true, visible: true, observations, receipts };
  function receive(frame) {
    for (const { path, value, field } of parseIemStateFrame(frame)) {
      if (observations.has(path) && observations.get(path) !== value) {
        if (field === 'level') context.levelRevision++;
        if (['model', 'matrix', 'stereoIndex'].includes(field)) context.revision++;
      }
      observations.set(path, value); receipts.set(path, ++sequence);
    }
  }
  receive(`3:::SETS^model^ui24\nSETD^a.1.matrix^0\nSETD^a.2.matrix^0\nSETD^a.1.stereoIndex^${linked ? 0 : -1}\nSETD^a.2.stereoIndex^${linked ? 1 : -1}\nSETD^a.1.mix^0.4\nSETD^a.2.mix^0.4\nSETD^i.1.stereoIndex^${linked ? 0 : -1}\nSETD^i.2.stereoIndex^${linked ? 1 : -1}\nSETD^i.1.aux.1.value^0.4\nSETD^i.2.aux.1.value^0.4\nSETD^i.1.aux.2.value^0.4\nSETD^i.2.aux.2.value^0.4`);
  const guard = createAuxLevelGuard({ readContext: () => context });
  return { context, observations, receipts, receive, guard };
}
test('typed encoders allow only canonical bounded AUX master/send paths and finite numeric values', () => {
  for (const value of [0, -0, 0.00000001, 0.5, 1]) {
    assert.equal(encodeAuxLevelCommand({ ...master, value }), `3:::SETD^a.1.mix^${value === 0 ? 0 : value}`);
    for (const [family, maximum] of [['i', 23], ['l', 1], ['p', 1], ['f', 3]]) {
      assert.equal(encodeAuxLevelCommand({ ...send, sourceId: `${family}.${maximum}`, auxIndex: 9, value }), `3:::SETD^${family}.${maximum}.aux.9.value^${value === 0 ? 0 : value}`);
    }
  }
  for (const value of [undefined, null, true, '0.5', NaN, Infinity, -Infinity, -0.1, 1.01]) assert.throws(() => encodeAuxLevelCommand({ ...send, value }));
  for (const target of [{ ...send, sourceId: 'i.24' }, { ...send, sourceId: 'l.2' }, { ...send, sourceId: 'p.2' }, { ...send, sourceId: 'f.4' }, { ...send, sourceId: 'i.01' }, { ...send, sourceId: 'a.0' }, { ...send, sourceId: 'i.0.mix^1\nSETD^gain' }, { ...master, auxIndex: 10 }, { ...master, auxIndex: '1' }, { ...master, auxIndex: 1.5 }, { ...master, path: 'i.0.mix' }, { kind: 'input', auxIndex: 0 }]) assert.throws(() => encodeAuxLevelCommand({ ...target, value: 0.5 }));
  assert.throws(() => encodeAuxLevelCommand(Object.create({ ...master, value: 0.5 })));
  assert.equal(auxLevelPath(send), 'i.1.aux.1.value');
});
test('source and output relationships expand separately to deduplicated shifted Cartesian targets', () => {
  const { observations } = fixture();
  assert.deepEqual(resolveAuxLevelTargets(observations, master).members.map(item => item.path), ['a.1.mix', 'a.2.mix']);
  const closure = resolveAuxLevelTargets(observations, send);
  assert.deepEqual(closure.members.map(item => item.path), ['i.1.aux.1.value', 'i.1.aux.2.value', 'i.2.aux.1.value', 'i.2.aux.2.value']);
  assert.equal(new Set(closure.members.map(item => item.path)).size, 4);
  assert.ok(Object.isFrozen(closure) && Object.isFrozen(closure.members) && closure.members.every(Object.isFrozen));
  assert.deepEqual(resolveAuxLevelTargets(observations, { ...send, sourceId: 'i.2', auxIndex: 2 }).members, closure.members);
});
test('mono/intrinsic FX and line/player source categories need their actual send fields, never input mix', () => {
  for (const sourceId of ['l.0', 'p.0', 'f.3']) {
    const app = fixture({ linked: false });
    if (sourceId[0] !== 'f') app.receive(`3:::SETD^${sourceId}.stereoIndex^-1`);
    app.receive(`3:::SETD^${sourceId}.aux.1.value^0`);
    const target = { ...send, sourceId };
    assert.equal(resolveAuxLevelTargets(app.observations, target).members.length, 1);
    assert.equal(resolveAuxLevelTargets(app.observations, target).members[0].value, 0);
    app.observations.delete(`${sourceId}.aux.1.value`); app.observations.set(`${sourceId}.mix`, 0.7);
    assert.throws(() => resolveAuxLevelTargets(app.observations, target));
  }
});
test('missing/matrix/unsupported/conflicting topology, missing levels and unequal linked levels block individual actions', () => {
  const mutations = [
    state => state.delete('model'), state => state.set('model', 'ui16'), state => state.delete('a.2.matrix'), state => state.set('a.2.matrix', true),
    state => state.delete('a.2.stereoIndex'), state => state.set('a.2.stereoIndex', -1), state => state.set('a.0.stereoIndex', 0), state => state.set('a.3.stereoIndex', 1),
    state => state.delete('i.2.stereoIndex'), state => state.set('i.2.stereoIndex', -1), state => state.set('i.0.stereoIndex', 0), state => state.set('i.3.stereoIndex', 1),
    state => state.delete('i.2.aux.2.value'), state => state.set('i.2.aux.2.value', 0.6), state => state.set('i.2.aux.2.value', '0.4'),
  ];
  for (const mutate of mutations) { const { observations } = fixture(); mutate(observations); assert.throws(() => resolveAuxLevelTargets(observations, send)); }
  const { observations } = fixture(); observations.set('a.2.mix', 0.6); assert.throws(() => resolveAuxLevelTargets(observations, master));
  assert.equal(resolveAuxLevelTopology(observations, master).members.length, 2); // Partial echo may be unequal without a topology conflict.
});
test('arming and plan preparation have no outbound effects; each ordinal authorizes only one typed command', () => {
  const app = fixture(); const sent = [];
  assert.throws(() => app.guard.prepare(0.6));
  assert.equal(app.guard.arm(send).count, 4); const plan = app.guard.prepare(0.6);
  assert.ok(Object.isFrozen(plan)); assert.equal(sent.length, 0);
  for (let ordinal = 0; ordinal < plan.count; ordinal++) {
    const { command, message } = app.guard.authorizeNext(plan, ordinal);
    assert.ok(Object.isFrozen(command)); assert.equal(message, encodeAuxLevelCommand(command));
    assert.match(message, /^3:::SETD\^/); assert.match(message, /\.aux\.[12]\.value\^0.6$/); sent.push(message);
  }
  assert.equal(sent.length, 4); assert.throws(() => app.guard.authorizeNext(plan, 4));
});
test('foreign/cloned/reordered/replayed and superseded plans disarm without authorizing another command', () => {
  for (const action of ['foreign', 'clone', 'skip', 'replay', 'superseded']) {
    const app = fixture(); app.guard.arm(send); const plan = app.guard.prepare(0.6);
    if (action === 'replay') app.guard.authorizeNext(plan, 0);
    if (action === 'superseded') app.guard.prepare(0.7);
    const item = action === 'foreign' ? {} : action === 'clone' ? { ...plan } : plan;
    assert.throws(() => app.guard.authorizeNext(item, action === 'skip' ? 1 : 0));
    assert.throws(() => app.guard.prepare(0.5));
  }
});
test('generation/context/membership/open/visibility and actual edit revisions cancel leases, including away-and-back changes', () => {
  for (const mutate of [app => app.context.generation++, app => app.context.revision++, app => app.context.open = false, app => app.context.visible = false,
    app => app.context.levelRevision++, app => app.receive('3:::SETD^i.1.aux.1.value^0.5\nSETD^i.1.aux.1.value^0.4'),
    app => app.receive('3:::SETD^a.1.matrix^1'), app => app.receive('3:::SETD^a.2.stereoIndex^-1')]) {
    const app = fixture(); app.guard.arm(send); const plan = app.guard.prepare(0.6); mutate(app);
    assert.throws(() => app.guard.authorizeNext(plan, 0)); assert.equal(app.guard.readback(plan), 'invalidated');
  }
  const app = fixture(); app.guard.arm(send); app.receive('3:::SETD^i.1.aux.1.value^0.4\nSETS^i.1.name^Synthetic <img>');
  assert.doesNotThrow(() => app.guard.prepare(0.6)); // Repeated identical level/name receipt is not an actual level change.
});
test('interruption after one fake send never authorizes remaining commands or rolls back/replays', () => {
  const app = fixture(), sent = []; app.guard.arm(send); const plan = app.guard.prepare(0.6);
  sent.push(app.guard.authorizeNext(plan, 0).message);
  app.guard.disarm(); // Future private writer catches send failure/closure/hide and cancels here.
  for (let ordinal = 1; ordinal < plan.count; ordinal++) assert.throws(() => app.guard.authorizeNext(plan, ordinal));
  assert.equal(sent.length, 1); assert.equal(app.guard.readback(plan), 'invalidated');
});
test('readback requires fresh per-path receipts; sequential 2/4-path echoes stay unconfirmed until all match', () => {
  for (const target of [master, send]) {
    const app = fixture(); app.guard.arm(target); const plan = app.guard.prepare(0.6), messages = [];
    for (let n = 0; n < plan.count; n++) messages.push(app.guard.authorizeNext(plan, n).message);
    assert.equal(app.guard.readback(plan), 'unconfirmed');
    app.receive('3:::SETS^i.23.name^Unrelated receipt'); assert.equal(app.guard.readback(plan), 'unconfirmed');
    for (const [index, message] of messages.entries()) {
      app.receive(message);
      assert.equal(app.guard.readback(plan), index + 1 === messages.length ? 'observed-match' : 'unconfirmed');
    }
  }
});
test('same-value request is not confirmed by old state; fresh wrong readback conflicts and cannot rearm or send', () => {
  const app = fixture({ linked: false }); app.guard.arm(send); const plan = app.guard.prepare(0.4);
  const message = app.guard.authorizeNext(plan, 0).message;
  assert.equal(app.guard.readback(plan), 'unconfirmed'); app.receive(message); assert.equal(app.guard.readback(plan), 'observed-match');
  const wrong = fixture(); wrong.guard.arm(send); const next = wrong.guard.prepare(0.6);
  for (let n = 0; n < next.count; n++) wrong.guard.authorizeNext(next, n);
  wrong.receive('3:::SETD^i.1.aux.1.value^0.65'); assert.equal(wrong.guard.readback(next), 'conflict');
  assert.throws(() => wrong.guard.prepare(0.5)); assert.equal(wrong.guard.readback(next), 'invalidated');
});
test('current receipt evidence is mandatory and caller snapshots cannot replace an armed owner context', () => {
  const app = fixture(); app.receipts.delete('i.1.aux.1.value'); assert.throws(() => app.guard.arm(send));
  assert.throws(() => createAuxLevelGuard({}));
  const owned = fixture(); owned.guard.arm(send); const plan = owned.guard.prepare(0.6);
  const fake = fixture(); owned.context.generation++;
  assert.throws(() => owned.guard.authorizeNext(plan, 0, fake.context));
});
test('pinned display conversion distinguishes silence and finite positions; AUX entry never imports input writer', async () => {
  assert.equal(faderValueToDB(0), -Infinity); assert.equal(DBToFaderValue(-200), 0); assert.equal(DBToFaderValue(10), 1);
  assert.ok(Number.isFinite(faderValueToDB(0.5))); assert.equal(faderValueToDB(1), 10);
  const entry = await readFile(new URL('../src/iem/live-entry.js', import.meta.url), 'utf8');
  assert.match(entry, /createAuxLevelSession/); assert.doesNotMatch(entry, /setInputFader|MixerConnection|fader-intent/);
  const session = await readFile(new URL('../src/iem/live-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(session, /SETD|aux-level|authorizeNext/);
});


test('fresh receipts cannot confirm an incomplete dispatch and invalid journals invalidate the lease', () => {
  const app = fixture(); app.guard.arm(send); const plan = app.guard.prepare(0.6);
  const message = app.guard.authorizeNext(plan, 0).message; app.receive(message);
  assert.equal(app.guard.readback(plan), 'invalidated'); // Not all ordinals were authorized.
  assert.throws(() => app.guard.authorizeNext(plan, 1)); // Expected echo during dispatch changes the baseline: halt, never resume.
  for (const receipt of [NaN, Infinity, -1, '10', undefined]) {
    const item = fixture(); item.guard.arm(send); const next = item.guard.prepare(0.6);
    item.receipts.set('i.1.aux.1.value', receipt);
    assert.throws(() => item.guard.authorizeNext(next, 0));
    const completed = fixture(); completed.guard.arm(master); const final = completed.guard.prepare(0.6);
    for (let n = 0; n < final.count; n++) completed.guard.authorizeNext(final, n);
    completed.receipts.set('a.1.mix', receipt); assert.equal(completed.guard.readback(final), 'invalidated');
  }
});


test('same-value pre-authorization receipts never confirm mono or sequential linked commands', () => {
  for (const [target, linked] of [[master, false], [master, true], [send, true]]) {
    const app = fixture({ linked }); app.guard.arm(target);
    const plan = app.guard.prepare(0.4), paths = resolveAuxLevelTargets(app.observations, target).members.map(item => item.path);
    // All these receipts happened after preparation but before any authorization.
    for (const path of paths) app.receive(`3:::SETD^${path}^0.4`);
    for (let ordinal = 0; ordinal < plan.count; ordinal++) {
      // Also cover a later path arriving between earlier/later ordinals.
      app.receive(`3:::SETD^${paths[ordinal]}^0.4`);
      app.guard.authorizeNext(plan, ordinal);
    }
    assert.equal(app.guard.readback(plan), 'unconfirmed');
    for (let ordinal = 0; ordinal < plan.count; ordinal++) {
      app.receive(`3:::SETD^${paths[ordinal]}^0.4`);
      assert.equal(app.guard.readback(plan), ordinal + 1 === plan.count ? 'observed-match' : 'unconfirmed');
    }
  }
});

test('each linked ordinal has its own receipt cutpoint while earlier fresh echoes remain valid', () => {
  const app = fixture(); app.guard.arm(send); const plan = app.guard.prepare(0.4);
  const paths = resolveAuxLevelTargets(app.observations, send).members.map(item => item.path);
  for (let ordinal = 0; ordinal < plan.count; ordinal++) {
    app.receive(`3:::SETD^${paths[ordinal]}^0.4`); // This path has not yet been authorized.
    app.guard.authorizeNext(plan, ordinal);
    if (ordinal + 1 < plan.count) app.receive(`3:::SETD^${paths[ordinal]}^0.4`); // Fresh echo for an earlier ordinal.
  }
  assert.equal(app.guard.readback(plan), 'unconfirmed'); // Only the last path still lacks a fresh receipt.
  app.receive(`3:::SETD^${paths.at(-1)}^0.4`); assert.equal(app.guard.readback(plan), 'observed-match');
});
