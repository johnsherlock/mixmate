import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame, receivedIemField, receivedAuxMode, stereoRelationship, observedAuxSources } from '../src/iem/protocol.js';
const fixture = JSON.parse(await readFile(new URL('./fixtures/iem-state.json', import.meta.url), 'utf8'));
const snapshot = frame => new Map(parseIemStateFrame(frame).map(update => [update.path, update.value]));

test('synthetic source-backed fixture yields typed observations without inventing missing state', () => {
  assert.equal(fixture.provenance.kind, 'synthetic');
  const updates = parseIemStateFrame(fixture.frame);
  assert.equal(updates.length, 25);
  assert.deepEqual(updates.find(u => u.path === 'a.0.mix'), { kind: 'aux', auxIndex: 0, field: 'level', path: 'a.0.mix', value: 0.25 });
  assert.deepEqual(updates.find(u => u.path === 'l.1.aux.0.value'), { kind: 'send', sourceId: 'l.1', sourceType: 'line', sourceIndex: 1, auxIndex: 0, field: 'level', path: 'l.1.aux.0.value', value: 0.125 });
  const state = snapshot(fixture.frame);
  assert.deepEqual(receivedIemField(state, 'i.0.aux.0.value'), { received: true, value: 0 });
  assert.deepEqual(receivedIemField(state, 'i.0.aux.0.post'), { received: true, value: false });
  assert.deepEqual(receivedIemField(state, 'a.1.mix'), { received: false });
  assert.equal(state.get('a.0.name'), 'AUX <A> ^ Monitor');
  assert.equal(state.get('i.0.name'), 'Input <one> ^ literal');
});

test('zero, false, empty names, Unicode and repeated updates retain received presence and order', () => {
  const updates = parseIemStateFrame('3:::SETS^i.0.name^\nSETS^i.0.name^🎸 ^ <script>\nSETD^i.0.aux.0.value^0\nSETD^i.0.aux.0.value^1\nSETD^a.0.matrix^0');
  assert.deepEqual(updates.map(u => u.value), ['', '🎸 ^ <script>', 0, 1, false]);
  assert.deepEqual(receivedIemField(snapshot('3:::SETS^i.0.name^'), 'i.0.name'), { received: true, value: '' });
  assert.deepEqual(parseIemStateFrame('3:::SETD^a.9.mix^1\r\nSETD^a.9.mute^0\r\n').map(u => u.value), [1, false]);
});

test('parser rejects wrong commands, unrelated writes, malformed numbers and prototype paths', () => {
  const invalid = ['SETS^a.0.mix^0.5', 'SETD^a.0.name^1', 'SETD^a.0.mix^', 'SETD^a.0.mix^ ', 'SETD^a.0.mix^NaN', 'SETD^a.0.mix^Infinity', 'SETD^a.0.mix^0x1', 'SETD^a.0.mix^true', 'SETD^a.0.mix^1.01', 'SETD^a.0.mix^-0.01', 'SETD^a.0.mute^2', 'SETD^i.0.aux.0.post^0.5', 'SETD^a.0.stereoIndex^2', 'SETD^i.0.mix^0.5', 'SETD^m.mix^0.5', 'SETD^a.0.gain^1', 'SETD^i.0.aux.0.__proto__^1', 'SETS^__proto__^x', 'SETS^i.0.name.__proto__^x', 'BMSG^a.0.mix^0.5'];
  assert.deepEqual(parseIemStateFrame('3:::' + invalid.join('\n')), []);
  for (const value of [null, undefined, 42, {}, 'SETD^a.0.mix^0.5', '2::']) assert.deepEqual(parseIemStateFrame(value), []);
  assert.equal({}.polluted, undefined);
});

test('all finite numeric values are constrained to their field domain', () => {
  const frame = '3:::SETD^a.0.mix^1e-2\nSETD^i.23.aux.9.pan^ 0.75 \nSETD^a.0.stereoIndex^-1\nSETD^p.1.aux.9.postproc^1.0\nSETD^a.0.mix^1e309';
  assert.deepEqual(parseIemStateFrame(frame).map(u => u.value), [0.01, 0.75, -1, true]);
});

