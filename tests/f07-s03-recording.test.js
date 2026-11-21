import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { encodeRecordingToggleCommand, formatElapsed, parseRecordingCompanionFrame, parseRecordingWriterFrame, recordingRefusalText } from '../src/iem/recording-protocol.js';
import { updateBusy } from '../src/iem/updates.js';

// F07-S03 recording owner: fake sockets and timers only. No desk, browser or network.
const SECRET = 'hunter2-lock';
const TOPOLOGY = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETS^var.currentShow^Default\nSETS^var.currentSnapshot^MixMate1\nSETS^settings.block.pass^\nSETD^settings.block.player^1';
const mtk = ({ present = 1, state = 0, busy = 0, time = 21, freespace = 7000, dropouts = 0, session = '0011' } = {}) =>
  `\nSETD^var.mtk.present^${present}\nSETD^var.mtk.freespace^${freespace}\nSETD^var.mtk.dropouts^${dropouts}\nSETD^var.mtk.rec.currentState^${state}\nSETD^var.mtk.rec.busy^${busy}\nSETD^var.mtk.rec.time^${time}\nSETS^var.mtk.rec.session^${session}`;
const BASE = TOPOLOGY + mtk();
const PLAIN = ['3:::INIT', '3:::ALIVE', '2::'];
function fixture(factory = createAuxControlSession, init = BASE) {
  const sockets = [], jobs = new Map(); let time = 0, next = 0;
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval(fn) { const id = ++next; jobs.set(id, { fn, at: Infinity }); return id; }, clearInterval(id) { jobs.delete(id); } };
  class Socket {
    readyState = 0; sent = [];
    constructor() { sockets.push(this); }
    send(message) { if (this.fail) throw Error('boom'); this.sent.push(message); }
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
const rec = f => f.session.snapshot().recording;
const writes = socket => socket.sent.filter(x => !PLAIN.includes(x));
const TOGGLE = '3:::MTK_REC_TOGGLE';

test('serializer is exactly the toggle and the parsers are narrow and bounded', () => {
  assert.equal(encodeRecordingToggleCommand(), TOGGLE);
  assert.equal(encodeRecordingToggleCommand.length, 0, 'it takes no caller text');
  assert.deepEqual(parseRecordingCompanionFrame(BASE), { player: true, present: 1, freespace: 7000, dropouts: 0, state: 0, busy: 0, time: 21, session: '0011' });
  assert.deepEqual(parseRecordingCompanionFrame('3:::SETD^var.mtk.rec.currentState^1\nSETD^var.mtk.rec.time^3.5'), { state: 1, time: 3.5 });
  // Wrong command, malformed numbers, control characters, overlong and unknown keys are absent (unknown), never defaulted.
  assert.deepEqual(parseRecordingCompanionFrame('3:::SETS^var.mtk.present^1\nSETD^var.mtk.present^x\nSETD^var.mtk.freespace^1e999\nSETD^var.mtk.rec.busy^\nSETD^var.mtk.bufferfill^5\nSETD^var.mtk.session^3'), {});
  assert.deepEqual(parseRecordingCompanionFrame(`3:::SETS^var.mtk.rec.session^${'x'.repeat(65)}\nSETS^var.mtk.rec.session^a\u0001b`), {});
  assert.deepEqual(parseRecordingCompanionFrame('3:::SETD^settings.block.player^2'), {});
  assert.deepEqual(parseRecordingCompanionFrame('3:::SETD^settings.block.player^0'), { player: false });
  assert.deepEqual(parseRecordingCompanionFrame(5), {}); assert.deepEqual(parseRecordingCompanionFrame('2::'), {});
  assert.ok(!JSON.stringify(parseRecordingCompanionFrame(`3:::SETS^settings.block.pass^${SECRET}`)).includes(SECRET));
  assert.deepEqual(parseRecordingWriterFrame('3:::MSG^$REC_ERRNOSTICK\nSETD^var.mtk.rec.time^0\nDLGSHOW^usb_rec^$REC_ERRNOACCESS^$MSGBTN_OK'), [{ type: 'refusal', code: 'REC_ERRNOSTICK' }, { type: 'refusal', code: 'REC_ERRNOACCESS' }]);
  assert.deepEqual(parseRecordingWriterFrame('3:::MSG^$SNAPLOAD^x\nMSG^REC_ERRNOSTICK\nDLGSHOW^other^$REC_ERRNOSTICK\nMSG^$REC_ERR\nMSG^$REC_ERRlower\nMSG^$REC_ERR<img>'), []);
  assert.deepEqual(parseRecordingWriterFrame(`3:::MSG^$REC_ERR${'X'.repeat(40)}`), []);
  assert.deepEqual(parseRecordingWriterFrame(5), []);
  assert.equal(recordingRefusalText('REC_ERRNOSTICK'), 'No USB drive in the desk');
  assert.equal(recordingRefusalText('REC_ERRNOACCESS'), 'Recording not available');
  assert.equal(recordingRefusalText('REC_ERRFULL'), 'Desk refused recording (REC_ERRFULL)');
  assert.equal(recordingRefusalText('constructor'), 'Desk refused recording (unknown)');
  assert.equal(formatElapsed(3725.9), '01:02:05'); assert.equal(formatElapsed(0), '00:00:00'); assert.equal(formatElapsed(-1), null); assert.equal(formatElapsed(NaN), null);
});

test('only the literal control factory has the recording API; read-only, level-only and the companion never send the toggle', () => {
  for (const factory of [createReadOnlySession, createAuxLevelSession]) {
    const f = fixture(factory, BASE);
    for (const name of ['startRecording', 'stopRecording']) assert.equal(f.session[name], undefined);
    assert.equal(f.session.snapshot().recording, undefined);
    f.writer.receive('3:::MSG^$REC_ERRNOSTICK');
    for (const s of f.sockets) assert.deepEqual(writes(s), []);
    f.session.disconnect();
  }
  const f = fixture();
  assert.deepEqual(f.session.startRecording(), { ok: true, kind: 'start' });
  assert.ok(f.receiver.sent.every(m => PLAIN.includes(m)), 'the receive-only companion sends only INIT/ALIVE/heartbeat');
  assert.deepEqual(writes(f.writer), [TOGGLE]);
  assert.equal(Object.keys(f.session).filter(key => /record/i.test(key)).sort().join(), 'startRecording,stopRecording', 'no generic sender, no raw API');
  f.session.disconnect();
});

test('start is sent only when the received state is exactly 0; stop only when received and non-zero (never blind)', () => {
  // State unknown: neither.
  let f = fixture(createAuxControlSession, TOPOLOGY + '\nSETD^var.mtk.present^1\nSETD^var.mtk.rec.busy^0');
  assert.equal(rec(f).recording, null); assert.equal(rec(f).elapsed, null);
  assert.equal(f.session.startRecording().code, 'unknown-state'); assert.equal(f.session.stopRecording().code, 'unknown-state');
  assert.deepEqual(writes(f.writer), []);
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^0');
  assert.equal(f.session.stopRecording().code, 'not-recording'); assert.deepEqual(writes(f.writer), []);
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^1');
  assert.equal(f.session.startRecording().code, 'already-recording'); assert.deepEqual(writes(f.writer), []);
  assert.equal(f.session.stopRecording().ok, true); assert.deepEqual(writes(f.writer), [TOGGLE]);
  f.session.disconnect();
  // Any non-zero value counts as recording (the value while recording is unverified: 1? 2?).
  f = fixture(createAuxControlSession, BASE.replace('rec.currentState^0', 'rec.currentState^2'));
  assert.equal(rec(f).recording, true); assert.equal(f.session.startRecording().code, 'already-recording'); assert.equal(f.session.stopRecording().ok, true);
  f.session.disconnect();
});

test('refusals: not qualified, no drive or unknown drive, recorder busy or unknown, locks, outstanding operation', () => {
  // Not qualified: socket open but no received Ui24 AUX state.
  const early = fixture(createAuxControlSession, '3:::SETS^model^ui24');
  assert.equal(early.session.startRecording().code, 'not-ready'); assert.deepEqual(writes(early.writer), []); early.session.disconnect();
  // No drive: the desk's real situation (present=0).
  let f = fixture(createAuxControlSession, TOPOLOGY + mtk({ present: 0 }));
  assert.deepEqual(rec(f).present, false);
  assert.deepEqual(f.session.startRecording(), { ok: false, code: 'no-drive', reason: 'No USB drive in the desk' });
  f.receiver.receive('3:::SETD^var.mtk.present^1'); assert.equal(f.session.startRecording().ok, true); f.session.disconnect();
  f = fixture(createAuxControlSession, TOPOLOGY.replace('\nSETD^settings.block.player^1', '') + '\nSETD^var.mtk.rec.currentState^0\nSETD^var.mtk.rec.busy^0');
  assert.equal(f.session.startRecording().code, 'drive-unknown'); f.session.disconnect();
  // Busy: at or above 0.5 refuses; unknown refuses.
  f = fixture(createAuxControlSession, TOPOLOGY + mtk({ busy: 0.5 }));
  assert.equal(f.session.startRecording().code, 'recorder-busy');
  f.receiver.receive('3:::SETD^var.mtk.rec.busy^1'); assert.equal(f.session.startRecording().code, 'recorder-busy');
  f.receiver.receive('3:::SETD^var.mtk.rec.busy^0.49'); assert.equal(f.session.startRecording().ok, true); f.session.disconnect();
  f = fixture(createAuxControlSession, TOPOLOGY + '\nSETD^var.mtk.present^1\nSETD^var.mtk.rec.currentState^0');
  assert.equal(f.session.startRecording().code, 'recorder-busy-unknown'); assert.deepEqual(writes(f.writer), []); f.session.disconnect();
  // Stop while busy also refuses (native does the same).
  f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1, busy: 1 })); assert.equal(f.session.stopRecording().code, 'recorder-busy'); f.session.disconnect();
  // Locks: pass empty -> allowed; pass set + player 0 -> locked; player 1 -> allowed; unknown -> refuses. The password never leaves the session.
  f = fixture();
  assert.equal(rec(f).lock, 'allowed');
  f.receiver.receive(`3:::SETS^settings.block.pass^${SECRET}\nSETD^settings.block.player^0`);
  assert.equal(rec(f).lock, 'locked'); assert.deepEqual(f.session.startRecording(), { ok: false, code: 'locked', reason: 'Locked on the desk.' });
  f.receiver.receive('3:::SETD^settings.block.player^1'); assert.equal(rec(f).lock, 'allowed');
  f.receiver.receive('3:::SETS^settings.block.pass^'); f.receiver.receive('3:::SETD^settings.block.player^0'); assert.equal(rec(f).lock, 'allowed', 'an empty password means nothing is locked');
  assert.ok(!JSON.stringify(f.session.snapshot().recording).includes(SECRET)); assert.ok(!JSON.stringify([...f.session.snapshot().observations]).includes(SECRET));
  assert.deepEqual(writes(f.writer), []);
  f.session.disconnect();
  f = fixture(createAuxControlSession, (TOPOLOGY + mtk()).replace('\nSETD^settings.block.player^1', '').replace('SETS^settings.block.pass^\n', `SETS^settings.block.pass^${SECRET}\n`));
  assert.equal(rec(f).lock, 'unknown'); assert.equal(f.session.startRecording().code, 'lock-unknown'); assert.deepEqual(writes(f.writer), []);
  f.session.disconnect();
  f = fixture(createAuxControlSession, (TOPOLOGY + mtk()).replace('SETS^settings.block.pass^\n', '').replace('\nSETD^settings.block.player^1', ''));
  assert.equal(rec(f).lock, 'unknown', 'unreceived lock settings refuse'); assert.equal(f.session.startRecording().code, 'lock-unknown'); f.session.disconnect();
  // One recording operation at a time; no retry, queue or replay.
  f = fixture();
  assert.equal(f.session.startRecording().ok, true);
  assert.equal(f.session.startRecording().code, 'busy'); assert.equal(f.session.stopRecording().code, 'busy');
  f.advance(60000);
  assert.deepEqual(writes(f.writer), [TOGGLE]);
  f.session.disconnect();
});

