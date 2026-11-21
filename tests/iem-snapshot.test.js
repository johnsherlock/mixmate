import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { SNAPSHOT_LIMITS, checkSnapshotName, encodeSnapshotListCommand, encodeSnapshotRecallCommand, encodeSnapshotSaveCommand, parseSnapshotCompanionFrame, parseSnapshotWriterFrame } from '../src/iem/snapshot-protocol.js';

const MASTER = { kind: 'master', auxIndex: 0 };
const SECRET = 'hunter2-lock';
const BASE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETS^var.currentShow^Default\nSETS^var.currentSnapshot^MixMate1\nSETS^settings.block.pass^\nSETD^settings.block.loadshows^1\nSETD^settings.block.shows^0';
const LIST = '3:::SNAPSHOTLIST^Default^* Init *^AIC^MixMate1^MixMate2^^NSLYA';
function fixture(factory = createAuxControlSession, init = BASE) {
  const sockets = [], jobs = new Map(); let time = 0, next = 0;
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval(fn) { const id = ++next; jobs.set(id, { fn, at: Infinity }); return id; }, clearInterval(id) { jobs.delete(id); } };
  class Socket {
    readyState = 0; sent = []; hook = null;
    constructor() { sockets.push(this); }
    send(message) { if (this.fail) throw Error('boom'); this.sent.push(message); this.hook?.(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => time, wallNow: () => time });
  const f = { session, sockets, jobs, advance(ms) { time += ms; for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); } } };
  session.connect('192.168.0.60');
  f.writer = sockets[0]; f.receiver = sockets[1] ?? null;
  f.writer.open(); f.receiver?.open(); (f.receiver ?? f.writer).receive(init);
  return f;
}
const snaps = f => f.session.snapshot().snapshots;
const listed = f => { assert.equal(f.session.requestSnapshotList().ok, true); f.writer.receive(LIST); assert.equal(snaps(f).list.status, 'fresh'); return f; };
const snapshotWrites = socket => socket.sent.filter(x => !['3:::INIT', '3:::ALIVE', '2::'].includes(x));

test('serializers produce exactly the three allowed forms and validate strictly', () => {
  assert.equal(encodeSnapshotListCommand('Default'), '3:::SNAPSHOTLIST^Default');
  assert.equal(encodeSnapshotRecallCommand('Default', 'MixMate2'), '3:::LOADSNAPSHOT^Default^MixMate2');
  assert.equal(encodeSnapshotSaveCommand('Default', 'MixMate1'), '3:::SAVESNAPSHOT^Default^MixMate1');
  assert.equal(encodeSnapshotRecallCommand('Default', 'IMGL Harbour Bar'), '3:::LOADSNAPSHOT^Default^IMGL Harbour Bar'); // sent exactly as received
  for (const bad of ['', '  ', 'a^b', 'a\nb', 'a\rb', 'a\u0000b', 'a\u0085b', 'a b', 'x'.repeat(SNAPSHOT_LIMITS.nameChars + 1), '\ud800', 5, null, undefined, {}, ['a']]) {
    assert.equal(checkSnapshotName(bad).ok, false, JSON.stringify(bad));
    assert.throws(() => encodeSnapshotRecallCommand('Default', bad));
    assert.throws(() => encodeSnapshotSaveCommand('Default', bad));
  }
  assert.equal(checkSnapshotName('x'.repeat(SNAPSHOT_LIMITS.nameChars)).ok, true);
  assert.equal(checkSnapshotName('é'.repeat(SNAPSHOT_LIMITS.nameChars)).ok, true);
  for (const init of ['* Init *', ' * init * ']) { assert.throws(() => encodeSnapshotRecallCommand('Default', init), /Init/); assert.throws(() => encodeSnapshotSaveCommand('Default', init), /Init/); }
  for (const show of ['', 'a^b', 'a\nb', null, undefined]) assert.throws(() => encodeSnapshotListCommand(show));
  assert.throws(() => encodeSnapshotRecallCommand('Default'));
});

