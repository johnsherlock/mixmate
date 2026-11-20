import { settingsStatusText, snapshotRigName, promoteKnownAddress, validPrivateAddress, emptyNavigation, RIG_LIMIT } from '../settings.js';
import { restoreDialogFocus } from './dialog-owner.js';
import { projectLiveState, projectReceivedSourceCatalog } from './live-provider.js';
import { projectGroupNavigation, resolveGroupNavigation } from './group-navigation.js';
import { createAutoConnect, AUTO_CONNECT_ATTEMPT_MS } from './auto-connect.js';

export const DEFAULT_MIXER_ADDRESS = '192.168.0.60';
// A drop that recurs this soon after an automatic reconnection opens the
// Connect dialog instead of starting another pass (no endless retry loop).
export const AUTO_RECONNECT_MIN_INTERVAL_MS = 10000;
const SNAPSHOT_PATH = 'var.currentSnapshot';

// F02-S05 (user decision 2026-11-20): the live Connect dialog is only the mixer
// address, Connect, Disconnect while connected, Close and feedback. Rigs are
// named by the desk's current snapshot; there is no rig picker or editor.
export function createLiveConnectionUI(root, { levels = false, pan = false, dialogOwner } = {}) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const open = make('button', 'Connect to desk'), disconnect = make('button', 'Disconnect');
  open.type = disconnect.type = 'button'; open.className = 'mm-connect-toggle'; disconnect.className = 'mm-session-disconnect';
  $('.mm-preview').append(open, disconnect);
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
  const settings = make('p', 'Checking local settings storage…'), note = make('p', levels ? pan ? 'Known compatible levels and normalized pan are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Known compatible levels are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Only received state is shown. No mixer parameter writes.');
  settings.className = note.className = 'mm-caption'; note.setAttribute('role', 'status'); settings.setAttribute('role', 'status');
  const local = make('p', 'Groups are kept on this device for each desk snapshot name and work offline. Addresses that connect are remembered and tried automatically when the app opens or wakes.'); local.className = 'mm-caption';
  form.append(addressLabel, known, actions, feedback, note, settings, local);
  $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = levels ? 'Connect live IEM' : 'Connect read-only IEM';
  const closeButton = $('.mm-dialog-head button'); closeButton.disabled = false;
  const openButtons = [open, $('.mm-brand'), $('.mm-desk')].filter(Boolean);
  for (const button of openButtons) button.disabled = false;
  let focusBefore, beforeOpen = () => {}, connectionVisible = false, dialogLease = null;
  const openListeners = new Set();
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
    form, address, feedback, connect, disconnect, dialogDisconnect, settings, note, close, show, dialogOwner, beforeOpen(callback) { beforeOpen = callback; },
    onOpen(listener) { openListeners.add(listener); return () => openListeners.delete(listener); },
    visible: () => connectionVisible,
    navigation: [...root.querySelectorAll('.mm-entry-links a')],
    knownAddresses(addresses) {
      known.replaceChildren(...addresses.map(value => { const option = make('option'); option.value = value; return option; }));
    },
    connected(value) { dialogDisconnect.hidden = !value; dialogDisconnect.disabled = !value; },
    destroy() { root.removeEventListener('keydown', onKey); for (const button of openButtons) button.removeEventListener('click', show); closeButton.removeEventListener('click', onCloseClick); },
  };
}