test('start outcomes: confirmed by a non-zero received state, refused by REC_ERR, unconfirmed after 5 s', () => {
  let f = fixture();
  f.session.startRecording(); assert.equal(rec(f).operation.status, 'pending');
  f.writer.receive('3:::SETD^var.mtk.rec.currentState^1'); assert.equal(rec(f).operation.status, 'pending', 'only the companion counts');
  f.receiver.receive('3:::SETD^var.mtk.rec.time^4'); assert.equal(rec(f).operation.status, 'pending');
  f.advance(1200); f.receiver.receive('3:::SETD^var.mtk.rec.currentState^1\nSETD^var.mtk.rec.time^1');
  assert.equal(rec(f).operation.status, 'confirmed'); assert.match(rec(f).operation.text, /reported recording started/);
  assert.equal(rec(f).recording, true); assert.equal(rec(f).elapsed, 1);
  f.advance(10000); assert.equal(rec(f).operation.status, 'confirmed', 'a late timer cannot change a settled outcome');
  f.session.disconnect();
  // Refused: the desk's real reply with no drive (state stays 0).
  f = fixture();
  f.session.startRecording();
  f.receiver.receive('3:::MSG^$REC_ERRNOSTICK'); assert.equal(rec(f).operation.status, 'pending', 'REC_ERR counts only from the requester writer socket');
  f.writer.receive('3:::MSG^$REC_ERRNOSTICK\nSETD^var.mtk.rec.time^0\nDLGSHOW^usb_rec^$REC_ERRNOACCESS^$MSGBTN_OK');
  assert.deepEqual({ ...rec(f).operation }, { kind: 'start', status: 'refused', code: 'REC_ERRNOSTICK', text: 'No USB drive in the desk' });
  assert.equal(rec(f).recording, false); assert.equal(f.session.snapshot().observations.has('var.mtk.rec.time'), false, 'writer frames never populate observations');
  assert.equal(f.session.startRecording().ok, true, 'a refused start may be tried again explicitly');
  f.session.disconnect();
  f = fixture(); f.session.startRecording(); f.writer.receive('3:::MSG^$REC_ERRFULLDISK');
  assert.equal(rec(f).operation.text, 'Desk refused recording (REC_ERRFULLDISK)'); f.session.disconnect();
  // An unsolicited REC_ERR with nothing outstanding is ignored.
  f = fixture(); f.writer.receive('3:::MSG^$REC_ERRNOSTICK'); assert.equal(rec(f).operation, null); f.session.disconnect();
  // The desk never reports.
  f = fixture(); f.session.startRecording(); f.advance(4999); assert.equal(rec(f).operation.status, 'pending'); f.advance(1);
  assert.equal(rec(f).operation.status, 'unconfirmed'); assert.match(rec(f).operation.text, /did not report recording within 5 s/);
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^1'); assert.equal(rec(f).operation.status, 'unconfirmed', 'a late report cannot revise it');
  assert.equal(rec(f).recording, true, 'but the received state is shown');
  assert.equal(writes(f.writer).length, 1, 'no retry'); f.session.disconnect();
});

