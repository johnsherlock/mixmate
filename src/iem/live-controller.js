import { exportSettingsBackup } from '../settings-recovery.js';
import { mixerURL } from '../mixer-address.js';
import { validateSettings, settingsStatusText } from '../settings.js';
import { restoreDialogFocus } from './dialog-owner.js';
import { projectLiveState, projectReceivedSourceCatalog } from './live-provider.js';
import { projectGroupNavigation, resolveGroupNavigation } from './group-navigation.js';

export function createLiveConnectionUI(root, { levels = false, pan = false, dialogOwner } = {}) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const open = make('button', 'Connect to desk'), disconnect = make('button', 'Disconnect');
  open.type = disconnect.type = 'button'; open.className = 'mm-connect-toggle'; disconnect.className = 'mm-session-disconnect';
  $('.mm-preview').append(open, disconnect);
  const layer = $('.mm-layer'), form = make('form'); form.className = 'mm-live-connection';
  const profile = make('select'), address = make('input'), connect = make('button', levels ? 'Connect live IEM' : 'Connect read-only');
  address.value = '192.168.0.60'; address.required = true; address.autocomplete = 'off'; address.spellcheck = false;
  address.setAttribute('inputmode', 'decimal'); address.setAttribute('list', 'iem-known-addresses');
  const known = make('datalist'); known.id = 'iem-known-addresses';
  for (const value of ['192.168.0.60', '192.168.1.60']) { const option = make('option'); option.value = value; known.append(option); }
  const profileLabel = make('label', 'Saved local rig'), addressLabel = make('label', 'Mixer private IPv4 address');
  profileLabel.append(profile); addressLabel.append(address); connect.type = 'submit';
  const settings = make('p', 'Loading local rigs; manual Connect is available now.'), note = make('p', levels ? pan ? 'Known compatible levels and normalized pan are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Known compatible levels are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Only received state is shown. No mixer parameter writes.');
  settings.className = note.className = 'mm-caption'; note.setAttribute('role', 'status');
  const name = make('input'), nameLabel = make('label', 'Local rig name');
  name.maxLength = 80; name.autocomplete = 'off'; nameLabel.append(name);
  const newRig = make('button', 'New rig'), saveRig = make('button', 'Save rig');
  const exportSettings = make('button', 'Export settings'); exportSettings.type = 'button'; exportSettings.disabled = true;
  newRig.type = saveRig.type = 'button'; newRig.disabled = saveRig.disabled = true;
  const actions = make('div'); actions.className = 'mm-dialog-actions'; actions.append(newRig, saveRig, exportSettings);
  const feedback = make('p'); feedback.className = 'mm-caption'; feedback.setAttribute('role', 'status');
  settings.setAttribute('role', 'status');
  const local = make('p', 'Rigs and groups stay in this browser on this device and site address. They are not mixer settings or shared with other devices. Without a saved rig, Edit Groups uses one group set kept on this device; a selected saved rig keeps its own groups. Both work offline. Saving does not connect.'); local.className = 'mm-caption';
  form.append(profileLabel, nameLabel, addressLabel, known, actions, feedback, settings, local, connect, note);
  $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = levels ? 'Connect live IEM' : 'Connect read-only IEM';
  const closeButton = $('.mm-dialog-head button'); closeButton.disabled = false;
  const openButtons = [open, $('.mm-brand'), $('.mm-desk')];
  for (const button of openButtons) button.disabled = false;
  let focusBefore, beforeOpen = () => {}, connectionVisible = false, dialogLease = null;
  const show = () => {
    if (dialogOwner && !dialogOwner.owns(dialogLease)) {
      const next = dialogOwner.claim('connection', reason => closeFor(next, reason, true));
      if (!next) return; dialogLease = next;
    }
    beforeOpen();
    if (dialogOwner && !dialogOwner.owns(dialogLease)) return;
    connectionVisible = true; focusBefore = document.activeElement;
    $('.mm-dialog').classList.remove('mm-group-dialog', 'mm-pan-dialog');
    $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = levels ? 'Connect live IEM' : 'Connect read-only IEM';
    layer.hidden = false; address.focus();
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
      const nodes = [...layer.querySelectorAll('button,input,select,summary')].filter(node => !node.disabled && !node.closest('[hidden]') && (!node.closest('details') || node.tagName === 'SUMMARY' || node.closest('details').open)), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  root.addEventListener('keydown', onKey);
  for (const button of openButtons) button.addEventListener('click', show);
  const onCloseClick = event => { if (connectionVisible && (!dialogOwner || dialogOwner.owns(dialogLease))) { event.stopImmediatePropagation?.(); close(); } };
  closeButton.addEventListener('click', onCloseClick);
  return {
    form, profile, address, name, newRig, saveRig, exportSettings, feedback, connect, disconnect, settings, note, close, show, dialogOwner, beforeOpen(callback) { beforeOpen = callback; },
    navigation: [...root.querySelectorAll('.mm-entry-links a')],
    profiles(profiles, selectedId = '') {
      const option = make('option', 'Manual address — not a saved rig'); option.value = '';
      profile.replaceChildren(option);
      for (const rig of profiles) { const option = make('option', rig.name); option.value = rig.id; profile.append(option); }
      profile.value = selectedId;
    },
    destroy() { root.removeEventListener('keydown', onKey); for (const button of openButtons) button.removeEventListener('click', show); closeButton.removeEventListener('click', onCloseClick); },
  };
}