test('writer and companion parsers are narrow and bounded', () => {
  assert.deepEqual(parseSnapshotWriterFrame(LIST).map(e => [e.type, e.show, e.names]), [['list', 'Default', ['* Init *', 'AIC', 'MixMate1', 'MixMate2', 'NSLYA']]]);
  assert.deepEqual(parseSnapshotWriterFrame('3:::MSG^$SNAPLOAD^MixMate2'), [{ type: 'snapload', name: 'MixMate2' }]);
  assert.deepEqual(parseSnapshotWriterFrame('3:::MSG^$OTHER^x\nSHOWLIST^Default\nCUELIST^Default^x\nSETS^var.currentSnapshot^x'), []);
  assert.deepEqual(parseSnapshotWriterFrame('2::'), []); assert.deepEqual(parseSnapshotWriterFrame(5), []);
  const many = parseSnapshotWriterFrame(`3:::SNAPSHOTLIST^Default^${Array.from({ length: 400 }, (_, i) => `S${i}`).join('^')}`)[0];
  assert.equal(many.names.length, SNAPSHOT_LIMITS.listCount); assert.equal(many.truncated, true);
  const dropped = parseSnapshotWriterFrame(`3:::SNAPSHOTLIST^Default^${'x'.repeat(65)}^ok^ok^bad\u0001name`)[0];
  assert.deepEqual(dropped.names, ['ok']);
  assert.deepEqual(parseSnapshotWriterFrame('3:::SNAPSHOTLIST^^a^b'), []);
  assert.deepEqual(parseSnapshotWriterFrame(`3:::MSG^$SNAPLOAD^${'x'.repeat(65)}`), []);
  assert.deepEqual(parseSnapshotWriterFrame(`3:::SNAPSHOTLIST^Default^${'a^'.repeat(40000)}`).length, 0, 'an over-long list line is skipped');
  const companion = parseSnapshotCompanionFrame(BASE);
  assert.deepEqual(companion, { updateShows: false, show: 'Default', passSet: false, loadshows: true, shows: false });
  assert.deepEqual(parseSnapshotCompanionFrame('3:::UPDATE_SHOWS'), { updateShows: true });
  assert.deepEqual(parseSnapshotCompanionFrame(`3:::SETS^settings.block.pass^${SECRET}\nSETD^settings.block.shows^2\nSETD^var.currentShow^x`), { updateShows: false, passSet: true });
  assert.ok(!JSON.stringify(parseSnapshotCompanionFrame(`3:::SETS^settings.block.pass^${SECRET}`)).includes(SECRET));
});

test('only the literal control factory has the snapshot API; read-only, level-only and the companion never send these forms', () => {
  for (const factory of [createReadOnlySession, createAuxLevelSession]) {
    const f = fixture(factory, BASE);
    for (const name of ['requestSnapshotList', 'recallSnapshot', 'saveCurrentSnapshot']) assert.equal(f.session[name], undefined);
    assert.equal(f.session.snapshot().snapshots, undefined);
    f.writer.receive(LIST); f.writer.receive('3:::MSG^$SNAPLOAD^MixMate1');
    for (const s of f.sockets) assert.deepEqual(snapshotWrites(s), []);
    f.session.disconnect();
  }
  const f = listed(fixture());
  assert.equal(f.session.recallSnapshot('MixMate2').ok, true); f.writer.receive('3:::MSG^$SNAPLOAD^MixMate2');
  assert.ok(f.receiver.sent.every(m => ['3:::INIT', '3:::ALIVE', '2::'].includes(m)), 'the receive-only companion sends only INIT/ALIVE/heartbeat');
  assert.deepEqual(snapshotWrites(f.writer), ['3:::SNAPSHOTLIST^Default', '3:::LOADSNAPSHOT^Default^MixMate2']);
  f.session.disconnect();
});

