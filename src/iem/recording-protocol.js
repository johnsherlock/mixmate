import { IEM_RECEIVE_LIMITS } from './protocol.js';

// F07-S03 multitrack (MTK) recording protocol. Pure serializer and bounded
// receive parsers only: no transport, state or sender. Contract, evidence and
// exclusions: docs/iem-recording-contract.md, ADR-0011. The private session
// owner (session-core.js) is the only sender and only the literal
// createAuxControlSession writer socket may send the one form below.
//
// The single permitted outbound form is a TOGGLE, so the owner never sends it
// blind: start only when the received state is exactly 0, stop only when it is
// received and non-zero. Every other native recorder, 2-track, playback and
// session command is deliberately absent (the contract lists them).
export const RECORDING_LIMITS = Object.freeze({ sessionChars: 64, sessionBytes: 256 });
const encoder = new TextEncoder();
const CONTROL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028, 0x2029)}]`);
export const encodeRecordingToggleCommand = () => '3:::MTK_REC_TOGGLE';

const byteLength = text => encoder.encode(text).byteLength;
function frameLines(frame, tokens) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || frame.length > IEM_RECEIVE_LIMITS.frameBytes || !tokens.some(token => frame.includes(token))) return null;
  if (byteLength(frame) > IEM_RECEIVE_LIMITS.frameBytes) return null;
  const lines = frame.slice(4).split('\n');
  return lines.length > IEM_RECEIVE_LIMITS.lines ? null : lines.map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
}
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const number = raw => { const text = raw.trim(); if (!NUMBER.test(text)) return undefined; const value = Number(text); return Number.isFinite(value) && Math.abs(value) < 1e15 ? value : undefined; };

// Companion socket: `SETD^var.mtk.<key>^<number>` and `SETS^var.mtk.rec.session^<name>`
// plus the player lock flag. Missing or malformed values are simply absent
// (unknown), never defaulted. The lock password is parsed by the snapshot
// companion parser (emptiness only); it is never read here.
const NUMERIC_KEYS = Object.freeze({
  'var.mtk.present': 'present', 'var.mtk.freespace': 'freespace', 'var.mtk.dropouts': 'dropouts',
  'var.mtk.rec.currentState': 'state', 'var.mtk.rec.time': 'time', 'var.mtk.rec.busy': 'busy',
});
export function parseRecordingCompanionFrame(frame) {
  const lines = frameLines(frame, ['var.mtk.', 'settings.block.player']);
  const result = {};
  if (!lines) return result;
  for (const line of lines) {
    if (line.length > IEM_RECEIVE_LIMITS.lineBytes || byteLength(line) > IEM_RECEIVE_LIMITS.lineBytes) continue;
    const first = line.indexOf('^'), second = line.indexOf('^', first + 1);
    if (first !== 4 || second < 0) continue;
    const command = line.slice(0, first), path = line.slice(first + 1, second), raw = line.slice(second + 1);
    if (command === 'SETD' && Object.hasOwn(NUMERIC_KEYS, path)) { const value = number(raw); if (value !== undefined) result[NUMERIC_KEYS[path]] = value; }
    else if (command === 'SETS' && path === 'var.mtk.rec.session') {
      if (raw.length <= RECORDING_LIMITS.sessionChars && byteLength(raw) <= RECORDING_LIMITS.sessionBytes && !CONTROL.test(raw)) result.session = raw;
    } else if ((command === 'SETD' || command === 'SETS') && path === 'settings.block.player') {
      const flag = raw.trim();
      if (flag === '1' || flag === '0') result.player = flag === '1';
    }
  }
  return result;
}

// Writer socket, requester-only replies to a refused toggle:
//   MSG^$REC_ERR<X>   and   DLGSHOW^usb_rec^$REC_ERR<X>^$MSGBTN_OK
// Only a bounded `REC_ERR<A-Z0-9_>` code is retained; the raw line is never.
const CODE = /^REC_ERR[A-Z0-9_]{1,32}$/;
export function parseRecordingWriterFrame(frame) {
  const lines = frameLines(frame, ['REC_ERR']);
  if (!lines) return [];
  const events = [];
  for (const line of lines) {
    if (line.length > IEM_RECEIVE_LIMITS.lineBytes) continue;
    const parts = line.split('^');
    const raw = parts[0] === 'MSG' ? parts[1] : parts[0] === 'DLGSHOW' && parts[1] === 'usb_rec' ? parts[2] : undefined;
    if (typeof raw !== 'string' || !raw.startsWith('$')) continue;
    const code = raw.slice(1);
    if (CODE.test(code)) events.push(Object.freeze({ type: 'refusal', code }));
  }
  return events;
}
// Bounded, mapped text: never a raw desk string.
export const RECORDING_REFUSAL_TEXT = Object.freeze({
  REC_ERRNOSTICK: 'No USB drive in the desk',
  REC_ERRNOACCESS: 'Recording not available',
});
export const recordingRefusalText = code => Object.hasOwn(RECORDING_REFUSAL_TEXT, code) ? RECORDING_REFUSAL_TEXT[code] : `Desk refused recording (${CODE.test(code) ? code : 'unknown'})`;
export const formatElapsed = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
};