export function mountLiveController({ session, repository, view, ui, document = globalThis.document, window = globalThis.window, createID = () => globalThis.crypto.randomUUID(),
  autoConnect: autoConnectEnabled = false, timers = globalThis, now = () => Date.now(), attemptMs = AUTO_CONNECT_ATTEMPT_MS }) {
  let destroyed = false, settings = null, settingsReady = false, selectedAux = null;
  let boundProfileId = null, contextRevision = 0, previousPhase = 'idle', rigMessage = '', creating = null, failedName = null;
  let projected = { selectedAux: null, sources: [] }, requestedNavigation = null, restoreCandidate = null, receivedCatalog = [];
  let navIntent = 0, navPending = Promise.resolve(), rigPending = Promise.resolve(), navigationMessage = '', previousExpanded = null, previousControl = null;
  // Automatic connection state: an explicit Disconnect suppresses every
  // automatic trigger until the next explicit Connect or app open.
  let suppressed = false, addressTouched = false, attempt = null, reachedLive = false, lastAutoSuccess = -Infinity, autoMessage = '';
  const feedback = message => { if (ui.feedback) ui.feedback.textContent = message; };
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
    const want = desiredRig(snapshot);
    rigMessage = want.reason || '';
    if (want.create && creating !== want.create) createRig(want.create);
    if (want.id !== boundProfileId) switchRig(want.id, snapshot);
    if (want.persist && want.id && settings.selectedProfileId !== want.id) { settings = { ...settings, selectedProfileId: want.id }; persistSelection(want.id); }
  }
  function recordAddress(snapshot) {
    if (!attempt || attempt.recorded || snapshot.phase !== 'live') return;
    attempt.recorded = true;
    const address = attempt.address;
    // Already the most recent known address: nothing to promote or write.
    if (!validPrivateAddress(address) || settings?.knownAddresses[0] === address) return;
    rigPending = Promise.resolve(repository.update?.(draft => { draft.knownAddresses = promoteKnownAddress(draft.knownAddresses, address); }))
      .catch(() => { /* Storage status reports the problem; the connection stays. */ });
  }
  function statusSuffix() {
    const notes = [navigationMessage, autoMessage];
    if (!owner() && rigMessage && (settingsReady || isActive(previousPhase))) notes.unshift(rigMessage);
    return notes.filter(Boolean).join(' · ');
  }
  function render(snapshot = session.snapshot(), kind) {
    if (destroyed) return;
    if (kind !== 'meters') {
      autoConnect?.observe(snapshot.phase);
      if (isActive(previousPhase) && !isActive(snapshot.phase)) contextRevision++;
      if (snapshot.phase === 'live') reachedLive = true;
      const dropped = reachedLive && ['closed', 'error', 'timeout'].includes(snapshot.phase);
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
  function startConnection(address) {
    if (destroyed || document.hidden) return false;
    selectedAux = null; requestedNavigation = null; restoreCandidate = null; navIntent++; navigationMessage = ''; failedName = null;
    const last = profile();
    if (last?.navigation.mixId) restoreCandidate = structuredClone(last.navigation);
    invalidateDraft();
    const target = String(address).trim();
    attempt = { address: target, recorded: false };
    return session.connect(target);
  }
  const autoConnect = autoConnectEnabled ? createAutoConnect({
    timers, attemptMs,
    connect: address => startConnection(address),
    disconnect: () => session.disconnect(),
    onProgress: ({ address, index, total }) => { autoMessage = `Connecting automatically to ${address} (${index + 1} of ${total})…`; feedback(autoMessage); },
    // Called from render's observation step; that render shows the result.
    onSuccess: ({ address }) => { lastAutoSuccess = now(); autoMessage = ''; feedback(`Connected automatically to ${address}.`); if (!addressTouched) ui.address.value = address; },
    onExhausted: ({ tried }) => {
      autoMessage = '';
      if (destroyed) return;
      feedback(tried ? `No known desk address answered (${tried} tried). Enter the mixer address and Connect.` : 'Enter the mixer address and Connect.');
      render();
      openDialog();
    },
  }) : null;
  function openDialog() {
    if (destroyed || document.hidden || ui.visible?.() || ui.dialogOwner?.active()) return;
    ui.show();
  }
  // One pass per trigger, never while connected, hidden, suppressed or while
  // the Connect dialog is in use, and never overlapping another pass.
  function trigger(reason) {
    if (!autoConnect || destroyed || !settingsReady || document.hidden || suppressed || autoConnect.running()) return false;
    if (isActive(session.snapshot().phase) || ui.visible?.()) return false;
    if (reason === 'drop' && now() - lastAutoSuccess < AUTO_RECONNECT_MIN_INTERVAL_MS) {
      feedback('The desk connection dropped again soon after reconnecting. Check the network, then Connect.');
      openDialog(); return false;
    }
    return autoConnect.start(settings.knownAddresses, reason);
  }
  let triggerQueued = false;
  // A drop is noticed inside a session emission; start the pass afterwards.
  function queueTrigger(reason) {
    if (!autoConnect || triggerQueued) return;
    triggerQueued = true;
    timers.setTimeout(() => { triggerQueued = false; trigger(reason); }, 0);
  }
  function cancelAuto({ retire = false } = {}) {
    if (!autoConnect?.running()) return false;
    autoConnect.cancel(); autoMessage = '';
    if (retire && !['live'].includes(session.snapshot().phase)) session.disconnect();
    return true;
  }
  function invalidate() {
    cancelAuto();
    selectedAux = null; restoreCandidate = requestedNavigation = null; navIntent++; navigationMessage = '';
    invalidateDraft(); session.disconnect();
  }

  const unsubscribe = session.subscribe(onSession);
  listen(ui.address, 'input', () => { addressTouched = true; ui.address.setCustomValidity(''); });
  // Using the Connect dialog stops automatic probing; an in-flight automatic
  // attempt is retired so it cannot connect behind the user's back.
  const offOpen = ui.onOpen?.(() => { if (cancelAuto({ retire: true })) feedback('Automatic connection stopped. Enter the mixer address and Connect.'); }) || (() => {});
  listen(ui.form, 'submit', event => {
    event.preventDefault();
    if (destroyed || document.hidden) return;
    cancelAuto({ retire: true });
    if (isActive(session.snapshot().phase)) return;
    suppressed = false; ui.address.setCustomValidity('');
    if (startConnection(ui.address.value)) ui.close();
    else if (session.snapshot().phase === 'invalid') { ui.address.setCustomValidity(session.snapshot().detail); ui.address.reportValidity(); }
  });
  const explicitDisconnect = () => { suppressed = true; invalidate(); feedback('Disconnected. Automatic connection is off until you Connect again or reopen the app.'); };
  listen(ui.disconnect, 'click', explicitDisconnect);
  listen(ui.dialogDisconnect, 'click', explicitDisconnect);
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { invalidate(); ui.close(); }
    else trigger('visible');
  });
  listen(window, 'pagehide', () => { invalidate(); ui.close(); });
  listen(window, 'pageshow', event => { if (event?.persisted) trigger('wake'); });
  listen(window, 'online', () => trigger('online'));
  for (const link of ui.navigation || []) listen(link, 'click', event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && (event.button === undefined || event.button === 0)) invalidate();
  });
  const unsubscribeSettings = repository.subscribe?.(snapshot => {
    if (snapshot.status) ui.settings.textContent = settingsStatusText(snapshot.status);
    if (!settingsReady || destroyed) return;
    settings = snapshot.settings;
    ui.knownAddresses?.(settings.knownAddresses);
    if (!addressTouched && !isActive(session.snapshot().phase) && settings.knownAddresses[0]) ui.address.value = settings.knownAddresses[0];
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
    ui.knownAddresses?.(settings.knownAddresses);
    if (!addressTouched && !isActive(session.snapshot().phase)) ui.address.value = settings.knownAddresses[0] || DEFAULT_MIXER_ADDRESS;
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
      offOpen(); unsubscribeSettings(); unsubscribe(); session.disconnect();
      for (const [target, type, callback] of handlers) target.removeEventListener(type, callback);
      ui.destroy?.(); view.destroy();
    },
  };
}
