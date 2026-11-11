import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from '../src/iem/protocol.js';
import { AUX_EQ_DISPLAY_CENTRES, auxEqPath, encodeAuxEqCommand, auxEqPositionToDb, auxEqDbToPosition, parseAuxEqStateFrame, resolveAuxEqTargets } from '../src/iem/aux-eq-protocol.js';
import { mapRequestedAuxEqCurve } from '../src/iem/aux-eq-curve.js';
import { createAuxEqGuard } from '../src/iem/aux-eq-safety.js';
const bands = value => Array(31).fill(value);
const curve = (mode = 'draw', low = -15, high = 15) => ({ mode, samples: [{ frequencyHz: 20, gainDb: low }, { frequencyHz: 20000, gainDb: high }] });
function fixture(linked = false) {
  let sequence = 0;
  const context = { generation: 1, revision: 0, eqRevision: 0, processingRevision: 0, selectedAuxIndex: 1, open: true, visible: true, observations: new Map(), receipts: new Map() };
  function receive(frame, expected = false) {
    for (const update of [...parseIemStateFrame(frame), ...parseAuxEqStateFrame(frame)]) {
      const actual = context.observations.has(update.path) && context.observations.get(update.path) !== update.value;
      if (actual && update.kind === 'auxEq' && !expected) context.eqRevision++;
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(update.field)) context.revision++;
      context.observations.set(update.path, update.value); context.receipts.set(update.path, ++sequence);
    }
  }
  receive(`3:::SETS^model^ui24\nSETD^a.1.matrix^0\nSETD^a.1.stereoIndex^${linked ? 0 : -1}\nSETD^a.1.eq.bypass^0`);
  if (linked) receive('3:::SETD^a.2.matrix^0\nSETD^a.2.stereoIndex^1\nSETD^a.2.eq.bypass^0');
  for (const auxIndex of linked ? [1, 2] : [1]) receive('3:::' + bands(0.5).map((value, bandIndex) => `SETD^a.${auxIndex}.eq.peak.${bandIndex}^${value}`).join('\n'));
  return { context, receive, guard: createAuxEqGuard({ readContext: () => context }), target: { auxIndex: 1 } };
}
function dispatch(app, plan) { return Array.from({ length: plan.count }, (_, ordinal) => app.guard.authorizeNext(plan, ordinal)); }
test('GEQ exact bounded output-only encoder preserves precision without pan rounding/coercion', () => {
  for (const auxIndex of [0, 9]) for (const bandIndex of [0, 30]) for (const value of [0, -0, 0.123456789012345, 0.5, 1]) {
    assert.equal(auxEqPath({ auxIndex, bandIndex }), `a.${auxIndex}.eq.peak.${bandIndex}`);
    assert.equal(encodeAuxEqCommand({ auxIndex, bandIndex, value }), `3:::SETD^a.${auxIndex}.eq.peak.${bandIndex}^${value}`);
  }
  for (const value of ['0.5', true, null, undefined, NaN, Infinity, -Infinity, -Number.EPSILON, 1 + Number.EPSILON]) assert.throws(() => encodeAuxEqCommand({ auxIndex: 0, bandIndex: 0, value }));
  for (const auxIndex of [-1, 10, '0', 0.5, NaN]) assert.throws(() => auxEqPath({ auxIndex, bandIndex: 0 }));
  for (const bandIndex of [-1, 31, '0', 0.5]) assert.throws(() => auxEqPath({ auxIndex: 0, bandIndex }));
  for (const extra of [{ path: 'i.0.eq.b1.gain' }, { bypass: false }, { sourceId: 'i.0' }, { [Symbol()]: 1 }]) assert.throws(() => encodeAuxEqCommand({ auxIndex: 0, bandIndex: 0, value: 0.5, ...extra }));
  assert.throws(() => encodeAuxEqCommand(Object.create({ auxIndex: 0, bandIndex: 0, value: 0.5 })));
  let calls = 0; assert.throws(() => encodeAuxEqCommand({ get auxIndex() { calls++; return 0; }, bandIndex: 0, value: 0.5 })); assert.equal(calls, 0);
});
test('separate bounded receiver admits only GEQ bands/read-only bypass, preserving zero/false/precision', () => {
  const updates = parseAuxEqStateFrame('3:::SETD^a.9.eq.peak.30^0\nSETD^a.9.eq.bypass^0\r\nSETD^a.9.eq.peak.0^0.123456789012345\nSETD^a.9.eq.bypass^1');
  assert.deepEqual(updates.map(x => x.value), [0, false, 0.123456789012345, true]); assert.equal(updates[0].bandIndex, 30);
  for (const path of ['i.0.eq.peak.0', 'm.eq.peak.l.0', 'a.10.eq.peak.0', 'a.01.eq.peak.0', 'a.0.eq.peak.31', 'a.0.eq.peak.00', 'a.0.eq.hpf', 'a.0.eq.lpf', 'a.0.afs.enabled', '__proto__.eq.peak.0']) assert.deepEqual(parseAuxEqStateFrame(`3:::SETD^${path}^0.5`), []);
  for (const raw of ['', 'NaN', 'Infinity', 'false', '0.5^gain', '-0.1', '1.1', ' '.repeat(65), '0'.repeat(65)]) assert.deepEqual(parseAuxEqStateFrame(`3:::SETD^a.0.eq.peak.0^${raw}`), []);
  assert.deepEqual(parseAuxEqStateFrame('3:::SETD^a.0.eq.bypass^0.5\nSETS^a.0.eq.peak.0^0.5'), []);
  assert.deepEqual(parseAuxEqStateFrame('3:::' + 'x'.repeat(IEM_RECEIVE_LIMITS.frameBytes)), []);
  assert.deepEqual(parseAuxEqStateFrame('3:::' + '\n'.repeat(IEM_RECEIVE_LIMITS.lines)), []);
  assert.deepEqual(parseAuxEqStateFrame('3:::SETD^a.0.eq.peak.0^' + ' '.repeat(IEM_RECEIVE_LIMITS.lineBytes) + '0.5'), []);
  assert.deepEqual(parseIemStateFrame('3:::SETD^a.0.eq.peak.0^0.5'), []); // Not production-integrated.
});
test('GEQ linear math and requested log interpolation are bounded, monotone, precise and explicitly display-centred', () => {
  assert.equal(AUX_EQ_DISPLAY_CENTRES.length, 31); assert.equal(AUX_EQ_DISPLAY_CENTRES[2], 32); assert.equal(AUX_EQ_DISPLAY_CENTRES.at(-1), 20000); assert.ok(Object.isFrozen(AUX_EQ_DISPLAY_CENTRES));
  let previous = -Infinity;
  for (let index = 0; index <= 10000; index++) {
    const db = -15 + 30 * index / 10000, value = auxEqDbToPosition(db);
    assert.ok(value >= previous && value >= 0 && value <= 1); previous = value;
    assert.ok(Math.abs(auxEqPositionToDb(value) - db) < 1e-13);
  }
  for (const value of [NaN, Infinity, '0', -15.001, 15.001]) assert.throws(() => auxEqDbToPosition(value));
  for (const value of [NaN, Infinity, '0', -0.001, 1.001]) assert.throws(() => auxEqPositionToDb(value));
  const mapped = mapRequestedAuxEqCurve(curve()); assert.equal(mapped.basis, 'native-display-centres'); assert.equal(mapped.mode, 'draw'); assert.ok(Object.isFrozen(mapped.values));
  mapped.values.forEach((value, index) => assert.ok(Math.abs(value - Math.log(AUX_EQ_DISPLAY_CENTRES[index] / 20) / Math.log(1000)) < 1e-14));
  assert.deepEqual(mapRequestedAuxEqCurve(curve('points', 0, 0)).values, bands(0.5));
  for (const db of [-15, 15]) assert.deepEqual(mapRequestedAuxEqCurve(curve('draw', db, db)).values, bands(auxEqDbToPosition(db)));
  const atKnot = mapRequestedAuxEqCurve({ mode: 'points', samples: [{ frequencyHz: 20, gainDb: 0 }, { frequencyHz: 32, gainDb: 12 }, { frequencyHz: 20000, gainDb: 0 }] }); assert.equal(auxEqPositionToDb(atKnot.values[2]), 12);
});
test('curve input rejects incomplete/unordered/duplicate/nonfinite/coercive/accessor/out-of-range requests as a whole', () => {
  const invalid = [curve('both'), { mode: 'draw', samples: [] }, { mode: 'draw', samples: Array(258).fill({ frequencyHz: 20, gainDb: 0 }) }, { mode: 'draw', samples: [{ frequencyHz: 21, gainDb: 0 }, { frequencyHz: 20000, gainDb: 0 }] }, { mode: 'draw', samples: [{ frequencyHz: 20, gainDb: 0 }, { frequencyHz: 19999, gainDb: 0 }] }, curve('draw', -15.001, 0), curve('draw', 0, 15.001), curve('draw', NaN, 0), curve('draw', '0', 0), { ...curve(), extra: 1 }];
  for (const samples of [[{ frequencyHz: 20, gainDb: 0 }, { frequencyHz: 20, gainDb: 0 }, { frequencyHz: 20000, gainDb: 0 }], [{ frequencyHz: 20, gainDb: 0 }, { frequencyHz: 1000, gainDb: 0 }, { frequencyHz: 500, gainDb: 0 }, { frequencyHz: 20000, gainDb: 0 }], [{ frequencyHz: '20', gainDb: 0 }, { frequencyHz: 20000, gainDb: 0 }], [{ frequencyHz: 20, gainDb: 0 }, { frequencyHz: Infinity, gainDb: 0 }]]) invalid.push({ mode: 'draw', samples });
  for (const input of invalid) assert.throws(() => mapRequestedAuxEqCurve(input));
  let calls = 0; const input = curve(); Object.defineProperty(input.samples[0], 'gainDb', { get() { calls++; return 0; } }); assert.throws(() => mapRequestedAuxEqCurve(input)); assert.equal(calls, 0);
  const sparse = curve(); delete sparse.samples[0]; assert.throws(() => mapRequestedAuxEqCurve(sparse));
  assert.throws(() => mapRequestedAuxEqCurve(Object.create(curve())));
});
test('mono and reciprocal shifted stereo AUX profiles require all bands/bypass; no averages or invented defaults', () => {
  for (const linked of [false, true]) { const app = fixture(linked), closure = resolveAuxEqTargets(app.context.observations, app.target); assert.equal(closure.members.length, linked ? 62 : 31); assert.equal(new Set(closure.members.map(x => x.path)).size, closure.members.length); assert.ok(Object.isFrozen(closure.members)); }
  const mutations = [m => m.delete('model'), m => m.set('model', 'ui16'), m => m.delete('a.1.matrix'), m => m.set('a.1.matrix', true), m => m.delete('a.1.stereoIndex'), m => m.set('a.0.stereoIndex', 0), m => m.delete('a.2.stereoIndex'), m => m.set('a.3.stereoIndex', 1), m => m.delete('a.2.eq.peak.30'), m => m.set('a.2.eq.peak.30', 0.500000001), m => m.set('a.2.eq.peak.0', false), m => m.delete('a.2.eq.bypass'), m => m.set('a.2.eq.bypass', true)];
  for (const change of mutations) { const app = fixture(true); change(app.context.observations); assert.throws(() => app.guard.arm(app.target)); }
  const zero = fixture(true); for (const aux of [1, 2]) for (let band = 0; band < 31; band++) zero.context.observations.set(`a.${aux}.eq.peak.${band}`, 0); assert.equal(zero.guard.arm(zero.target).count, 62);
  const bypassed = fixture(); bypassed.receive('3:::SETD^a.1.eq.bypass^1'); assert.equal(bypassed.guard.arm(bypassed.target).count, 31); // Editing bands does not unbypass processing.
});
test('explicit EQ plans own copied immutable intent; reset changes only selected bands and no transport exists', () => {
  const app = fixture(true); assert.throws(() => app.guard.prepareReset()); app.guard.arm(app.target);
  const values = bands(0.123456789), plan = app.guard.prepareCurve(values); values.fill(1);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.values)); assert.equal(plan.count, 62);
  const commands = dispatch(app, plan); assert.ok(commands.every(x => x.command.value === 0.123456789 && /^3:::SETD\^a\.[12]\.eq\.peak\.(?:[0-9]|[12][0-9]|30)\^0.123456789$/.test(x.message)));
  assert.equal(app.guard.readback(plan), 'unconfirmed');
  app.guard.arm(app.target); const reset = app.guard.prepareReset(); assert.equal(reset.intent, 'reset-bands'); assert.ok(dispatch(app, reset).every(x => x.command.value === 0.5));
  assert.equal('send' in app.guard, false); assert.equal('socket' in app.guard, false);
});
test('every partial echo in mono/stereo full dispatch remains unconfirmed until all exact fresh path observations', () => {
  for (const linked of [false, true]) {
    const app = fixture(linked); app.guard.arm(app.target); const plan = app.guard.prepareCurve(mapRequestedAuxEqCurve(curve()).values), commands = dispatch(app, plan);
    commands.forEach((grant, index) => { app.receive(grant.message, true); assert.equal(app.guard.readback(plan), index === commands.length - 1 ? 'observed-match' : 'unconfirmed'); });
  }
  const wrong = fixture(); wrong.guard.arm(wrong.target); const plan = wrong.guard.prepareReset(); dispatch(wrong, plan); wrong.receive('3:::SETD^a.1.eq.peak.0^0.6', true); assert.equal(wrong.guard.readback(plan), 'conflict');
});
test('immediate per-path cutpoints reject prepare-time/early-other-path echoes and unrelated receipts', () => {
  const app = fixture(); app.guard.arm(app.target); const plan = app.guard.prepareReset();
  app.receive('3:::SETD^a.1.eq.peak.0^0.5'); app.guard.authorizeNext(plan, 0);
  app.receive('3:::SETD^a.1.eq.peak.0^0.5\nSETD^a.1.eq.peak.1^0.5');
  for (let index = 1; index < 31; index++) app.guard.authorizeNext(plan, index);
  for (let index = 2; index < 31; index++) app.receive(`3:::SETD^a.1.eq.peak.${index}^0.5`);
  assert.equal(app.guard.readback(plan), 'unconfirmed'); app.receive('3:::SETD^a.1.eq.bypass^0\nSETS^i.0.name^Unrelated'); assert.equal(app.guard.readback(plan), 'unconfirmed');
  app.receive('3:::SETD^a.1.eq.peak.1^0.5'); assert.equal(app.guard.readback(plan), 'observed-match');
});
test('selection/generation/processing/native-away-back/open/visibility changes invalidate without remaining authorization', () => {
  const changes = [a => a.context.generation++, a => a.context.revision++, a => a.context.eqRevision++, a => a.context.processingRevision++, a => a.context.selectedAuxIndex = 2, a => a.context.open = false, a => a.context.visible = false, a => a.receive('3:::SETD^a.1.eq.peak.0^0.6\nSETD^a.1.eq.peak.0^0.5'), a => a.receive('3:::SETD^a.1.eq.bypass^1\nSETD^a.1.eq.bypass^0'), a => a.receive('3:::SETD^a.1.matrix^1')];
  for (const change of changes) { const app = fixture(); app.guard.arm(app.target); const plan = app.guard.prepareReset(); app.guard.authorizeNext(plan, 0); change(app); assert.throws(() => app.guard.authorizeNext(plan, 1)); assert.equal(app.guard.readback(plan), 'invalidated'); }
  const mismatch = fixture(); assert.throws(() => mismatch.guard.arm({ auxIndex: 2 }));
});
test('foreign/superseded/reordered/replayed/partial/malformed receipt plans cannot grant or confirm authority', () => {
  for (const action of ['clone', 'foreign', 'skip', 'replay', 'supersede', 'bad-prepare']) {
    const app = fixture(); app.guard.arm(app.target); const plan = app.guard.prepareReset();
    if (action === 'replay') app.guard.authorizeNext(plan, 0);
    if (action === 'supersede') app.guard.prepareReset();
    if (action === 'bad-prepare') assert.throws(() => app.guard.prepareCurve(bands(NaN)));
    assert.throws(() => app.guard.authorizeNext(action === 'clone' ? { ...plan } : action === 'foreign' ? {} : plan, action === 'skip' ? 1 : 0));
  }
  const partial = fixture(); partial.guard.arm(partial.target); const p = partial.guard.prepareReset(); partial.guard.authorizeNext(p, 0); partial.receive('3:::SETD^a.1.eq.peak.0^0.5'); assert.equal(partial.guard.readback(p), 'invalidated'); assert.throws(() => partial.guard.authorizeNext(p, 1));
  for (const receipt of [undefined, NaN, -1, Infinity, '1']) { const app = fixture(); app.guard.arm(app.target); const plan = app.guard.prepareReset(); dispatch(app, plan); app.context.receipts.set('a.1.eq.peak.0', receipt); assert.equal(app.guard.readback(plan), 'invalidated'); }
});
test('readback rejects changed topology/bypass/processing or missing bands even if caller omits native revision', () => {
  for (const mutate of [m => m.set('a.1.matrix', true), m => m.set('a.2.eq.bypass', true), m => m.delete('a.2.eq.peak.5'), m => m.set('a.2.stereoIndex', -1)]) {
    const app = fixture(true); app.guard.arm(app.target); const plan = app.guard.prepareReset(); dispatch(app, plan); mutate(app.context.observations); assert.equal(app.guard.readback(plan), 'conflict');
  }
  const app = fixture(); app.guard.arm(app.target); const plan = app.guard.prepareReset(); dispatch(app, plan); app.context.processingRevision++; assert.equal(app.guard.readback(plan), 'invalidated');
});
test('EQ modules remain unwired from production sessions/entry, with no options upgrade or vendor dependency', async () => {
  for (const file of ['src/iem/live-entry.js', 'src/iem/session-core.js', 'src/iem/aux-control-session.js', 'src/iem/live-view.js']) assert.doesNotMatch(await readFile(new URL('../' + file, import.meta.url), 'utf8'), /aux-eq-(?:protocol|safety|curve)/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')); assert.equal(pkg.dependencies['dissect.extfs'], undefined);
});

test('valid endpoint and near-limit curves never fail from floating roundoff; genuine out-of-range samples still reject', () => {
  const regression = mapRequestedAuxEqCurve(curve('draw', -14.88, 15));
  assert.equal(regression.values.at(-1), 1); assert.equal(regression.values[0], auxEqDbToPosition(-14.88));
  for (let index = 0; index <= 10000; index++) {
    const value = -15 + index * 30 / 10000;
    for (const [left, right] of [[value, 15], [15, value], [value, -15], [-15, value]]) {
      const mapped = mapRequestedAuxEqCurve(curve('draw', left, right));
      assert.equal(mapped.values[0], auxEqDbToPosition(left)); assert.equal(mapped.values.at(-1), auxEqDbToPosition(right));
      assert.ok(mapped.values.every(position => Number.isFinite(position) && position >= 0 && position <= 1));
    }
  }
  for (const invalid of [-15 - 1e-12, 15 + 1e-12]) assert.throws(() => mapRequestedAuxEqCurve(curve('draw', 0, invalid)));
});