test('stop outcomes: confirmed when the state becomes 0, unconfirmed after 5 s', () => {
  let f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1, time: 90 }));
  assert.equal(rec(f).elapsed, 90);
  assert.equal(f.session.stopRecording().ok, true);
  f.receiver.receive('3:::SETD^var.mtk.rec.time^95'); assert.equal(rec(f).operation.status, 'pending');
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^0'); assert.equal(rec(f).operation.status, 'confirmed'); assert.equal(rec(f).recording, false);
  assert.equal(rec(f).elapsed, null, 'elapsed exists only while recording');
  f.session.disconnect();
  f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1 }));
  f.session.stopRecording(); f.advance(5000);
  assert.equal(rec(f).operation.status, 'unconfirmed'); assert.match(rec(f).operation.text, /did not report recording stopped/);
  assert.equal(rec(f).recording, true, 'the received state is never replaced by intent');
  f.session.disconnect();
});

test('disconnect, a dropped socket and a failing send leave unknown; received recording state is cleared', () => {
  let f = fixture(); f.session.startRecording();
  const emitted = []; f.session.subscribe(snapshot => emitted.push(snapshot.recording.operation?.status));
  f.session.disconnect();
  assert.equal(rec(f).operation.status, 'unknown'); assert.match(rec(f).operation.text, /outcome is unknown\. No retry/);
  assert.equal(rec(f).state, null); assert.equal(rec(f).present, null); assert.equal(rec(f).elapsed, null); assert.equal(rec(f).session, null);
  assert.equal(f.session.startRecording().code, 'not-ready');
  // A throwing send ends the connection with an unknown outcome and no retry.
  f = fixture(); f.writer.fail = true;
  assert.equal(f.session.startRecording().code, 'send-failed'); assert.equal(f.session.snapshot().phase, 'error');
  assert.equal(rec(f).operation.status, 'unknown'); assert.equal(f.jobs.size, 0, 'no timers remain');
  // A socket drop while outstanding.
  f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1 })); f.session.stopRecording(); f.receiver.readyState = 3; f.receiver.onclose?.();
  assert.equal(rec(f).operation.status, 'unknown'); assert.equal(rec(f).recording, null);
  // A new explicit connection starts clean.
  f.session.connect('192.168.0.60'); assert.equal(rec(f).operation, null); assert.equal(rec(f).state, null);
});