export function mountLiveController({ session, repository, view, ui, document = globalThis.document, window = globalThis.window, createID = () => globalThis.crypto.randomUUID(), downloadBackup }) {
  let touched = false, destroyed = false, profiles = [], localDefinitions = null, selectedAux = null;
  let setupIntent = 0, setupPending = Promise.resolve(), setupSaving = false;
  const feedback = message => { if (ui.feedback) ui.feedback.textContent = message; };
  const setupButtons = () => { if (ui.exportSettings) ui.exportSettings.disabled = !settingsReady; if (ui.newRig) ui.newRig.disabled = !settingsReady || profiles.length >= 32; if (ui.saveRig) ui.saveRig.disabled = !settingsReady || setupSaving; };
  const refreshPicker = () => { ui.profiles(profiles, boundProfileId || ''); setupButtons(); };
  let boundProfileId = null, contextRevision = 0, settingsReady = false, previousPhase = 'idle';
  let projected = { selectedAux: null, sources: [] }, requestedNavigation = null, restoreCandidate = null, receivedCatalog = [];
  let navIntent = 0, navPending = Promise.resolve(), navigationMessage = '', previousExpanded = null, previousControl = null;
  const profile = () => profiles.find(profile => profile.id === boundProfileId);
  // Group definitions belong to an explicitly bound saved rig, otherwise to the
  // single device-local set. A manual address never binds or infers a saved rig;
  // the local set's stable ID is created lazily by its first saved group.
  const owner = () => boundProfileId ? { kind: 'profile', id: boundProfileId } : settingsReady ? { kind: 'local', id: localDefinitions?.id ?? null } : null;
  const definition = () => boundProfileId ? profile() : localDefinitions;
  const localNavigation = () => {
    const value = resolveGroupNavigation(definition()?.groups || [], requestedNavigation);
    // Device-local definitions have no rig identity, so they never remember an AUX.
    return { mixId: selectedAux === null || !boundProfileId ? null : `a.${selectedAux}`, view: value.view, expandedGroupId: value.expandedGroupId };
  };
  const contextListeners = new Set();
  const names = rows => rows.map(source => ({ sourceId: source.sourceId, name: source.name }));
  const context = () => ({ profileId: boundProfileId, owner: owner(), ownerName: profile()?.name ?? null, revision: contextRevision, ready: settingsReady, selectedAux, expandedGroupId: selectedAux === null ? null : localNavigation().expandedGroupId,
    sources: names(projected.sources || []),
    // With no AUX selected (All Mixes), the editor may offer every source received on any available AUX.
    catalog: selectedAux === null ? names(receivedCatalog) : names(projected.sources || []) });
  let groupsSignature = '';
  const bindOwner = () => {
    const value = owner();
    if (session.bindGroupOwner) session.bindGroupOwner(value?.id ? value : null);
    else session.bindGroupProfile?.(boundProfileId);
  };
  const emitContext = () => { bindOwner(); groupsSignature = JSON.stringify([owner(), definition()?.groups]); for (const listener of contextListeners) listener(context()); };
  const invalidateDraft = (detach = false) => { session.invalidateLevelContext?.(); contextRevision++; if (detach) boundProfileId = null; emitContext(); };
  const handlers = [];
  const listen = (target, type, callback) => { target.addEventListener(type, callback); handlers.push([target, type, callback]); };
  const isActive = phase => ['connecting', 'connected', 'partial', 'live'].includes(phase);
  function render(snapshot = session.snapshot(), kind) {
    if (destroyed) return;
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
    if (model.notice || navigationMessage) model.status += ` · ${[model.notice, navigationMessage].filter(Boolean).join(' · ')}`;
    if (isActive(previousPhase) && !isActive(snapshot.phase)) contextRevision++;
    previousPhase = snapshot.phase;
    const controlSignature = JSON.stringify(snapshot.control);
    if (kind === 'meters' && view.renderMeters && controlSignature === previousControl) view.renderMeters(model);
    else view.render(model);
    previousControl = controlSignature;
    ui.connect.disabled = isActive(snapshot.phase); ui.disconnect.disabled = !isActive(snapshot.phase);
    ui.note.textContent = snapshot.detail;
    if (kind !== 'meters') emitContext();
  }
  const unsubscribe = session.subscribe(render);
  function invalidate(detach = false) { setupIntent++; touched = true; selectedAux = null; restoreCandidate = requestedNavigation = null; navIntent++; navigationMessage = ''; invalidateDraft(detach); session.disconnect(); }
  listen(ui.address, 'input', () => { invalidate(true); ui.profile.value = ''; ui.address.setCustomValidity(''); feedback('Manual address — not bound to a saved rig. Edit Groups uses the groups kept on this device.'); });
  listen(ui.profile, 'change', () => {
    invalidate(true);
    const rig = profiles.find(profile => profile.id === ui.profile.value);
    if (rig) { ui.address.value = rig.address; boundProfileId = rig.id; }
    if (ui.name) ui.name.value = rig?.name || '';
    feedback(rig ? 'Local rig selected. Edit Groups is available offline. Connect is a separate action.' : 'Manual address — not bound to a saved rig. Edit Groups uses the groups kept on this device.');
    refreshPicker(); render(); emitContext();
    ui.address.setCustomValidity('');
  });
  function exportCurrentSettings() {
    try { return exportSettingsBackup(repository, downloadBackup); }
    catch { return 'Could not start the settings backup download. Try Export settings again in this browser before leaving.'; }
  }
  if (ui.exportSettings) listen(ui.exportSettings, 'click', () => feedback(exportCurrentSettings()));
  if (ui.name) listen(ui.name, 'input', () => { touched = true; setupIntent++; feedback('Rig name draft. Save rig to apply locally.'); });
  if (ui.newRig) listen(ui.newRig, 'click', () => {
    if (!settingsReady || profiles.length >= 32) return;
    invalidate(true); ui.name.value = ''; refreshPicker(); render();
    feedback('New local rig draft. Enter a name and address, then Save rig.'); ui.name.focus?.();
  });
  if (ui.saveRig) listen(ui.saveRig, 'click', () => {
    if (!settingsReady || setupSaving) return;
    const id = boundProfileId || createID(), address = ui.address.value.trim(), name = ui.name.value.trim();
    const original = profile() && { id: profile().id, name: profile().name, address: profile().address };
    const change = settings => {
      const existing = settings.profiles.find(rig => rig.id === id);
      if (original) {
        if (!existing || existing.name !== original.name || existing.address !== original.address) throw Error('This rig changed. Select it again before saving.');
        existing.name = name; existing.address = address;
      } else {
        if (existing) throw Error('This rig identity already exists. Start a new rig.');
        settings.profiles.push({ id, name, address, groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } });
      }
      settings.selectedProfileId = id;
    };
    try { mixerURL(address); const candidate = structuredClone(repository.snapshot().settings); change(candidate); validateSettings(candidate); }
    catch (error) { feedback(`Rig not saved. ${error.message}`); return; }
    // Disconnect before accepting a new identity or queuing any persistence.
    invalidate(true); const intent = setupIntent;
    // Keep keyboard events inside the owned dialog when its focused Save is disabled.
    // Move focus only synchronously from this button; late completion never refocuses.
    if (document.activeElement === ui.saveRig) ui.name.focus?.();
    setupSaving = true; setupButtons(); feedback('Saving local rig…');
    const guarded = settings => {
      if (destroyed || setupIntent !== intent) throw Error('Rig context changed; save was not applied.');
      change(settings);
    };
    let pending;
    try { pending = repository.update(guarded); } catch (error) { pending = Promise.reject(error); }
    setupPending = Promise.resolve(pending).then(result => {
      if (destroyed || setupIntent !== intent) return;
      profiles = result.settings.profiles; localDefinitions = result.settings.localDefinitions; boundProfileId = id; ui.address.value = address; ui.name.value = name;
      refreshPicker(); emitContext(); render();
      feedback(result.status.mode === 'persistent' && result.status.state === 'saved'
        ? 'Rig saved on this device. Edit Groups is ready; Connect remains a separate action.'
        : 'Rig is temporary in this app. Choose Export settings here before closing or leaving this page; reopen after checking storage to try again.');
    }).catch(error => { if (!destroyed && setupIntent === intent) feedback(`Rig not saved. ${error.message}`); })
      .finally(() => { setupSaving = false; if (!destroyed) setupButtons(); });
  });
  listen(ui.form, 'submit', event => {
    event.preventDefault();
    if (destroyed || document.hidden || isActive(session.snapshot().phase)) return;
    setupIntent++; touched = true; selectedAux = null; requestedNavigation = null; restoreCandidate = null; navIntent++; navigationMessage = '';
    const bound = profiles.find(profile => profile.id === boundProfileId);
    invalidateDraft(!bound || bound.address !== ui.address.value.trim());
    if (boundProfileId) restoreCandidate = structuredClone(bound.navigation);
    ui.address.setCustomValidity('');
    if (session.connect(ui.address.value)) ui.close();
    else if (session.snapshot().phase === 'invalid') { ui.address.setCustomValidity(session.snapshot().detail); ui.address.reportValidity(); }
  });
  listen(ui.disconnect, 'click', () => { invalidate(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { invalidate(); ui.close(); } });
  listen(window, 'pagehide', () => { invalidate(); ui.close(); });
  for (const link of ui.navigation || []) listen(link, 'click', event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && (event.button === undefined || event.button === 0)) invalidate();
  });
  ui.profiles([]);
  const unsubscribeSettings = repository.subscribe?.(({ settings, status }) => {
    if (status) ui.settings.textContent = settingsStatusText(status);
    if (!settingsReady || destroyed) return;
    profiles = settings.profiles; localDefinitions = settings.localDefinitions; refreshPicker(); view.preferences(settings.preferences);
    if (JSON.stringify([owner(), definition()?.groups]) !== groupsSignature) session.invalidateLevelContext?.();
    if (boundProfileId && (!profile() || profile().address !== ui.address.value.trim())) { invalidate(true); refreshPicker(); }
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
    const change = settings => {
      if (destroyed || token.intent !== navIntent || !sameOwner(token) || token.revision !== contextRevision) throw Error('View context changed; navigation was not applied.');
      const rig = token.owner.kind === 'profile' ? settings.profiles.find(profile => profile.id === token.owner.id)
        : settings.localDefinitions?.id === token.owner.id ? settings.localDefinitions : null;
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
    const { settings, status } = repository.snapshot?.() || result;
    profiles = settings.profiles; localDefinitions = settings.localDefinitions; settingsReady = true;
    const rig = !touched && !isActive(session.snapshot().phase) ? profiles.find(profile => profile.id === settings.selectedProfileId) : null;
    ui.profiles(profiles, rig?.id || '');
    if (rig) { ui.address.value = rig.address; boundProfileId = rig.id; }
    if (ui.name && !touched) ui.name.value = rig?.name || '';
    feedback(rig ? 'Local rig selected. Edit Groups is available offline. Connect is a separate action.' : 'Manual address — not bound to a saved rig. Edit Groups uses the groups kept on this device.');
    refreshPicker(); render(); emitContext();
    view.preferences(settings.preferences);
    ui.settings.textContent = settingsStatusText(status);
  }).catch(() => { if (!destroyed) ui.settings.textContent = 'Could not load local rigs. Manual Connect still works.'; });
  return {
    ready,
    whenSetupIdle: () => setupPending,
    exportSettings: exportCurrentSettings,
    context,
    subscribeContext(listener) { contextListeners.add(listener); listener(context()); return () => contextListeners.delete(listener); },
    selectAux(index) {
      const snapshot = session.snapshot(), candidate = projectLiveState(snapshot, index);
      if (candidate.selectedAux === null || selectedAux === candidate.selectedAux) return false;
      selectedAux = candidate.selectedAux;
      if (owner()?.kind === 'local') {
        // The device-local set has no AUX identity: restore its last view on any AUX.
        const saved = definition()?.navigation;
        chooseNavigation(saved ? { mixId: null, view: saved.view, expandedGroupId: saved.expandedGroupId } : null);
        return true;
      }
      const saved = boundProfileId ? profile()?.navigation : null, legacy = /^a\.([0-9])$/.exec(saved?.mixId || '');
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
    destroy() { invalidateDraft(true); destroyed = true; contextListeners.clear(); navIntent++; unsubscribeSettings(); unsubscribe(); session.disconnect(); for (const [target, type, callback] of handlers) target.removeEventListener(type, callback); ui.destroy?.(); view.destroy(); },
  };
}
