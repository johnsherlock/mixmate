import { IEM_RECEIVE_LIMITS } from './protocol.js';

// F07-S01 snapshot list / recall / save-current protocol. Pure serializers,
// validators and bounded receive parsers only: no transport, state or sender.
// Contract, evidence and exclusions: docs/iem-snapshot-contract.md, ADR-0009.
// The private session owner (session-core.js) is the only sender and only the
// literal createAuxControlSession writer socket may send these three forms.
export const SNAPSHOT_LIMITS = Object.freeze({
  // Observed desk names are short (<= 20 chars). 64 chars / 256 bytes leaves
  // generous headroom while keeping every sent and retained string bounded; a
  // longer desk name is dropped from the list and so can never be recalled.
  nameChars: 64,
  nameBytes: 256,
  // The observed Default show lists 10 entries; 256 is far above any plausible
  // show and bounds the retained list.
  listCount: 256,
  // 256 names x 256 bytes plus separators, and the show name.
  listLineBytes: 70000,
  showChars: 64,
  showBytes: 256,
});
// The desk's factory-reset entry. Never recallable or savable through MixMate.
export const SNAPSHOT_INIT_ENTRY = '* Init *';
const encoder = new TextEncoder();
// C0, DEL, C1 controls and the Unicode line/paragraph separators. This also
// rejects `\n` and `\r`, so a name cannot start a second protocol line.
const CONTROL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028, 0x2029)}]`);
const refuse = (code, reason) => Object.freeze({ ok: false, code, reason });
const OK = Object.freeze({ ok: true });
const wellFormed = text => { try { encodeURIComponent(text); return true; } catch { return false; } };
const isInitEntry = name => name.trim().toLowerCase() === SNAPSHOT_INIT_ENTRY.toLowerCase();

function checkText(value, label, chars, bytes) {
  if (typeof value !== 'string') return refuse('invalid-name', `${label} must be text.`);
  if (value.trim() === '') return refuse('invalid-name', `${label} is empty.`);
  if (value.length > chars || encoder.encode(value).byteLength > bytes) return refuse('invalid-name', `${label} is too long.`);
  if (value.includes('^') || CONTROL.test(value) || !wellFormed(value)) return refuse('invalid-name', `${label} contains a character that cannot be sent safely.`);
  return OK;
}
// Strict name shape only. List membership and the Init exclusion are checked
// by the session owner; the encoders below also refuse the Init entry.
export const checkSnapshotName = name => checkText(name, 'Snapshot name', SNAPSHOT_LIMITS.nameChars, SNAPSHOT_LIMITS.nameBytes);
export const checkShowName = name => checkText(name, 'Show name', SNAPSHOT_LIMITS.showChars, SNAPSHOT_LIMITS.showBytes);
export const isSnapshotInitEntry = name => typeof name === 'string' && isInitEntry(name);

function assertShow(show) { const result = checkShowName(show); if (!result.ok) throw Error(result.reason); return show; }
function assertName(name) {
  const result = checkSnapshotName(name);
  if (!result.ok) throw Error(result.reason);
  if (isInitEntry(name)) throw Error('The desk Init entry cannot be recalled or saved.');
  return name;
}
// Exact forms, no other construction path:
//   3:::SNAPSHOTLIST^<show>            (read-only listing)
//   3:::LOADSNAPSHOT^<show>^<snapshot> (recall)
//   3:::SAVESNAPSHOT^<show>^<snapshot> (update the named existing snapshot)
export const encodeSnapshotListCommand = show => `3:::SNAPSHOTLIST^${assertShow(show)}`;
export const encodeSnapshotRecallCommand = (show, name) => `3:::LOADSNAPSHOT^${assertShow(show)}^${assertName(name)}`;
export const encodeSnapshotSaveCommand = (show, name) => `3:::SAVESNAPSHOT^${assertShow(show)}^${assertName(name)}`;

const byteLength = text => encoder.encode(text).byteLength;
function frameLines(frame, precheck) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::') || frame.length > IEM_RECEIVE_LIMITS.frameBytes || !precheck.some(token => frame.includes(token))) return null;
  if (byteLength(frame) > IEM_RECEIVE_LIMITS.frameBytes) return null;
  const lines = frame.slice(4).split('\n');
  return lines.length > IEM_RECEIVE_LIMITS.lines ? null : lines.map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
}

// Writer-socket replies only: `SNAPSHOTLIST^<show>^<name>…` (requester-only on
// the desk) and `MSG^$SNAPLOAD^<name>`. Empty, overlong, unsafe and duplicate
// names are dropped; at most `listCount` names are kept. These events feed only
// the snapshot list and operation outcome, never mixer observations.
export function parseSnapshotWriterFrame(frame) {
  const lines = frameLines(frame, ['SNAPSHOTLIST^', 'MSG^$SNAPLOAD^']);
  if (!lines) return [];
  const events = [];
  for (const line of lines) {
    if (line.startsWith('SNAPSHOTLIST^')) {
      if (line.length > SNAPSHOT_LIMITS.listLineBytes || byteLength(line) > SNAPSHOT_LIMITS.listLineBytes) continue;
      const [, show, ...raw] = line.split('^');
      if (!checkShowName(show).ok) continue;
      const names = [];
      let truncated = false;
      for (const name of raw) {
        if (name === '' || !checkSnapshotName(name).ok || names.includes(name)) continue;
        if (names.length >= SNAPSHOT_LIMITS.listCount) { truncated = true; break; }
        names.push(name);
      }
      events.push(Object.freeze({ type: 'list', show, names: Object.freeze(names), truncated }));
    } else if (line.startsWith('MSG^$SNAPLOAD^')) {
      const name = line.slice('MSG^$SNAPLOAD^'.length);
      if (line.length <= IEM_RECEIVE_LIMITS.lineBytes && checkSnapshotName(name).ok) events.push(Object.freeze({ type: 'snapload', name }));
    }
  }
  return events;
}

// Companion-socket facts the snapshot owner needs besides var.currentSnapshot
// (which protocol.js already decodes): the current show, whether a desk lock
// password is set (only its emptiness is retained, never the value), the
// loadshows / shows permission flags and the UPDATE_SHOWS broadcast. The exact
// INIT line form of `settings.block.*` is not in the root evidence, so SETD and
// SETS are both accepted; flags must read exactly `1` or `0`.
export function parseSnapshotCompanionFrame(frame) {
  const lines = frameLines(frame, ['var.currentShow', 'settings.block.', 'UPDATE_SHOWS']);
  const result = { updateShows: false };
  if (!lines) return result;
  for (const line of lines) {
    if (line === 'UPDATE_SHOWS' || line.startsWith('UPDATE_SHOWS^')) { result.updateShows = true; continue; }
    if (line.length > IEM_RECEIVE_LIMITS.lineBytes || byteLength(line) > IEM_RECEIVE_LIMITS.lineBytes) continue;
    const first = line.indexOf('^'), second = line.indexOf('^', first + 1);
    if (first !== 4 || second < 0) continue;
    const command = line.slice(0, first), path = line.slice(first + 1, second), raw = line.slice(second + 1);
    if (command === 'SETS' && path === 'var.currentShow') { if (byteLength(raw) <= IEM_RECEIVE_LIMITS.nameBytes) result.show = raw; continue; }
    if (command !== 'SETS' && command !== 'SETD') continue;
    if (path === 'settings.block.pass') result.passSet = raw.length > 0;
    else if (path === 'settings.block.loadshows' || path === 'settings.block.shows') {
      const flag = raw.trim();
      if (flag === '1' || flag === '0') result[path === 'settings.block.shows' ? 'shows' : 'loadshows'] = flag === '1';
    }
  }
  return result;
}