test('source and output indices are bounded and canonical, including every supported category', () => {
  const accepted = ['i.23', 'l.1', 'p.1', 'f.3'];
  for (const id of accepted) assert.equal(parseIemStateFrame(`3:::SETD^${id}.aux.9.value^0.5`).length, 1);
  const rejected = ['i.24', 'l.2', 'p.2', 'f.4', 's.0', 'v.0', 'i.-1', 'i.00', 'i.1.0', 'a.0'];
  for (const id of rejected) assert.deepEqual(parseIemStateFrame(`3:::SETD^${id}.aux.0.value^0.5`), []);
  for (const line of ['SETD^a.10.mix^0.5', 'SETD^a.00.mix^0.5', 'SETD^i.0.aux.10.value^0.5', 'SETD^i.0.aux.00.value^0.5', 'SETD^f.0.stereoIndex^-1']) assert.deepEqual(parseIemStateFrame(`3:::${line}`), []);
});

test('frame byte and line-count limits reject the entire frame instead of partial initialization', () => {
  assert.deepEqual(parseIemStateFrame('3:::SETS^i.0.name^' + 'x'.repeat(IEM_RECEIVE_LIMITS.frameBytes)), []);
  assert.deepEqual(parseIemStateFrame('3:::SETD^a.0.mix^0.5\n' + '\n'.repeat(IEM_RECEIVE_LIMITS.lines)), []);
  // UTF-8 bytes, not JavaScript code units, determine the bound.
  assert.deepEqual(parseIemStateFrame('3:::' + '🎸'.repeat(IEM_RECEIVE_LIMITS.frameBytes / 3)), []);
});

test('oversized lines/names/metadata are isolated without truncating accepted names', () => {
  const frame = '3:::SETS^i.0.name^' + 'x'.repeat(IEM_RECEIVE_LIMITS.nameBytes + 1) + '\nSETS^i.1.name^' + 'é'.repeat(IEM_RECEIVE_LIMITS.nameBytes / 2 + 1) + '\nSETS^firmware^' + 'x'.repeat(IEM_RECEIVE_LIMITS.metadataBytes + 1) + '\nSETS^a.0.name^' + 'x'.repeat(IEM_RECEIVE_LIMITS.lineBytes) + '\nSETD^a.0.mix^0.5';
  assert.deepEqual(parseIemStateFrame(frame).map(u => u.path), ['a.0.mix']);
  const boundary = 'é'.repeat(IEM_RECEIVE_LIMITS.nameBytes / 2);
  assert.equal(parseIemStateFrame('3:::SETS^i.0.name^' + boundary)[0].value, boundary);
});

test('matrix/aux/unknown mode are separate observations, not a default AUX assumption', () => {
  const state = snapshot('3:::SETD^a.0.matrix^0\nSETD^a.1.matrix^1');
  assert.deepEqual(receivedAuxMode(state, 0), { received: true, value: 'aux' });
  assert.deepEqual(receivedAuxMode(state, 1), { received: true, value: 'matrix' });
  assert.deepEqual(receivedAuxMode(state, 2), { received: false });
  for (const invalid of [-1, 10, 0.5, '0']) assert.deepEqual(receivedAuxMode(state, invalid), { received: false });
});

test('reciprocal current-snapshot stereo metadata is required independently for source and output', () => {
  const state = snapshot('3:::SETD^i.0.stereoIndex^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.2\nSETD^a.1.mix^0.8');
  assert.deepEqual(stereoRelationship(state, 'i.0'), { status: 'unknown' });
  assert.deepEqual(stereoRelationship(state, 'a.0'), { status: 'linked', members: ['a.0', 'a.1'] });
  assert.deepEqual(stereoRelationship(state, 'a.1'), { status: 'linked', members: ['a.0', 'a.1'] });
  assert.equal(state.get('a.0.mix'), 0.2); assert.equal(state.get('a.1.mix'), 0.8);
  state.set('i.1.stereoIndex', 1);
  assert.deepEqual(stereoRelationship(state, 'i.0'), { status: 'linked', members: ['i.0', 'i.1'] });
  assert.deepEqual(stereoRelationship(new Map(), 'a.0'), { status: 'unknown' });
  assert.deepEqual(stereoRelationship(new Map(), 'i.0'), { status: 'unknown' });
});