test('list request: writer-only reply feeds the list, never mixer observations; unsolicited and other-show replies are ignored', () => {
  const f = fixture(); const before = f.session.snapshot().observations.size;
  assert.equal(snaps(f).list.status, 'none'); assert.equal(snaps(f).show, 'Default'); assert.equal(snaps(f).current, 'MixMate1');
  f.writer.receive(LIST); assert.equal(snaps(f).list.status, 'none', 'unsolicited list ignored');
  assert.equal(f.session.requestSnapshotList().ok, true); assert.equal(snaps(f).list.status, 'pending');
  assert.equal(f.session.requestSnapshotList().code, 'busy');
  f.writer.receive('3:::SNAPSHOTLIST^Other^A^B'); assert.equal(snaps(f).list.status, 'pending');
  f.receiver.receive(LIST); assert.equal(snaps(f).list.status, 'pending', 'the companion never feeds the list');
  f.writer.receive(LIST + '\nSETD^a.0.mix^0.9');
  assert.equal(snaps(f).list.status, 'fresh'); assert.deepEqual(snaps(f).list.names, ['AIC', 'MixMate1', 'MixMate2', 'NSLYA'], 'Init is not offered');
  assert.equal(f.session.snapshot().observations.get('a.0.mix'), 0.4); assert.equal(f.session.snapshot().observations.size, before + 0);
  assert.deepEqual(snapshotWrites(f.writer), ['3:::SNAPSHOTLIST^Default']);
  // A request that gets no reply times out and may be repeated.
  const g = fixture(); g.session.requestSnapshotList(); g.advance(5000); assert.equal(snaps(g).list.status, 'none'); assert.equal(g.session.requestSnapshotList().ok, true);
  f.session.disconnect(); g.session.disconnect();
});

test('recall: validation, list membership, Init exclusion, exact form and no retry', () => {
  const f = fixture();
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'no-list'); assert.equal(f.session.saveCurrentSnapshot().code, 'no-list');
  listed(f);
  const refusals = [[ 'MixMate3', 'not-in-list'], ['mixmate2', 'not-in-list'], ['* Init *', 'init-entry'], ['a^b', 'invalid-name'], ['', 'invalid-name'], ['a\nb', 'invalid-name'], ['x'.repeat(65), 'invalid-name'], [null, 'invalid-name'], [{ toString: () => 'MixMate2' }, 'invalid-name']];
  for (const [name, code] of refusals) assert.equal(f.session.recallSnapshot(name).code, code, String(name));
  assert.deepEqual(snapshotWrites(f.writer), ['3:::SNAPSHOTLIST^Default']);
  const result = f.session.recallSnapshot('MixMate2'); assert.deepEqual(result, { ok: true, kind: 'recall', name: 'MixMate2' });
  assert.equal(f.session.recallSnapshot('AIC').code, 'busy', 'one outstanding operation');
  assert.equal(f.session.saveCurrentSnapshot().code, 'busy');
  f.advance(60000);
  assert.deepEqual(snapshotWrites(f.writer), ['3:::SNAPSHOTLIST^Default', '3:::LOADSNAPSHOT^Default^MixMate2'], 'no retry or replay');
  assert.deepEqual(snapshotWrites(f.receiver), []);
  f.session.disconnect();
});