test('elapsed comes from received time and only while recording; external starts and stops are reflected', () => {
  const f = fixture(); // stopped, rec.time counting up from 21
  assert.equal(rec(f).elapsed, null);
  f.receiver.receive('3:::SETD^var.mtk.rec.time^22'); assert.equal(rec(f).elapsed, null, 'rec.time while stopped is not an elapsed value');
  const seen = []; f.session.subscribe((snapshot, kind) => { if (kind === 'controls') seen.push(snapshot.recording.elapsed); });
  f.receiver.receive('3:::SETD^var.mtk.rec.time^23'); assert.deepEqual(seen, [], 'a time-only change while stopped emits nothing');
  // Another client starts recording: the received state simply updates; no operation is invented.
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^1\nSETD^var.mtk.rec.time^0\nSETS^var.mtk.rec.session^0012');
  assert.equal(rec(f).recording, true); assert.equal(rec(f).elapsed, 0); assert.equal(rec(f).operation, null); assert.equal(rec(f).session, '0012');
  f.receiver.receive('3:::SETD^var.mtk.rec.time^61'); assert.equal(rec(f).elapsed, 61); assert.equal(seen.at(-1), 61);
  f.receiver.receive('3:::SETD^var.mtk.rec.time^61.9'); assert.equal(rec(f).elapsed, 61, 'whole seconds');
  f.receiver.receive('3:::SETD^var.mtk.freespace^6000\nSETD^var.mtk.dropouts^2'); assert.equal(rec(f).freespace, 6000); assert.equal(rec(f).dropouts, 2);
  // An external stop.
  f.receiver.receive('3:::SETD^var.mtk.rec.currentState^0'); assert.equal(rec(f).recording, false); assert.equal(rec(f).elapsed, null); assert.equal(rec(f).operation, null);
  // The drive is removed.
  f.receiver.receive('3:::SETD^var.mtk.present^0'); assert.equal(rec(f).present, false); assert.equal(f.session.startRecording().code, 'no-drive');
  assert.deepEqual(writes(f.writer), []);
  f.session.disconnect();
});

