import { restoreDialogFocus } from './dialog-owner.js';
import { formatElapsed } from './recording-protocol.js';

// F07-S03: the live header's Record button and the Stop recording dialog. This
// module only calls the private session's typed API (`startRecording`,
// `stopRecording`); it builds no wire text, owns no socket and adds no outbound
// message. The elapsed time is always the desk's received `var.mtk.rec.time`
// while the received state says recording, never a local timer: unknown shows
// "REC". Every desk-derived string is written with textContent only. There is
// no synthetic recording status: without received state the button is disabled.
const FINAL = ['confirmed', 'refused', 'unconfirmed', 'unknown'];

// Why the header button is unavailable ('' when it is available).
export function recordingAvailability(snapshot, busy = false) {
  const info = snapshot?.recording;
  if (!info || snapshot.phase !== 'live' || snapshot.qualified === false) return 'Connect to the desk first';
  if (busy || info.operation?.status === 'pending') return 'A recording operation is waiting for the desk';
  if (info.recording === null) return 'The desk has not reported its recording state';
  if (!info.recording) {
    if (info.present === null) return 'The desk has not reported its USB drive';
    if (info.present === false) return 'No USB drive in the desk';
  }
  if (info.lock === 'locked') return 'Locked on the desk';
  if (info.lock !== 'allowed') return 'The desk’s lock settings have not been received';
  if (info.busy === null) return 'The desk has not reported whether the recorder is busy';
  if (info.busy >= 0.5) return 'Recorder busy';
  return '';
}