test('recall outcomes: MSG^$SNAPLOAD on the writer, var.currentSnapshot on the companion, re-recall of the current snapshot, unconfirmed after 5 s', () => {
  let f = listed(fixture());
  f.session.recallSnapshot('MixMate2'); assert.equal(snaps(f).operation.status, 'pending');
  f.writer.receive('3:::MSG^$SNAPLOAD^MixMate1'); assert.equal(snaps(f).operation.status, 'pending', 'another name does not confirm');
  f.receiver.receive('3:::MSG^$SNAPLOAD^MixMate2'); assert.equal(snaps(f).operation.status, 'pending', 'MSG counts only from the writer');
  f.writer.receive('3:::MSG^$SNAPLOAD^MixMate2');
  assert.equal(snaps(f).operation.status, 'confirmed'); assert.match(snaps(f).operation.text, /desk reported/);
  f.receiver.receive('3:::UPDATE_SHOWS\nSETS^var.currentSnapshot^MixMate2'); assert.equal(snaps(f).current, 'MixMate2'); assert.equal(snaps(f).list.status, 'stale');
  assert.equal(f.session.recallSnapshot('MixMate1').code, 'stale-list', 'a stale list needs a refresh first');
  assert.equal(snaps(f).operation.status, 'confirmed');
  f.session.disconnect();
  // Companion currentSnapshot change confirms without any MSG.
  f = listed(fixture()); f.session.recallSnapshot('MixMate2'); f.advance(400); f.receiver.receive('3:::SETS^var.currentSnapshot^MixMate2\nUPDATE_SHOWS');
  assert.equal(snaps(f).operation.status, 'confirmed'); f.advance(10000); assert.equal(snaps(f).operation.status, 'confirmed', 'a late timer cannot change a settled outcome'); f.session.disconnect();
  // Re-recall of the already-current snapshot: only MSG + UPDATE_SHOWS arrive, no currentSnapshot change.
  f = listed(fixture()); f.session.recallSnapshot('MixMate1'); f.receiver.receive('3:::UPDATE_SHOWS'); assert.equal(snaps(f).operation.status, 'pending', 'UPDATE_SHOWS alone does not confirm a recall');
  f.writer.receive('3:::MSG^$SNAPLOAD^MixMate1'); assert.equal(snaps(f).operation.status, 'confirmed'); f.session.disconnect();
  // The desk never reports.
  f = listed(fixture()); f.session.recallSnapshot('MixMate2'); f.advance(4999); assert.equal(snaps(f).operation.status, 'pending'); f.advance(1);
  assert.equal(snaps(f).operation.status, 'unconfirmed'); assert.match(snaps(f).operation.text, /did not report/);
  f.writer.receive('3:::MSG^$SNAPLOAD^MixMate2'); assert.equal(snaps(f).operation.status, 'unconfirmed', 'a late report cannot revise it');
  assert.equal(snapshotWrites(f.writer).filter(x => x.startsWith('3:::LOADSNAPSHOT')).length, 1);
  f.session.disconnect();
});

test('save-current: only the received current snapshot, reported by UPDATE_SHOWS within 3 s, honest wording', () => {
  let f = fixture(); f.receiver.receive('3:::SETD^settings.block.shows^1'); listed(f);
  assert.deepEqual(f.session.saveCurrentSnapshot(), { ok: true, kind: 'save', name: 'MixMate1' });
  assert.deepEqual(snapshotWrites(f.writer).at(-1), '3:::SAVESNAPSHOT^Default^MixMate1');
  f.writer.receive('3:::UPDATE_SHOWS'); assert.equal(snaps(f).operation.status, 'pending', 'the writer is not the broadcast path');
  f.receiver.receive('3:::UPDATE_SHOWS');
  assert.equal(snaps(f).operation.status, 'reported'); assert.match(snaps(f).operation.text, /does not prove the snapshot contents/); assert.doesNotMatch(snaps(f).operation.text, /saved successfully|acknowledged/i);
  f.session.disconnect();
  f = fixture(); f.receiver.receive('3:::SETD^settings.block.shows^1'); listed(f); f.session.saveCurrentSnapshot(); f.advance(2999); assert.equal(snaps(f).operation.status, 'pending'); f.advance(1);
  assert.equal(snaps(f).operation.status, 'unconfirmed'); f.receiver.receive('3:::UPDATE_SHOWS'); assert.equal(snaps(f).operation.status, 'unconfirmed');
  f.session.disconnect();
  // The current snapshot must be a listed, non-Init name; no new names are ever saved.
  f = fixture(); f.receiver.receive('3:::SETD^settings.block.shows^1\nSETS^var.currentSnapshot^NotListed'); listed(f);
  assert.equal(f.session.saveCurrentSnapshot().code, 'not-in-list');
  f.receiver.receive('3:::SETS^var.currentSnapshot^* Init *'); assert.equal(f.session.saveCurrentSnapshot().code, 'init-entry');
  f.receiver.receive('3:::SETS^var.currentSnapshot^a^b'); assert.equal(f.session.saveCurrentSnapshot().code, 'no-current');
  assert.equal(snapshotWrites(f.writer).some(x => x.startsWith('3:::SAVESNAPSHOT')), false);
  f.session.disconnect();
});

