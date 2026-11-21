import { restoreDialogFocus } from './dialog-owner.js';

// F07-S02: the live header's Snapshot and Save snapshot buttons and their
// dialogs. This module only calls the private session's typed names-only API
// (`requestSnapshotList`, `recallSnapshot`, `saveCurrentSnapshot`); it builds no
// wire text, owns no socket and adds no outbound message. Every mixer string
// (show, snapshot names, session texts) is written with textContent only. The
// desk's lock password is reduced to a boolean inside the session and never
// reaches this module. There is no dirty indicator: the desk's "snapshot
// modified" state is not verified.
export const RECALL_WARNING = 'Recall changes desk settings for everyone.';
const FINAL = { recall: ['confirmed', 'unconfirmed', 'unknown'], save: ['reported', 'unconfirmed', 'unknown'] };

// Why a header button is unavailable ('' when it is available). `kind` is
// 'recall' or 'save'; `busy` is this module's own pending operation.
export function snapshotAvailability(snapshot, kind, busy = false) {
  const info = snapshot?.snapshots;
  if (!info || snapshot.phase !== 'live' || snapshot.qualified === false) return 'Connect to the desk first.';
  if (busy || info.operation?.status === 'pending') return 'A snapshot operation is waiting for the desk.';
  if (!info.show) return 'The desk has not reported its current show.';
  if (!info.current) return 'The desk has not reported a current snapshot.';
  const lock = info.lock?.[kind];
  if (lock === 'locked') return 'Locked on the desk.';
  if (lock !== 'allowed') return 'The desk’s lock settings have not been received.';
  return '';
}