test('missing, conflicting and boundary link metadata never silently become mono or cross families', () => {
  const state = snapshot('3:::SETD^i.0.stereoIndex^0\nSETD^i.1.stereoIndex^-1\nSETD^l.0.stereoIndex^0\nSETD^p.1.stereoIndex^1\nSETD^a.9.stereoIndex^0\nSETD^i.23.stereoIndex^0\nSETD^p.0.stereoIndex^1');
  assert.deepEqual(stereoRelationship(state, 'i.0'), { status: 'conflict' });
  assert.deepEqual(stereoRelationship(state, 'i.1'), { status: 'conflict' });
  assert.deepEqual(stereoRelationship(snapshot('3:::SETD^i.1.stereoIndex^-1'), 'i.1'), { status: 'mono', members: ['i.1'] });
  assert.deepEqual(stereoRelationship(state, 'l.0'), { status: 'unknown' });
  for (const id of ['a.9', 'i.23', 'p.0']) assert.deepEqual(stereoRelationship(state, id), { status: 'conflict' });
  assert.deepEqual(stereoRelationship(state, 'i.24'), { status: 'unsupported' });
});

test('FX returns are intrinsic stereo sources from the profile, never adjacent FX links or invented sends', () => {
  const state = snapshot('3:::SETS^f.0.name^Synthetic FX\nSETD^f.0.aux.0.value^0.5');
  assert.deepEqual(stereoRelationship(state, 'f.0'), { status: 'intrinsic-stereo', members: ['f.0'], evidence: 'ui24-library-profile' });
  assert.equal(observedAuxSources(state, 0).length, 1);
  assert.equal(observedAuxSources(state, 0)[0].sourceId, 'f.0');
  assert.deepEqual(parseIemStateFrame('3:::SETD^f.0.stereoIndex^0'), []);
});

test('source discovery uses actual observed sends across all categories, not capacity or names alone', () => {
  const state = snapshot(fixture.frame + '\nSETS^i.23.name^Metadata only\nSETD^i.1.aux.0.mute^0\nSETD^i.2.aux.1.value^0.5');
  const discovered = observedAuxSources(state, 0);
  assert.deepEqual(discovered.map(source => source.sourceId), ['i.0', 'i.1', 'l.1', 'p.0', 'f.3']);
  assert.deepEqual(discovered.find(source => source.sourceId === 'i.1').observedFields, ['mute']);
  assert.deepEqual(receivedIemField(state, 'i.1.aux.0.value'), { received: false });
  assert.deepEqual(observedAuxSources(state, 1).map(source => source.sourceId), ['i.2']);
  assert.deepEqual(observedAuxSources(new Map(), 0), []);
  assert.deepEqual(observedAuxSources(state, 10), []);
});


test('outside claims invalidate both views of a reciprocal link without assuming fixed parity', () => {
  for (const family of ['i', 'a']) {
    const leftOverlap = snapshot(`3:::SETD^${family}.0.stereoIndex^0\nSETD^${family}.1.stereoIndex^0\nSETD^${family}.2.stereoIndex^1`);
    assert.deepEqual(stereoRelationship(leftOverlap, `${family}.1`), { status: 'conflict' });
    assert.deepEqual(stereoRelationship(leftOverlap, `${family}.2`), { status: 'conflict' });
    const rightOverlap = snapshot(`3:::SETD^${family}.0.stereoIndex^0\nSETD^${family}.1.stereoIndex^1\nSETD^${family}.2.stereoIndex^1`);
    assert.deepEqual(stereoRelationship(rightOverlap, `${family}.0`), { status: 'conflict' });
    assert.deepEqual(stereoRelationship(rightOverlap, `${family}.1`), { status: 'conflict' });
    const noOverlap = snapshot(`3:::SETD^${family}.1.stereoIndex^0\nSETD^${family}.2.stereoIndex^1`);
    assert.deepEqual(stereoRelationship(noOverlap, `${family}.1`), { status: 'linked', members: [`${family}.1`, `${family}.2`] });
  }
});