test('a show change or UPDATE_SHOWS invalidates the list; a reply in flight during UPDATE_SHOWS is stale', () => {
  let f = listed(fixture()); f.receiver.receive('3:::UPDATE_SHOWS'); assert.equal(snaps(f).list.status, 'stale');
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'stale-list'); f.session.requestSnapshotList(); f.writer.receive(LIST); assert.equal(snaps(f).list.status, 'fresh');
  assert.equal(f.session.recallSnapshot('MixMate2').ok, true); f.session.disconnect();
  f = fixture(); f.session.requestSnapshotList(); f.receiver.receive('3:::UPDATE_SHOWS'); f.writer.receive(LIST); assert.equal(snaps(f).list.status, 'stale');
  f.session.disconnect();
  f = listed(fixture()); f.receiver.receive('3:::SETS^var.currentShow^Other'); assert.equal(snaps(f).list.status, 'none'); assert.equal(f.session.recallSnapshot('MixMate2').code, 'no-list');
  f.receiver.receive('3:::SETS^var.currentShow^'); assert.equal(snaps(f).show, null); assert.equal(f.session.requestSnapshotList().code, 'no-show');
  f.session.disconnect();
  f = fixture(createAuxControlSession, BASE.replace('SETS^var.currentShow^Default\n', '')); assert.equal(f.session.requestSnapshotList().code, 'no-show'); assert.equal(f.session.recallSnapshot('MixMate2').code, 'no-show');
  assert.deepEqual(snapshotWrites(f.writer), []); f.session.disconnect();
});

test('desk locks: pass unset allows, set requires the matching flag, unknown refuses, the pass value is never exposed', () => {
  const ready = block => { const f = fixture(createAuxControlSession, BASE.replace(/SETS\^settings\.block\.pass\^\nSETD\^settings\.block\.loadshows\^1\nSETD\^settings\.block\.shows\^0/, block)); return listed(f); };
  let f = ready('SETS^settings.block.pass^\nSETD^settings.block.loadshows^0\nSETD^settings.block.shows^0');
  assert.equal(f.session.recallSnapshot('MixMate2').ok, true, 'no password means no lock'); f.writer.receive('3:::MSG^$SNAPLOAD^MixMate2'); assert.equal(f.session.saveCurrentSnapshot().ok, true, 'no password means no lock for save either'); f.session.disconnect();
  f = ready(`SETS^settings.block.pass^${SECRET}\nSETD^settings.block.loadshows^1\nSETD^settings.block.shows^0`);
  assert.equal(f.session.saveCurrentSnapshot().code, 'locked'); assert.match(f.session.saveCurrentSnapshot().reason, /Locked on the desk/);
  assert.equal(f.session.recallSnapshot('MixMate2').ok, true);
  const dump = JSON.stringify([f.session.snapshot().snapshots, [...f.session.snapshot().observations], f.session.saveCurrentSnapshot(), f.session.recallSnapshot('x')]);
  assert.ok(!dump.includes(SECRET)); f.session.disconnect();
  f = ready(`SETS^settings.block.pass^${SECRET}\nSETD^settings.block.loadshows^0\nSETD^settings.block.shows^1`);
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'locked'); assert.equal(f.session.saveCurrentSnapshot().ok, true); assert.deepEqual(snaps(f).lock, { recall: 'locked', save: 'allowed' }); f.session.disconnect();
  f = ready(`SETS^settings.block.pass^${SECRET}`);
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'lock-unknown'); assert.equal(f.session.saveCurrentSnapshot().code, 'lock-unknown'); f.session.disconnect();
  f = ready('SETD^settings.block.loadshows^1');
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'lock-unknown', 'missing pass state is unknown, not unlocked'); assert.deepEqual(snaps(f).lock, { recall: 'unknown', save: 'unknown' });
  f.receiver.receive('3:::SETS^settings.block.pass^'); assert.equal(f.session.recallSnapshot('MixMate2').ok, true);
  f.session.disconnect();
});