test('a stop stays possible if the drive disappears while recording (native does not check the drive for stop)', () => {
  const f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1 }));
  f.receiver.receive('3:::SETD^var.mtk.present^0');
  assert.equal(f.session.stopRecording().ok, true); assert.deepEqual(writes(f.writer), [TOGGLE]);
  f.session.disconnect();
});

test('updateBusy: a pending recording operation, active recording or tracked UI operation defers an automatic update', () => {
  const idle = { phase: 'idle' };
  const owner = { active: () => null };
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: idle }), false);
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: { ...idle, recording: { operation: { status: 'pending' } } } }), true);
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: { ...idle, recording: { recording: true, operation: null } } }), true);
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: { ...idle, recording: { recording: false, operation: { status: 'confirmed' } } } }), false);
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: idle, recordingControls: { pending: () => true } }), true);
  assert.equal(updateBusy({ session: {}, dialogOwner: owner, snapshot: idle, recordingControls: { pending: () => false } }), false);
  // Against a real session: connected and recording is busy; once disconnected it is idle again.
  const f = fixture(createAuxControlSession, TOPOLOGY + mtk({ state: 1 }));
  assert.equal(updateBusy({ session: f.session, dialogOwner: owner }), true);
  f.session.disconnect();
  assert.equal(updateBusy({ session: f.session, dialogOwner: owner }), false);
});
