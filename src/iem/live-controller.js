import { settingsStatusText, snapshotRigName, promoteKnownAddress, validPrivateAddress, emptyNavigation, RIG_LIMIT } from '../settings.js';
import { restoreDialogFocus } from './dialog-owner.js';
import { projectLiveState, projectReceivedSourceCatalog } from './live-provider.js';
import { projectGroupNavigation, resolveGroupNavigation } from './group-navigation.js';
import { createAutoConnect, AUTO_CONNECT_ATTEMPT_MS } from './auto-connect.js';
import { createDiagnostics } from './diagnostics.js';

export const DEFAULT_MIXER_ADDRESS = '192.168.0.60';
// A drop that recurs this soon after an automatic reconnection opens the
// Connect dialog instead of starting another pass (no endless retry loop). It
// is at least the session's own qualification (15 s) and idle (30 s) deadlines,
// so a session that fails one of them after an automatic success cannot loop.
export const AUTO_RECONNECT_MIN_INTERVAL_MS = 30000;
const SNAPSHOT_PATH = 'var.currentSnapshot';

// F02-S05 (user decision 2026-11-20): the live Connect dialog is only the mixer
// address, Connect, Disconnect while connected, Close and feedback. Rigs are
// named by the desk's current snapshot; there is no rig picker or editor.
// F09-S11 (user decision 2026-11-21): it is now minimal (at most one status
// line); the session message, settings status and explanatory notes, the
// banner links and a second Connect/Disconnect pair live in the Diagnostics modal.
export function createLiveConnectionUI(root, { levels = false, pan = false, dialogOwner, timers } = {}) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const diagnostics = createDiagnostics(root, { dialogOwner, levels, pan, ...(timers ? { timers } : {}) });
  diagnostics.address.value = DEFAULT_MIXER_ADDRESS;
  const layer = $('.mm-layer'), form = make('form'); form.className = 'mm-live-connection';
  const address = make('input'), connect = make('button', levels ? 'Connect live IEM' : 'Connect read-only');
  address.value = DEFAULT_MIXER_ADDRESS; address.required = true; address.autocomplete = 'off'; address.spellcheck = false;
  address.setAttribute('inputmode', 'decimal'); address.setAttribute('list', 'iem-known-addresses');
  const known = make('datalist'); known.id = 'iem-known-addresses';
  const addressLabel = make('label', 'Mixer private IPv4 address');
  addressLabel.append(address); connect.type = 'submit';
  const dialogDisconnect = make('button', 'Disconnect'); dialogDisconnect.type = 'button'; dialogDisconnect.hidden = true;
  const actions = make('div'); actions.className = 'mm-dialog-actions'; actions.append(connect, dialogDisconnect);
  const feedback = make('p'); feedback.className = 'mm-caption'; feedback.setAttribute('role', 'status');
  form.append(addressLabel, known, actions, feedback);
  $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = levels ? 'Connect live IEM' : 'Connect read-only IEM';
  const closeButton = $('.mm-dialog-head button'); closeButton.disabled = false;
  const openButtons = [$('.mm-brand'), $('.mm-desk')].filter(Boolean);
  for (const button of openButtons) button.disabled = false;
  let focusBefore, beforeOpen = () => {}, connectionVisible = false, dialogLease = null;
  const openListeners = new Set(), deskListeners = new Set(); let deskAddressValue = null;
  const show = () => {
    if (dialogOwner && !dialogOwner.owns(dialogLease)) {
      const next = dialogOwner.claim('connection', reason => closeFor(next, reason, true));
      if (!next) return; dialogLease = next;
    }
    beforeOpen();
    if (dialogOwner && !dialogOwner.owns(dialogLease)) return;
    const wasVisible = connectionVisible;
    connectionVisible = true; focusBefore = document.activeElement;
    $('.mm-dialog').classList.remove('mm-group-dialog', 'mm-pan-dialog');
    $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = levels ? 'Connect live IEM' : 'Connect read-only IEM';
    layer.hidden = false; address.focus();
    if (!wasVisible) for (const listener of openListeners) listener();
  };
  const closeFor = (lease, reason = {}, fromOwner = false) => {
    if (!connectionVisible || lease !== dialogLease || dialogOwner && !fromOwner && !dialogOwner.owns(lease)) return;
    connectionVisible = false; dialogOwner?.release(lease);
    if (!dialogOwner?.active()) layer.hidden = true;
    if (!reason.replaced && !dialogOwner?.active()) restoreDialogFocus(focusBefore);
  };
  const close = () => closeFor(dialogLease);
  const onKey = event => {
    if (layer.hidden) return;
    if (event.key === 'Escape' && connectionVisible && (!dialogOwner || dialogOwner.owns(dialogLease))) { event.preventDefault(); event.stopImmediatePropagation?.(); close(); return; }
    if (event.key === 'Tab') {
      const nodes = [...layer.querySelectorAll('button,input,select,summary')].filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]') && (!node.closest('details') || node.tagName === 'SUMMARY' || node.closest('details').open)), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  root.addEventListener('keydown', onKey);
  for (const button of openButtons) button.addEventListener('click', show);
  const onCloseClick = event => { if (connectionVisible && (!dialogOwner || dialogOwner.owns(dialogLease))) { event.stopImmediatePropagation?.(); close(); } };
  closeButton.addEventListener('click', onCloseClick);
  return {
    form, address, feedback, connect, dialogDisconnect, close, show, dialogOwner, beforeOpen(callback) { beforeOpen = callback; },
    diagnostics, settings: diagnostics.settings, note: diagnostics.note, disconnect: diagnostics.disconnect,
    // Footer message slot, status button and Diagnostics feed (all optional for other callers).
    message: text => diagnostics.message(text), clearMessage: () => diagnostics.clearMessage(), condition: text => diagnostics.condition(text),
    status: value => diagnostics.status(value), rig: text => diagnostics.rig(text), autoPass: pass => diagnostics.autoPass(pass), log: text => diagnostics.log(text), refresh: () => diagnostics.refresh(),
    onOpen(listener) { openListeners.add(listener); return () => openListeners.delete(listener); },
    visible: () => connectionVisible,
    // F07-S04: the desk address the header Native button would open (null when none is known).
    deskAddress(address) { if (address === deskAddressValue) return; deskAddressValue = address; for (const listener of deskListeners) listener(address); },
    onDeskAddress(listener) { deskListeners.add(listener); listener(deskAddressValue); return () => deskListeners.delete(listener); },
    navigation: diagnostics.links,
    knownAddresses(addresses) {
      known.replaceChildren(...addresses.map(value => { const option = make('option'); option.value = value; return option; }));
      diagnostics.knownAddresses(addresses);
    },
    connected(value) { dialogDisconnect.hidden = !value; dialogDisconnect.disabled = !value; diagnostics.connected(value); },
    destroy() { diagnostics.destroy(); root.removeEventListener('keydown', onKey); for (const button of openButtons) button.removeEventListener('click', show); closeButton.removeEventListener('click', onCloseClick); },
  };
}