test('no snapshot operation while a gesture is active or an own control send is pending; the drag is not cancelled', () => {
  const f = listed(fixture());
  f.session.selectLevelTarget(MASTER); const token = f.session.beginLevelGesture(); assert.ok(token);
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'gesture'); assert.equal(f.session.requestSnapshotList().code, 'gesture'); assert.equal(f.session.saveCurrentSnapshot().code, 'gesture');
  assert.equal(f.session.snapshot().control.gestureActive, true);
  assert.equal(f.session.commitLevelGesture(token, 0.5), true);
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'pending', 'own send awaiting the desk report');
  f.receiver.receive('3:::SETD^a.0.mix^0.5\nSETD^a.1.mix^0.5');
  assert.equal(f.session.recallSnapshot('MixMate2').ok, true);
  assert.equal(snapshotWrites(f.writer).filter(x => x.startsWith('3:::LOADSNAPSHOT')).length, 1);
  f.session.disconnect();
});

test('not ready: nothing before qualification, hidden, or with a closed socket', () => {
  const f = fixture(createAuxControlSession, '3:::SETS^var.currentShow^Default'); // not a Ui24 AUX state: never qualified
  assert.equal(f.session.requestSnapshotList().code, 'not-ready');
  f.receiver.receive(BASE); listed(f);
  f.receiver.readyState = 3; assert.equal(f.session.recallSnapshot('MixMate2').code, 'not-ready');
  assert.deepEqual(snapshotWrites(f.writer), ['3:::SNAPSHOTLIST^Default']); f.session.disconnect();
  const g = createAuxControlSession(); assert.equal(g.requestSnapshotList().code, 'not-ready');
});

test('disconnect, close or send failure while outstanding gives unknown, clears state and never replays', () => {
  for (const how of ['disconnect', 'writer-close', 'receiver-error', 'idle']) {
    const f = listed(fixture()); f.session.recallSnapshot('MixMate2');
    if (how === 'disconnect') f.session.disconnect(); else if (how === 'writer-close') f.writer.onclose(); else if (how === 'receiver-error') f.receiver.onerror(); else { f.advance(40000); }
    const s = snaps(f);
    assert.equal(s.operation.status, 'unknown', how); assert.match(s.operation.text, /outcome is unknown/); assert.equal(s.operation.name, 'MixMate2');
    assert.equal(s.list.status, 'none'); assert.equal(s.show, null); assert.equal(s.current, null);
    assert.equal(f.session.recallSnapshot('MixMate2').code, 'not-ready');
    f.advance(60000); assert.equal(snapshotWrites(f.writer).filter(x => x.startsWith('3:::LOADSNAPSHOT')).length, 1); assert.equal(f.sockets.length, 2);
    f.session.connect('192.168.0.60'); assert.equal(snaps(f).operation, null, 'a new explicit connection starts clean'); f.session.disconnect();
  }
  const f = listed(fixture()); f.writer.fail = true;
  assert.equal(f.session.recallSnapshot('MixMate2').code, 'send-failed'); assert.equal(f.session.snapshot().phase, 'error'); assert.equal(snaps(f).operation.status, 'unknown');
  // A completed outcome is not retained across a stop; only an outstanding one becomes unknown.
  const g = listed(fixture()); g.session.recallSnapshot('MixMate2'); g.writer.receive('3:::MSG^$SNAPLOAD^MixMate2'); g.session.disconnect(); assert.equal(snaps(g).operation, null);
});

test('a synchronous desk reply during send settles the operation and old callbacks cannot touch a new connection', () => {
  const f = listed(fixture()); f.writer.hook = m => { if (m.startsWith('3:::LOADSNAPSHOT')) f.writer.receive('3:::MSG^$SNAPLOAD^MixMate2'); };
  f.session.recallSnapshot('MixMate2'); assert.equal(snaps(f).operation.status, 'confirmed'); f.advance(6000); assert.equal(snaps(f).operation.status, 'confirmed');
  const oldWriter = f.writer.onmessage; f.session.disconnect(); f.session.connect('192.168.0.60'); f.sockets[2].open(); f.sockets[3].open(); f.sockets[3].receive(BASE);
  oldWriter({ data: LIST }); f.sockets[2].receive(LIST); assert.equal(snaps(f).list.status, 'none', 'no pending request; stale socket ignored');
  f.session.disconnect();
});