export function mountSnapshotControls({ root, session, ui, dialogOwner }) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node; };
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button'), title = $('#mm-dialog-title');
  const recallButton = $('[data-action="snapshots"]'), saveButton = $('[data-action="save"]');
  const view = make('div', 'mm-snapshot-dialog-body');
  const status = make('p', 'mm-caption mm-snapshot-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const field = make('label', 'mm-snapshot-field', 'Snapshot'), select = make('select'); select.id = 'mm-snapshot-select'; field.append(select);
  const note = make('p', 'mm-caption mm-snapshot-note'), warning = make('p', 'mm-warning');
  const actions = make('div', 'mm-dialog-actions'), cancel = make('button', '', 'Cancel'), act = make('button', 'mm-primary');
  cancel.type = 'button'; act.type = 'button'; actions.append(cancel, act);

  // `tracked` follows the one operation this UI started; it outlives the dialog
  // so a replaced/closed dialog (for example by a rig switch) never loses the
  // outcome: it still reaches the footer slot and the Diagnostics log.
  let lease = null, mode = null, focusBefore, tracked = null, finished = null, refusal = '', destroyed = false, clean = () => {}, lastSignature = '', resultFocus = false;
  const snapshot = () => session.snapshot();
  const busy = () => Boolean(tracked);
  const log = text => ui.log?.(text);

  function paintButtons(current = snapshot()) {
    for (const [button, kind, base] of [[recallButton, 'recall', 'Recall a snapshot on the desk'], [saveButton, 'save', 'Save the current snapshot on the desk']]) {
      if (!button) continue;
      const reason = snapshotAvailability(current, kind, busy());
      button.disabled = Boolean(reason); button.setAttribute('title', reason || base);
    }
  }
  function paintDiagnostics(current = snapshot()) {
    const info = current.snapshots;
    if (!info) { ui.diagnostics?.snapshots?.(null); return; }
    const op = info.operation, list = info.list;
    const signature = JSON.stringify([info.show, info.current, list.status, list.names.length, list.truncated, op && [op.kind, op.name, op.status], info.lock, current.phase]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    ui.diagnostics?.snapshots?.({
      show: info.show ?? 'not received', current: info.current ?? 'not received',
      list: `${list.status} · ${list.names.length} name${list.names.length === 1 ? '' : 's'}${list.truncated ? ' (truncated)' : ''}`,
      operation: op ? `${op.kind} · ${op.name} · ${op.status}` : 'none',
      lock: `recall ${info.lock?.recall ?? 'unknown'} · save ${info.lock?.save ?? 'unknown'}`,
    });
  }

  function listState(info) {
    if (info.list.status === 'pending') return 'loading';
    if (info.list.status === 'fresh' && info.list.show === info.show) return 'ready';
    return 'unavailable';
  }
  function paintDialog(current = snapshot()) {
    if (!lease || !dialogOwner.owns(lease)) return;
    const info = current.snapshots, kind = mode;
    const live = Boolean(info) && current.phase === 'live' && current.qualified !== false;
    const names = info?.list.names || [], currentName = info?.current || '';
    let text = '', ready = false;
    if (finished) text = finished.text;
    else if (tracked) text = kind === 'recall' ? `Recalling ${tracked.name}…` : 'Saving…';
    else if (!live) text = 'Not connected to the desk.';
    else if (refusal) text = refusal;
    else {
      const state = listState(info);
      if (state === 'loading') text = 'Loading snapshots…';
      else if (state === 'unavailable') text = 'The desk did not send its snapshot list. Close and try again.';
      else if (kind === 'save' && !names.includes(currentName)) text = `The current snapshot “${currentName}” is not in the desk’s list, so it cannot be saved from MixMate.`;
      else ready = true;
    }
    status.textContent = text; status.hidden = !text;
    const interactive = ready && !tracked && !finished;
    if (kind === 'recall') {
      const showList = !finished && live && listState(info) === 'ready' || Boolean(tracked);
      field.hidden = !showList; select.disabled = !interactive;
      if (showList && !tracked) {
        const previous = select.value, signature = JSON.stringify([names, currentName]);
        if (select.dataset.signature !== signature) {
          select.dataset.signature = signature;
          const placeholder = make('option', '', 'Choose a snapshot'); placeholder.value = ''; placeholder.disabled = true;
          select.replaceChildren(placeholder, ...names.map(name => { const option = make('option', '', name === currentName ? `${name} (current)` : name); option.value = name; return option; }));
          select.value = names.includes(previous) ? previous : names.includes(currentName) ? currentName : '';
        }
      }
      note.textContent = info?.list.truncated && interactive ? 'The desk’s list was truncated; some snapshots are not shown.' : ''; note.hidden = !note.textContent;
      warning.hidden = false; warning.textContent = RECALL_WARNING;
      act.textContent = 'Recall snapshot'; act.disabled = !interactive || !select.value;
    } else {
      field.hidden = true; note.hidden = true;
      // Built with textContent: the current name comes from the desk.
      warning.hidden = !interactive; warning.textContent = interactive ? `Overwrite “${currentName}” with the current desk settings?` : '';
      act.textContent = 'Save snapshot'; act.disabled = !interactive;
    }
    cancel.textContent = finished || !live && !tracked ? 'Close' : 'Cancel'; cancel.disabled = Boolean(tracked);
    closeButton.disabled = Boolean(tracked);
  }

  function closeDialog(token, reason = {}) {
    if (!token || lease !== token) return;
    lease = null; mode = null; clean(); clean = () => {};
    closeButton.disabled = false;
    dialog.classList.remove('mm-snapshot-dialog'); dialog.removeAttribute?.('tabindex'); dialogOwner.release(token);
    if (!dialogOwner.active()) layer.hidden = true;
    if (!reason.replaced && !dialogOwner.active()) restoreDialogFocus(focusBefore);
  }
  const requestClose = () => { if (lease && dialogOwner.owns(lease) && !tracked) closeDialog(lease); };

  function openDialog(kind) {
    if (destroyed || lease && dialogOwner.owns(lease)) return false;
    const current = snapshot();
    if (snapshotAvailability(current, kind, busy())) return false;
    const token = dialogOwner.claim('snapshots', reason => closeDialog(token, reason));
    if (!token) return false;
    lease = token; mode = kind; finished = null; refusal = ''; select.dataset.signature = ''; select.replaceChildren(); select.value = ''; focusBefore = document.activeElement;
    dialog.classList.remove('mm-group-dialog', 'mm-pan-dialog', 'mm-diag-dialog'); dialog.classList.add('mm-snapshot-dialog'); dialog.setAttribute('tabindex', '-1');
    title.textContent = kind === 'recall' ? 'Recall snapshot' : 'Save current snapshot';
    view.replaceChildren(status, field, note, warning, actions); body.replaceChildren(view);
    // Both operations need a fresh list (recall names, save requires the
    // current snapshot to be listed).
    const result = session.requestSnapshotList?.();
    if (result && !result.ok && !(result.code === 'busy' && snapshot().snapshots?.list.status === 'pending')) { refusal = result.reason || 'The snapshot list could not be requested.'; log(`Snapshot list: ${refusal}`); }
    layer.hidden = false;
    const click = event => { if (dialogOwner.owns(token)) { event.stopImmediatePropagation?.(); requestClose(); } };
    const key = event => {
      if (event.key === 'Tab' && tracked && dialogOwner.owns(token)) { event.preventDefault(); event.stopImmediatePropagation?.(); dialog.focus?.(); return; }
      if (event.key !== 'Escape' || !dialogOwner.owns(token)) return;
      event.preventDefault(); event.stopImmediatePropagation?.(); requestClose();
    };
    clean = () => { closeButton.removeEventListener('click', click); root.removeEventListener('keydown', key); };
    closeButton.addEventListener('click', click); root.addEventListener('keydown', key);
    paintDialog();
    (kind === 'recall' && !select.disabled ? select : cancel).focus();
    return true;
  }

  // Pending: focus the dialog container (never lost behind disabled controls);
  // after a result or refusal: Cancel/Close.
  function applyFocus() {
    if (!lease || !dialogOwner.owns(lease)) { resultFocus = false; return; }
    if (tracked) dialog.focus?.();
    else if (resultFocus) { resultFocus = false; cancel.focus(); }
  }
  function start() {
    if (!lease || !dialogOwner.owns(lease) || tracked || finished) return;
    const current = snapshot(), kind = mode;
    refusal = '';
    const name = kind === 'recall' ? select.value : current.snapshots?.current;
    if (!name) { paintDialog(); return; }
    tracked = { kind, name };
    const result = kind === 'recall' ? session.recallSnapshot(name) : session.saveCurrentSnapshot();
    if (!result?.ok) {
      // A send failure settles reentrantly as unknown (already one coherent entry); only a plain refusal logs here.
      if (tracked) { tracked = null; refusal = result?.reason || 'The desk operation was refused.'; log(`Snapshot ${kind}${kind === 'recall' ? ` ${name}` : ''}: ${refusal}`); resultFocus = true; }
      paintDialog(); paintButtons(); applyFocus(); return;
    }
    log(`Snapshot ${kind} ${name}: sent, waiting for the desk`);
    // A synchronous reply during send may already have settled the outcome.
    settle(snapshot());
    paintDialog(); paintButtons(); applyFocus();
  }

  // Delivers the outcome of this UI's own operation once, whether or not its
  // dialog is still open.
  function settle(current) {
    if (!tracked) return;
    const op = current.snapshots?.operation;
    if (!op || op.kind !== tracked.kind || op.name !== tracked.name || !FINAL[op.kind].includes(op.status)) return;
    const { kind, name } = tracked; tracked = null;
    const text = op.text;
    paintButtons(current); // the header buttons are enabled again before focus returns to one
    // The footer message slot also writes the Diagnostics log, so log once.
    const line = op.status === 'confirmed' ? `Recalled ${name}.`
      : op.status === 'reported' ? `Save sent for ${name}; the desk reported a show change (contents not verified).`
      : `${kind === 'recall' ? `Recall ${name}` : `Save ${name}`}: ${text}`;
    if (ui.message) ui.message(line); else log(line);
    if (lease && dialogOwner.owns(lease)) {
      if (op.status === 'confirmed' || op.status === 'reported') closeDialog(lease);
      else { finished = { text }; resultFocus = true; }
    }
  }

  function onSession(current, kind) {
    if (destroyed || kind === 'meters') return;
    settle(current);
    if (lease && dialogOwner.owns(lease) && !tracked && !finished && (current.phase !== 'live' || current.qualified === false || !current.snapshots)) closeDialog(lease);
    paintButtons(current); paintDiagnostics(current); paintDialog(current); applyFocus();
  }
  const offSession = session.subscribe(onSession);
  const onActClick = () => start(), onCancelClick = () => requestClose(), onSelect = () => { refusal = ''; paintDialog(); };
  const onRecall = () => { if (!recallButton.disabled) openDialog('recall'); }, onSave = () => { if (!saveButton.disabled) openDialog('save'); };
  act.addEventListener('click', onActClick); cancel.addEventListener('click', onCancelClick); select.addEventListener('change', onSelect);
  recallButton?.addEventListener('click', onRecall); saveButton?.addEventListener('click', onSave);
  onSession(snapshot());
  return {
    visible: () => Boolean(lease && dialogOwner.owns(lease)), pending: () => busy(),
    destroy() {
      destroyed = true; offSession(); if (lease) closeDialog(lease);
      act.removeEventListener('click', onActClick); cancel.removeEventListener('click', onCancelClick); select.removeEventListener('change', onSelect);
      recallButton?.removeEventListener('click', onRecall); saveButton?.removeEventListener('click', onSave);
    },
  };
}