export function mountLiveController({ session, repository, view, ui, document = globalThis.document, window = globalThis.window, createID = () => globalThis.crypto.randomUUID(),
  autoConnect: autoConnectEnabled = false, initialSuppressed = false, timers = globalThis, now = () => Date.now(), attemptMs = AUTO_CONNECT_ATTEMPT_MS }) {
  let destroyed = false, settings = null, settingsReady = false, selectedAux = null;
  let boundProfileId = null, contextRevision = 0, previousPhase = 'idle', rigMessage = '', creating = null, failedName = null;
  let previousObserved = false;
  let projected = { selectedAux: null, sources: [] }, requestedNavigation = null, restoreCandidate = null, receivedCatalog = [];
  let navIntent = 0, navPending = Promise.resolve(), rigPending = Promise.resolve(), navigationMessage = '', previousExpanded = null, previousControl = null;
  // Automatic connection state: an explicit Disconnect suppresses every
  // automatic trigger until the next explicit Connect or app open.
  let suppressed = Boolean(initialSuppressed), addressTouched = false, attempt = null, reachedLive = false, lastAutoSuccess = -Infinity, autoMessage = '';
  // Footer status: the address of the current/last attempt and the last failure
  // (`lost` after a live connection dropped, else the address that did not answer).
  let lastFailure = null, lastStatusText = '', autoPass = null;
  // Work deferred while another dialog (groups, pan, EQ, detail) is open.
  let pendingTrigger = null, pendingDialog = false, lastSnapshotName, statusNotice = '';
  // Full readiness: received Ui24 AUX state and, for a control session, an open
  // writer as well as the qualified companion (snapshot `qualified`).
  const fullyReady = snapshot => snapshot.phase === 'live' && snapshot.qualified !== false;
  const otherDialog = () => Boolean(ui.dialogOwner?.active()) && !ui.visible?.();
  // The Connect dialog's single status line; every message is also kept in the
  // bounded Diagnostics log (in memory only).
  const feedback = message => { if (ui.feedback) ui.feedback.textContent = message; ui.log?.(message); };
  // The Connect dialog and the Diagnostics modal each have an address field;
  // they always hold the same text.
  const diag = ui.diagnostics, addressFields = [ui.address, diag?.address].filter(Boolean);
  const setAddress = value => { for (const field of addressFields) field.value = value; };
  const addressValidity = text => { for (const field of addressFields) { field.setCustomValidity?.(text); } };
  const profiles = () => settings?.profiles || [];
  const profile = () => profiles().find(rig => rig.id === boundProfileId);
  const owner = () => boundProfileId && profile() ? { kind: 'profile', id: boundProfileId } : null;
  const definition = () => owner() ? profile() : null;
  const localNavigation = () => {
    const value = resolveGroupNavigation(definition()?.groups || [], requestedNavigation);
    return { mixId: selectedAux === null || !boundProfileId ? null : `a.${selectedAux}`, view: value.view, expandedGroupId: value.expandedGroupId };
  };
  const contextListeners = new Set();
  const names = rows => rows.map(source => ({ sourceId: source.sourceId, name: source.name }));
  const isActive = phase => ['connecting', 'connected', 'partial', 'live'].includes(phase);
  // The received snapshot name of the current connection only; cleared state
  // (disconnect, hide, failure) has no observations, so no name survives.
  function receivedSnapshot(snapshot = session.snapshot()) {
    if (!isActive(snapshot.phase) || !snapshot.observations?.has(SNAPSHOT_PATH)) return { received: false };
    const raw = snapshot.observations.get(SNAPSHOT_PATH);
    return { received: true, raw, name: snapshotRigName(raw) };
  }
  const context = () => ({ profileId: owner() ? boundProfileId : null, owner: owner(), ownerName: profile()?.name ?? null, unavailableReason: owner() ? '' : rigMessage, revision: contextRevision, ready: settingsReady, selectedAux, expandedGroupId: selectedAux === null ? null : localNavigation().expandedGroupId,
    sources: names(projected.sources || []),
    // With no AUX selected (All Mixes), the editor may offer every source received on any available AUX.
    catalog: selectedAux === null ? names(receivedCatalog) : names(projected.sources || []) });
  let groupsSignature = '';
  const bindOwner = () => {
    const value = owner();
    if (session.bindGroupOwner) session.bindGroupOwner(value);
    else session.bindGroupProfile?.(value?.id ?? null);
  };
  const emitContext = () => { bindOwner(); groupsSignature = JSON.stringify([owner(), definition()?.groups]); for (const listener of contextListeners) listener(context()); };
  const invalidateDraft = () => { session.invalidateLevelContext?.(); contextRevision++; emitContext(); };
  const handlers = [];
  const listen = (target, type, callback) => { if (!target?.addEventListener) return; target.addEventListener(type, callback); handlers.push([target, type, callback]); };

  // Which local rig the current state calls for. A received snapshot name is
  // the identity (exact, case-sensitive); a qualified connection without one
  // has no rig; otherwise (offline, connecting) the last-used rig stays.
  function desiredRig(snapshot = session.snapshot()) {
    const current = receivedSnapshot(snapshot);
    if (current.received) {
      if (!current.name) return { id: null, reason: 'Groups unavailable: the desk reported no usable snapshot name.' };
      const rig = profiles().find(item => item.name === current.name);
      if (rig) return { id: rig.id, name: current.name, persist: true };
      if (failedName === current.name) return { id: null, reason: rigMessage || 'Groups unavailable for this snapshot.' };
      return { id: null, create: current.name, reason: 'Preparing local groups for this snapshot…' };
    }
    if (snapshot.phase === 'live') return { id: null, reason: 'Groups unavailable: the desk has not reported a current snapshot name.' };
    const last = profiles().find(item => item.id === settings?.selectedProfileId);
    if (last) return { id: last.id };
    return { id: null, reason: 'Groups unavailable: connect to the desk to load groups for its current snapshot.' };
  }
  function switchRig(id, snapshot) {
    boundProfileId = id; navIntent++; navigationMessage = '';
    const rig = profile();
    if (isActive(snapshot.phase)) {
      // Follow-live switch: obsolete gestures, selection and group context are
      // cancelled (the session also cancels on owner change); the socket stays.
      requestedNavigation = null; restoreCandidate = null;
      if (rig?.navigation.mixId) { restoreCandidate = structuredClone(rig.navigation); selectedAux = null; }
    } else { requestedNavigation = null; restoreCandidate = null; }
    invalidateDraft();
  }
  function persistSelection(id) {
    rigPending = Promise.resolve(repository.update?.(draft => {
      if (!draft.profiles.some(rig => rig.id === id)) throw Error('Rig no longer exists.');
      draft.selectedProfileId = id;
    })).catch(() => { /* Selection is a convenience; status shows storage problems. */ });
  }
  function createRig(name) {
    creating = name;
    const id = createID();
    let pending;
    try {
      pending = repository.update(draft => {
        let rig = draft.profiles.find(item => item.name === name);
        if (!rig) {
          if (draft.profiles.length >= RIG_LIMIT) {
            // Overflow: only a rig that holds no groups (and is not the last
            // used one) may make room; groups are never discarded silently.
            const spare = draft.profiles.findIndex(item => !item.groups.length && item.id !== draft.selectedProfileId);
            if (spare < 0) throw Error(`Groups unavailable: ${RIG_LIMIT} snapshot rigs with groups are already stored on this device.`);
            draft.profiles.splice(spare, 1);
          }
          rig = { id, name, groups: [], navigation: emptyNavigation() };
          draft.profiles.push(rig);
        }
        if (receivedSnapshot().name === name) draft.selectedProfileId = rig.id;
      });
    } catch (error) { pending = Promise.reject(error); }
    rigPending = Promise.resolve(pending).then(result => {
      if (creating === name) creating = null;
      if (destroyed) return;
      if (result?.settings) settings = result.settings;
      render();
    }).catch(error => {
      if (creating === name) creating = null;
      if (destroyed) return;
      failedName = name; rigMessage = /^Groups unavailable/.test(error?.message) ? error.message : 'Groups unavailable: local groups for this snapshot could not be prepared.';
      render();
    });
  }
  function applyRig(snapshot) {
    if (!settingsReady) return;
    // A rig-creation failure applies to that snapshot name only.
    const current = receivedSnapshot(snapshot);
    if (current.name !== lastSnapshotName) { lastSnapshotName = current.name; failedName = null; }
    const want = desiredRig(snapshot);
    rigMessage = want.reason || '';
    if (want.create && creating !== want.create) createRig(want.create);
    if (want.id !== boundProfileId) switchRig(want.id, snapshot);
    if (want.persist && want.id && settings.selectedProfileId !== want.id) { settings = { ...settings, selectedProfileId: want.id }; persistSelection(want.id); }
  }
  function recordAddress(snapshot) {
    if (!attempt || attempt.recorded || !fullyReady(snapshot)) return;
    attempt.recorded = true;
    const address = attempt.address;
    // Already the most recent known address: nothing to promote or write.
    if (!validPrivateAddress(address) || settings?.knownAddresses[0] === address) return;
    rigPending = Promise.resolve(repository.update?.(draft => { draft.knownAddresses = promoteKnownAddress(draft.knownAddresses, address); }))
      .catch(() => { /* Storage status reports the problem; the connection stays. */ });
  }
  function statusSuffix() {
    const notes = [navigationMessage, autoMessage || statusNotice];
    if (!owner() && rigMessage && (settingsReady || isActive(previousPhase))) notes.unshift(rigMessage);
    return notes.filter(Boolean).join(' · ');
  }
  const TERMINAL = ['error', 'closed', 'timeout', 'blocked', 'unsupported', 'invalid'];
  function trackFailure(snapshot, dropped) {
    if (fullyReady(snapshot)) { lastFailure = null; return; }
    if (dropped) lastFailure = { lost: true, address: attempt?.address || '' };
    else if (!isActive(snapshot.phase) && TERMINAL.includes(snapshot.phase) && attempt && !autoConnect?.running() && !lastFailure) lastFailure = { lost: false, address: attempt.address };
  }
  function connectionStatus(snapshot) {
    const address = attempt?.address || '';
    if (fullyReady(snapshot)) return { state: 'connected', text: address ? `Connected · ${address}` : 'Connected', address };
    const trying = autoConnect?.current()?.address || address;
    if (isActive(snapshot.phase) || autoConnect?.running()) return { state: 'connecting', text: trying ? `Connecting · ${trying}…` : 'Connecting…', address: trying };
    if (lastFailure) return { state: 'failed', text: lastFailure.lost ? 'Connection lost' : `Couldn't reach ${lastFailure.address}`, address: lastFailure.address };
    return { state: 'idle', text: 'Not connected', address: '' };
  }
  // Footer status button, Diagnostics connection/rig rows; display only.
  function reportStatus(snapshot) {
    const status = connectionStatus(snapshot);
    if (status.text !== lastStatusText) {
      lastStatusText = status.text; ui.log?.(status.text);
      // One concise line in the Connect dialog; a longer notice (pass result) wins.
      if (status.state === 'failed' && !statusNotice) { if (ui.feedback) ui.feedback.textContent = `${status.text}${status.text.startsWith('Couldn') ? '.' : '. Connect again.'}`; }
    }
    ui.status?.(status);
    // F07-S04: the connected desk's address, else the most recent known one.
    ui.deskAddress?.(validPrivateAddress(status.state === 'connected' ? status.address : '') || validPrivateAddress(settings?.knownAddresses?.[0] || '') || null);
    // Lasting conditions reach the footer slot while they hold.
    ui.condition?.(navigationMessage.startsWith('View is temporary') ? navigationMessage : settingsReady && !owner() && /^Groups unavailable/.test(rigMessage) ? rigMessage : '');
    ui.rig?.(owner() ? `Rig “${profile()?.name}”` : rigMessage || 'No rig');
    ui.refresh?.();
  }
  function render(snapshot = session.snapshot(), kind) {
    if (destroyed) return;
    let dropped = false;
    if (kind !== 'meters') {
      autoConnect?.observe(snapshot.phase, fullyReady(snapshot));
      // Losing a connection that never received state (a failed attempt) does
      // not change any context an open dialog depends on.
      if (isActive(previousPhase) && !isActive(snapshot.phase) && previousObserved) contextRevision++;
      previousObserved = isActive(snapshot.phase) && snapshot.observations?.size > 0;
      if (fullyReady(snapshot)) reachedLive = true;
      dropped = reachedLive && ['closed', 'error', 'timeout'].includes(snapshot.phase);
      if (!isActive(snapshot.phase)) reachedLive = false;
      recordAddress(snapshot);
      applyRig(snapshot);
      if (dropped) queueTrigger('drop');
    }
    if (restoreCandidate && isActive(snapshot.phase)) {
      const match = /^a\.([0-9])$/.exec(restoreCandidate.mixId || '');
      if (match) {
        const candidate = projectLiveState(snapshot, Number(match[1]));
        if (candidate.selectedAux !== null) { selectedAux = candidate.selectedAux; requestedNavigation = restoreCandidate; restoreCandidate = null; contextRevision++; }
      } else restoreCandidate = null;
    }
    const base = projectLiveState(snapshot, selectedAux);
    if (selectedAux !== base.selectedAux) { contextRevision++; session.invalidateLevelContext?.(); if (snapshot.control) base.control = session.snapshot().control; }
    selectedAux = base.selectedAux; projected = base;
    if (kind !== 'meters') receivedCatalog = selectedAux === null && isActive(snapshot.phase) ? projectReceivedSourceCatalog(snapshot) : [];
    const model = projectGroupNavigation(base, definition(), requestedNavigation);
    if (previousExpanded !== model.expandedGroupId) contextRevision++;
    previousExpanded = model.expandedGroupId;
    const suffix = statusSuffix();
    if (model.notice || suffix) model.status += ` · ${[model.notice, suffix].filter(Boolean).join(' · ')}`;
    previousPhase = snapshot.phase;
    const controlSignature = JSON.stringify(snapshot.control);
    if (kind === 'meters' && view.renderMeters && controlSignature === previousControl) view.renderMeters(model);
    else view.render(model);
    previousControl = controlSignature;
    const active = isActive(snapshot.phase);
    ui.connect.disabled = active; ui.disconnect.disabled = !active; ui.connected?.(active);
    ui.note.textContent = snapshot.detail;
    if (kind !== 'meters') {
      trackFailure(snapshot, dropped);
      reportStatus(snapshot);
      const current = receivedSnapshot(snapshot);
      // Received text only, rendered as text; an unusable name is not shown.
      view.snapshotName?.(current.name || 'Unavailable');
      emitContext();
    }
  }
  // F09-S06: while an owned gesture is active, session-driven redraws (live
  // steps, echoes, meters) are coalesced to one per animation frame, so a drag
  // never pays for a full reconcile per streamed step. Gesture end renders now.
  const requestFrame = typeof window?.requestAnimationFrame === 'function' ? callback => window.requestAnimationFrame(callback) : null;
  let framePending = false, frameId;
  function onSession(snapshot, kind) {
    if (destroyed) return;
    if (requestFrame && snapshot?.control?.gestureActive) {
      if (!framePending) { framePending = true; frameId = requestFrame(() => { if (!framePending) return; framePending = false; if (!destroyed) render(session.snapshot(), 'controls'); }); }
      return;
    }
    if (framePending) { framePending = false; window?.cancelAnimationFrame?.(frameId); }
    render(snapshot, kind);
  }

  // Every connection, manual or automatic, starts from a cleared selection and
  // records its address only after received Ui24 readiness.
  function startConnection(address, { automatic = false } = {}) {
    if (destroyed || document.hidden) return false;
    // An automatic attempt changes context only when there was a selection.
    const changed = !automatic || selectedAux !== null || requestedNavigation !== null;
    selectedAux = null; requestedNavigation = null; restoreCandidate = null; navIntent++; navigationMessage = ''; failedName = null; statusNotice = ''; lastFailure = null;
    const last = profile();
    if (last?.navigation.mixId) restoreCandidate = structuredClone(last.navigation);
    if (changed) invalidateDraft();
    const target = String(address).trim();
    attempt = { address: target, recorded: false };
    return session.connect(target);
  }
  const autoConnect = autoConnectEnabled ? createAutoConnect({
    timers, attemptMs,
    // Never start, retire or replace an attempt behind an open dialog.
    canAdvance: () => !destroyed && !document.hidden && !ui.dialogOwner?.active(),
    connect: address => startConnection(address, { automatic: true }),
    disconnect: () => session.disconnect(),
    onProgress: ({ reason, address, index, total }) => {
      autoMessage = `Connecting automatically to ${address} (${index + 1} of ${total})…`; feedback(autoMessage);
      if (index === 0) autoPass = { reason, attempts: [], outcome: 'running' };
      autoPass?.attempts.push({ address, result: 'trying' }); ui.autoPass?.(autoPass);
    },
    onFailure: ({ address, reason }) => {
      const item = autoPass?.attempts.findLast(entry => entry.address === address && entry.result === 'trying');
      if (item) { item.result = reason === 'timeout' ? 'no answer in time (timeout)' : reason === 'refused' ? 'could not start (refused)' : `failed (${reason})`; ui.autoPass?.(autoPass); }
    },
    // Called from render's observation step; that render shows the result.
    onSuccess: ({ address }) => {
      const item = autoPass?.attempts.findLast(entry => entry.address === address && entry.result === 'trying');
      if (item) item.result = 'connected'; if (autoPass) autoPass.outcome = 'connected'; ui.autoPass?.(autoPass);
      lastAutoSuccess = now(); autoMessage = ''; feedback(`Connected automatically to ${address}.`); if (!addressTouched) setAddress(address); },
    onExhausted: ({ reason, tried }) => {
      autoMessage = '';
      autoPass ||= { reason: reason || 'open', attempts: [], outcome: '' };
      autoPass.outcome = tried ? `no address answered (${tried} tried)` : 'no known address'; ui.autoPass?.(autoPass);
      if (destroyed) return;
      const failed = autoPass?.attempts.at(-1);
      lastFailure = tried && failed ? { lost: false, address: failed.address } : null;
      notify(tried ? `No known desk address answered (${tried} tried). Enter the mixer address and Connect.` : 'Enter the mixer address and Connect.');
      openDialog();
    },
  }) : null;
  // Shown in the Connect form and, until the next connection, the status line,
  // so it is visible even when another dialog keeps the Connect form closed.
  function notify(message) { feedback(message); statusNotice = message; render(); }
  // Opens the Connect dialog now, or once any other open dialog closes.
  function openDialog() {
    if (destroyed || document.hidden || ui.visible?.()) return;
    if (ui.dialogOwner?.active()) { pendingDialog = true; return; }
    pendingDialog = false; ui.show();
  }
  // One pass per trigger, never while connected, hidden, suppressed or while
  // the Connect dialog is in use, and never overlapping another pass.
  function trigger(reason) {
    if (!autoConnect || destroyed || !settingsReady || document.hidden || suppressed || autoConnect.running()) return false;
    if (isActive(session.snapshot().phase) || ui.visible?.()) return false;
    if (reason === 'drop' && now() - lastAutoSuccess < AUTO_RECONNECT_MIN_INTERVAL_MS) {
      notify('The desk connection dropped again soon after reconnecting. Check the network, then Connect.');
      openDialog(); return false;
    }
    // Another dialog (groups, pan, EQ, detail) is open: start when it closes.
    if (otherDialog()) { pendingTrigger = reason; return false; }
    pendingTrigger = null; autoPass = null;
    return autoConnect.start(settings.knownAddresses, reason);
  }
  // When the last dialog closes, continue deferred automatic work.
  let idleQueued = false;
  const offDialogs = ui.dialogOwner?.subscribe?.(lease => {
    if (lease || idleQueued || !autoConnect) return;
    idleQueued = true;
    timers.setTimeout(() => {
      idleQueued = false;
      if (destroyed || ui.dialogOwner?.active()) return;
      if (autoConnect.paused()) autoConnect.resume();
      else if (pendingTrigger) { const reason = pendingTrigger; pendingTrigger = null; trigger(reason); }
      if (pendingDialog && !autoConnect.running()) openDialog();
    }, 0);
  }) || (() => {});
  let triggerQueued = false;
  // A drop is noticed inside a session emission; start the pass afterwards.
  function queueTrigger(reason) {
    if (!autoConnect || triggerQueued) return;
    triggerQueued = true;
    timers.setTimeout(() => { triggerQueued = false; trigger(reason); }, 0);
  }
  function cancelAuto({ retire = false } = {}) {
    pendingTrigger = null; pendingDialog = false;
    if (!autoConnect?.running()) return false;
    autoConnect.cancel(); autoMessage = '';
    if (autoPass) { autoPass.outcome = 'cancelled'; for (const item of autoPass.attempts) if (item.result === 'trying') item.result = 'cancelled'; ui.autoPass?.(autoPass); }
    if (retire && !fullyReady(session.snapshot())) session.disconnect();
    return true;
  }
  function invalidate() {
    cancelAuto();
    selectedAux = null; restoreCandidate = requestedNavigation = null; navIntent++; navigationMessage = '';
    invalidateDraft(); session.disconnect();
  }

  const unsubscribe = session.subscribe(onSession);
  for (const field of addressFields) listen(field, 'input', () => { addressTouched = true; addressValidity(''); for (const other of addressFields) if (other !== field) other.value = field.value; });
  // Using the Connect dialog stops automatic probing; an in-flight automatic
  // attempt is retired so it cannot connect behind the user's back.
  const offOpen = ui.onOpen?.(() => { if (cancelAuto({ retire: true })) feedback('Automatic connection stopped. Enter the mixer address and Connect.'); }) || (() => {});
  // The Connect dialog and the Diagnostics modal share one explicit Connect path.
  const submitFrom = (field, afterStart) => event => {
    event.preventDefault();
    if (destroyed || document.hidden) return;
    cancelAuto({ retire: true });
    if (isActive(session.snapshot().phase)) return;
    suppressed = false; field.setCustomValidity('');
    if (startConnection(field.value)) afterStart();
    else if (session.snapshot().phase === 'invalid') { field.setCustomValidity(session.snapshot().detail); field.reportValidity(); }
  };
  listen(ui.form, 'submit', submitFrom(ui.address, () => ui.close()));
  if (diag) listen(diag.form, 'submit', submitFrom(diag.address, () => {}));
  const explicitDisconnect = () => { suppressed = true; invalidate(); lastFailure = null; reportStatus(session.snapshot()); feedback('Disconnected. Automatic connection is off until you Connect again or reopen the app.'); };
  listen(ui.disconnect, 'click', explicitDisconnect);
  listen(ui.dialogDisconnect, 'click', explicitDisconnect);
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { invalidate(); ui.close(); diag?.close(); }
    else trigger('visible');
  });
  listen(window, 'pagehide', () => { invalidate(); ui.close(); diag?.close(); });
  listen(window, 'pageshow', event => { if (event?.persisted) trigger('wake'); });
  listen(window, 'online', () => trigger('online'));
  for (const link of ui.navigation || []) listen(link, 'click', event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && (event.button === undefined || event.button === 0)) invalidate();
  });
  const unsubscribeSettings = repository.subscribe?.(snapshot => {
    if (snapshot.status) ui.settings.textContent = settingsStatusText(snapshot.status);
    if (!settingsReady || destroyed) return;
    settings = snapshot.settings;
    ui.knownAddresses?.(settings.knownAddresses); reportStatus(session.snapshot());
    if (!addressTouched && !isActive(session.snapshot().phase) && settings.knownAddresses[0]) setAddress(settings.knownAddresses[0]);
    view.preferences(settings.preferences);
    if (JSON.stringify([owner(), definition()?.groups]) !== groupsSignature) session.invalidateLevelContext?.();
    // A deliberately deleted group is not an unavailable saved preference.
    if (requestedNavigation?.expandedGroupId && !definition()?.groups.some(group => group.id === requestedNavigation.expandedGroupId)) requestedNavigation = { ...requestedNavigation, expandedGroupId: null };
    render();
  }) || (() => {});
  const sameOwner = token => token.profileId === boundProfileId && JSON.stringify(token.owner) === JSON.stringify(owner());
  function persistNavigation() {
    const current = owner();
    if (!settingsReady || !definition() || !current?.id || typeof repository.update !== 'function') return;
    const token = { intent: ++navIntent, profileId: boundProfileId, owner: current, revision: contextRevision }, navigation = localNavigation();
    navigationMessage = 'Saving view on this device…';
    const change = draft => {
      if (destroyed || token.intent !== navIntent || !sameOwner(token) || token.revision !== contextRevision) throw Error('View context changed; navigation was not applied.');
      const rig = draft.profiles.find(item => item.id === token.owner.id);
      if (!rig) throw Error('Local group definitions are unavailable.');
      if (navigation.expandedGroupId && !rig.groups.some(group => group.id === navigation.expandedGroupId)) throw Error('Group changed before saving the view.');
      rig.navigation = structuredClone(navigation);
    };
    let pending;
    try { pending = repository.update(change); } catch (error) { pending = Promise.reject(error); }
    navPending = Promise.resolve(pending).then(result => {
      if (destroyed || token.intent !== navIntent || !sameOwner(token) || token.revision !== contextRevision) return;
      navigationMessage = result.status.mode === 'persistent' && result.status.state === 'saved' ? 'View saved on this device.' : 'View is temporary; not saved on this device.';
      render();
    }).catch(() => {
      if (!destroyed && token.intent === navIntent && sameOwner(token) && token.revision === contextRevision) { navigationMessage = 'View is temporary; not saved on this device.'; render(); }
    });
  }
  function chooseNavigation(next) {
    restoreCandidate = null; requestedNavigation = next;
    invalidateDraft(); render(); persistNavigation(); render();
  }
  const ready = repository.initialize().then(result => {
    if (destroyed) return;
    const { settings: loaded, status } = repository.snapshot?.() || result;
    settings = loaded; settingsReady = true;
    ui.knownAddresses?.(settings.knownAddresses); reportStatus(session.snapshot());
    if (!addressTouched && !isActive(session.snapshot().phase)) setAddress(settings.knownAddresses[0] || DEFAULT_MIXER_ADDRESS);
    view.preferences(settings.preferences);
    ui.settings.textContent = settingsStatusText(status);
    render();
    trigger('open');
  }).catch(() => { if (!destroyed) ui.settings.textContent = 'Could not load local settings. Manual Connect still works.'; });
  return {
    ready,
    whenRigIdle: () => rigPending,
    context,
    autoConnecting: () => Boolean(autoConnect?.running()),
    // F07-S05: an explicit Disconnect's suppression, carried across one automatic update reload.
    autoSuppressed: () => suppressed,
    // F07-S05: a user-initiated Connect that has not yet received state (an automatic pass is excluded).
    explicitConnecting: () => session.snapshot().phase === 'connecting' && !autoConnect?.running(),
    subscribeContext(listener) { contextListeners.add(listener); listener(context()); return () => contextListeners.delete(listener); },
    selectAux(index) {
      const snapshot = session.snapshot(), candidate = projectLiveState(snapshot, index);
      if (candidate.selectedAux === null || selectedAux === candidate.selectedAux) return false;
      selectedAux = candidate.selectedAux;
      const saved = profile()?.navigation, legacy = /^a\.([0-9])$/.exec(saved?.mixId || '');
      const sameMix = legacy && projectLiveState(snapshot, Number(legacy[1])).selectedAux === selectedAux;
      chooseNavigation(sameMix ? structuredClone(saved) : null);
      return true;
    },
    toggleGroup(id) {
      if (selectedAux === null || !definition()?.groups.some(group => group.id === id)) return false;
      const current = localNavigation();
      chooseNavigation({ view: 'groups', expandedGroupId: current.view === 'groups' && current.expandedGroupId === id ? null : id });
      return true;
    },
    // F09-S12: back to the main group fader view, exactly what collapsing the expanded group does; writes nothing.
    allGroups() { if (selectedAux !== null) { const current = localNavigation(); if (current.view !== 'groups' || current.expandedGroupId) chooseNavigation({ view: 'groups', expandedGroupId: null }); } },
    allChannels() { if (selectedAux !== null && localNavigation().view !== 'channels') chooseNavigation({ view: 'channels', expandedGroupId: null }); },
    overview() { selectedAux = null; chooseNavigation({ view: definition()?.groups.length ? 'groups' : 'channels', expandedGroupId: null }); },
    selectLevel(target) {
      if (target.kind === 'send' && target.auxIndex !== selectedAux) { session.disarmLevel?.(); return false; }
      return session.selectLevelTarget?.(target);
    },
    selectGroupLevel(groupId) {
      if (selectedAux === null || !definition()?.groups.some(group => group.id === groupId)) { session.disarmLevel?.(); return false; }
      return session.selectGroupTarget?.(groupId, selectedAux);
    },
    toggleLevel() { if (session.snapshot().control?.armed) session.disarmLevel(); else session.armLevel?.(); },
    clearLevelContext() { session.invalidateLevelContext?.(); render(); },
    whenNavigationIdle: () => navPending,
    destroy() {
      if (framePending) { framePending = false; window?.cancelAnimationFrame?.(frameId); }
      autoConnect?.cancel(); boundProfileId = null; invalidateDraft(); destroyed = true; contextListeners.clear(); navIntent++;
      offOpen(); offDialogs(); unsubscribeSettings(); unsubscribe(); session.disconnect();
      for (const [target, type, callback] of handlers) target.removeEventListener(type, callback);
      ui.destroy?.(); view.destroy();
    },
  };
}