export function mountRecordingControls({ root, session, ui, dialogOwner }) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node; };
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button'), title = $('#mm-dialog-title');
  const button = $('[data-action="record"]'), recText = $('.mm-rec-text'), sink = $('.mm-rec-state');
  const longSpan = recText?.querySelector?.('.mm-long') || make('span', 'mm-long', ' MTK');
  const view = make('div', 'mm-recording-dialog-body');
  const caption = make('p', 'mm-caption'); caption.setAttribute('role', 'status'); caption.setAttribute('aria-live', 'polite');
  const warning = make('p', 'mm-warning');
  const actions = make('div', 'mm-dialog-actions'), keep = make('button', '', 'Keep recording'), stop = make('button', 'mm-primary', 'Stop recording');
  keep.type = 'button'; stop.type = 'button'; actions.append(keep, stop);

  let lease = null, focusBefore, tracked = null, refusal = '', destroyed = false, clean = () => {}, lastLabel = null, lastSink = null, lastSignature = '', previous = null;
  const current = () => session.snapshot();
  const log = text => ui.log?.(text);
  const sentence = text => /[.!?]$/.test(text) ? text : `${text}.`;
  const say = text => { if (ui.message) ui.message(text); else log(text); };

  function paintButton(snapshot = current()) {
    const info = snapshot.recording, live = Boolean(info) && snapshot.phase === 'live' && snapshot.qualified !== false;
    const pending = tracked?.kind || (info?.operation?.status === 'pending' ? info.operation.kind : null);
    const recording = live && info.recording === true;
    const reason = recordingAvailability(snapshot, Boolean(tracked));
    if (button) {
      button.classList.toggle('mm-recording', recording);
      button.disabled = Boolean(reason);
      button.setAttribute('title', reason || (recording ? 'Stop multitrack recording' : 'Start multitrack recording'));
    }
    const label = pending ? (pending === 'start' ? 'Starting…' : 'Stopping…') : recording ? formatElapsed(info.elapsed) ?? 'REC' : 'Record';
    if (recText && label !== lastLabel) {
      lastLabel = label; recText.textContent = label;
      if (label === 'Record') recText.append(longSpan);
    }
    const summary = !live || info.recording === null ? 'Recording status unavailable'
      : recording ? `● MTK ${formatElapsed(info.elapsed) ?? 'recording'}` : info.present === false ? 'MTK stopped · no USB drive' : 'MTK stopped';
    if (sink && summary !== lastSink) { lastSink = summary; sink.textContent = summary; }
  }
  function paintDiagnostics(snapshot = current()) {
    const info = snapshot.recording;
    if (!info || snapshot.phase !== 'live') { if (lastSignature !== 'none') { lastSignature = 'none'; ui.diagnostics?.recording?.(null); } return; }
    const op = info.operation;
    const signature = JSON.stringify([info.present, info.freespace, info.dropouts, info.state, info.elapsed, info.session, info.busy, info.lock, op && [op.kind, op.status, op.code]]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const known = value => value === null || value === undefined ? 'not received' : String(value);
    ui.diagnostics?.recording?.({
      drive: info.present === null ? 'not received' : info.present ? 'present' : 'no drive',
      freespace: `${known(info.freespace)} (raw; units unverified)`, dropouts: known(info.dropouts),
      state: info.recording === null ? 'not received' : info.recording ? `recording (${info.state})` : 'stopped',
      elapsed: info.recording ? formatElapsed(info.elapsed) ?? 'unknown' : 'not recording',
      session: info.session ? info.session : 'none', busy: known(info.busy), lock: info.lock,
      operation: op ? `${op.kind} · ${op.status}${op.code ? ` (${op.code})` : ''}` : 'none',
    });
  }

  function paintDialog(snapshot = current()) {
    if (!lease || !dialogOwner.owns(lease)) return;
    const info = snapshot.recording;
    const elapsed = info?.recording ? formatElapsed(info.elapsed) : null;
    caption.textContent = `Current take · ${elapsed ?? 'elapsed time unknown'}`;
    warning.textContent = refusal; warning.hidden = !refusal;
    keep.textContent = refusal ? 'Close' : 'Keep recording'; stop.hidden = Boolean(refusal);
  }
  function closeDialog(token, reason = {}) {
    if (!token || lease !== token) return;
    lease = null; clean(); clean = () => {};
    dialog.classList.remove('mm-recording-dialog'); dialogOwner.release(token);
    if (!dialogOwner.active()) layer.hidden = true;
    if (!reason.replaced && !dialogOwner.active()) restoreDialogFocus(focusBefore);
  }
  function openStopDialog() {
    if (destroyed || lease && dialogOwner.owns(lease)) return false;
    const snapshot = current();
    if (recordingAvailability(snapshot, Boolean(tracked)) || snapshot.recording?.recording !== true) return false;
    const token = dialogOwner.claim('recording', reason => closeDialog(token, reason));
    if (!token) return false;
    lease = token; refusal = ''; focusBefore = document.activeElement;
    dialog.classList.remove('mm-group-dialog', 'mm-pan-dialog', 'mm-diag-dialog'); dialog.classList.add('mm-recording-dialog');
    title.textContent = 'Stop multitrack recording?';
    view.replaceChildren(caption, warning, actions); body.replaceChildren(view);
    layer.hidden = false;
    const click = event => { if (dialogOwner.owns(token)) { event.stopImmediatePropagation?.(); closeDialog(token); } };
    const key = event => { if (event.key === 'Escape' && dialogOwner.owns(token)) { event.preventDefault(); event.stopImmediatePropagation?.(); closeDialog(token); } };
    clean = () => { closeButton.removeEventListener('click', click); root.removeEventListener('keydown', key); };
    closeButton.addEventListener('click', click); root.addEventListener('keydown', key);
    paintDialog(snapshot);
    keep.focus();
    return true;
  }

  // Starting needs no confirmation (non-destructive); the toggle is sent only by the session, only for the received state.
  function startRecording() {
    if (tracked) return;
    tracked = { kind: 'start' };
    const result = session.startRecording();
    if (!result?.ok) {
      // A send failure settles reentrantly as unknown (one coherent entry); only a plain refusal reports here.
      if (tracked) { tracked = null; say(sentence(result?.reason || 'The desk refused recording')); }
    } else log('Recording start sent, waiting for the desk');
    settle(current()); paintButton();
  }
  function stopRecording() {
    if (!lease || !dialogOwner.owns(lease) || tracked) return;
    tracked = { kind: 'stop' };
    const result = session.stopRecording();
    if (!result?.ok) {
      if (tracked) { tracked = null; refusal = result?.reason || 'The desk refused to stop recording.'; log(`Stop recording: ${refusal}`); }
      paintDialog(); paintButton(); keep.focus(); return;
    }
    log('Recording stop sent, waiting for the desk');
    closeDialog(lease);
    settle(current()); paintButton();
  }
  // Delivers the outcome of this UI's own operation once, whether or not a dialog is open.
  function settle(snapshot) {
    if (!tracked) return;
    const op = snapshot.recording?.operation;
    if (!op || op.kind !== tracked.kind || !FINAL.includes(op.status)) return;
    const { kind } = tracked; tracked = null;
    paintButton(snapshot);
    const line = op.status === 'confirmed' ? (kind === 'start' ? 'Recording started.' : 'Recording stopped.') : op.status === 'refused' ? sentence(op.text) : op.text;
    say(line);
  }
  function onSession(snapshot, kind) {
    if (destroyed || kind === 'meters') return;
    const info = snapshot.recording, now = snapshot.phase === 'live' && info ? info.recording : null;
    if (now !== null && previous !== null && now !== previous && !tracked) log(now ? 'The desk started recording.' : 'The desk stopped recording.');
    previous = now;
    settle(snapshot);
    if (lease && dialogOwner.owns(lease) && (snapshot.phase !== 'live' || snapshot.qualified === false || info?.recording !== true)) closeDialog(lease);
    paintButton(snapshot); paintDiagnostics(snapshot); paintDialog(snapshot);
  }
  const offSession = session.subscribe(onSession);
  const onRecord = () => {
    if (button.disabled) return;
    if (current().recording?.recording === true) openStopDialog(); else startRecording();
  };
  button?.addEventListener('click', onRecord); const onKeep = () => closeDialog(lease);
  keep.addEventListener('click', onKeep); stop.addEventListener('click', stopRecording);
  onSession(current());
  return {
    visible: () => Boolean(lease && dialogOwner.owns(lease)), pending: () => Boolean(tracked),
    destroy() { destroyed = true; offSession(); if (lease) closeDialog(lease); button?.removeEventListener('click', onRecord); keep.removeEventListener('click', onKeep); stop.removeEventListener('click', stopRecording); },
  };
}
