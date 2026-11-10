import { projectLiveState } from './live-provider.js';
import { projectGroupNavigation, resolveGroupNavigation } from './group-navigation.js';

export function createLiveConnectionUI(root) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const open = make('button', 'Connect to desk'), disconnect = make('button', 'Disconnect');
  open.type = disconnect.type = 'button'; open.className = 'mm-connect-toggle'; disconnect.className = 'mm-session-disconnect';
  $('.mm-preview').append(open, disconnect);
  const layer = $('.mm-layer'), form = make('form'); form.className = 'mm-live-connection';
  const profile = make('select'), address = make('input'), connect = make('button', 'Connect read-only');
  address.value = '192.168.0.60'; address.required = true; address.autocomplete = 'off'; address.spellcheck = false;
  address.setAttribute('inputmode', 'decimal'); address.setAttribute('list', 'iem-known-addresses');
  const known = make('datalist'); known.id = 'iem-known-addresses';
  for (const value of ['192.168.0.60', '192.168.1.60']) { const option = make('option'); option.value = value; known.append(option); }
  const profileLabel = make('label', 'Saved local rig'), addressLabel = make('label', 'Mixer private IPv4 address');
  profileLabel.append(profile); addressLabel.append(address); connect.type = 'submit';
  const settings = make('p', 'Loading local rigs; manual Connect is available now.'), note = make('p', 'Only received state is shown. No mixer parameter writes.');
  settings.className = note.className = 'mm-caption'; note.setAttribute('role', 'status');
  form.append(profileLabel, addressLabel, known, settings, connect, note);
  $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = 'Connect read-only IEM';
  const closeButton = $('.mm-dialog-head button'); closeButton.disabled = false;
  const openButtons = [open, $('.mm-brand'), $('.mm-desk')];
  for (const button of openButtons) button.disabled = false;
  let focusBefore, beforeOpen = () => {}, connectionVisible = false;
  const show = () => {
    beforeOpen(); connectionVisible = true; focusBefore = document.activeElement;
    $('.mm-dialog').classList.remove('mm-group-dialog');
    $('.mm-dialog-body').replaceChildren(form); $('#mm-dialog-title').textContent = 'Connect read-only IEM';
    layer.hidden = false; address.focus();
  };
  const close = () => { if (!connectionVisible) return; connectionVisible = false; layer.hidden = true; focusBefore?.focus?.(); };
  const onKey = event => {
    if (layer.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const nodes = [...layer.querySelectorAll('button,input,select')].filter(node => !node.disabled), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  root.addEventListener('keydown', onKey);
  for (const button of openButtons) button.addEventListener('click', show);
  closeButton.addEventListener('click', close);
  return {
    form, profile, address, connect, disconnect, settings, note, close, beforeOpen(callback) { beforeOpen = callback; },
    navigation: [...root.querySelectorAll('.mm-entry-links a')],
    profiles(profiles, selectedId = '') {
      const option = make('option', 'Manual address — not a saved rig'); option.value = '';
      profile.replaceChildren(option);
      for (const rig of profiles) { const option = make('option', rig.name); option.value = rig.id; profile.append(option); }
      profile.value = selectedId;
    },
    destroy() { root.removeEventListener('keydown', onKey); for (const button of openButtons) button.removeEventListener('click', show); closeButton.removeEventListener('click', close); },
  };
}

export function mountLiveController({ session, repository, view, ui, document = globalThis.document, window = globalThis.window }) {
  let touched = false, destroyed = false, profiles = [], selectedAux = null;
  let boundProfileId = null, contextRevision = 0, settingsReady = false, previousPhase = 'idle';
  let projected = { selectedAux: null, sources: [] }, requestedNavigation = null, restoreCandidate = null;
  let navIntent = 0, navPending = Promise.resolve(), navigationMessage = '', previousExpanded = null;
  const profile = () => profiles.find(profile => profile.id === boundProfileId);
  const localNavigation = () => {
    const value = resolveGroupNavigation(profile()?.groups || [], requestedNavigation);
    return { mixId: selectedAux === null ? null : `a.${selectedAux}`, view: value.view, expandedGroupId: value.expandedGroupId };
  };
  const contextListeners = new Set();
  const context = () => ({ profileId: boundProfileId, revision: contextRevision, ready: settingsReady, selectedAux, expandedGroupId: selectedAux === null ? null : localNavigation().expandedGroupId,
    sources: (projected.sources || []).map(source => ({ sourceId: source.sourceId, name: source.name })) });
  const emitContext = () => { for (const listener of contextListeners) listener(context()); };
  const invalidateDraft = (detach = false) => { contextRevision++; if (detach) boundProfileId = null; emitContext(); };
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
    if (selectedAux !== base.selectedAux) contextRevision++;
    selectedAux = base.selectedAux; projected = base;
    const model = projectGroupNavigation(base, profile(), requestedNavigation);
    if (previousExpanded !== model.expandedGroupId) contextRevision++;
    previousExpanded = model.expandedGroupId;
    if (model.notice || navigationMessage) model.status += ` · ${[model.notice, navigationMessage].filter(Boolean).join(' · ')}`;
    if (isActive(previousPhase) && !isActive(snapshot.phase)) contextRevision++;
    previousPhase = snapshot.phase;
    if (kind === 'meters' && view.renderMeters) view.renderMeters(model);
    else view.render(model);
    ui.connect.disabled = isActive(snapshot.phase); ui.disconnect.disabled = !isActive(snapshot.phase);
    ui.note.textContent = snapshot.detail;
    if (kind !== 'meters') emitContext();
  }
  const unsubscribe = session.subscribe(render);
  function invalidate(detach = false) { touched = true; selectedAux = null; restoreCandidate = requestedNavigation = null; navIntent++; navigationMessage = ''; invalidateDraft(detach); session.disconnect(); }
  listen(ui.address, 'input', () => { invalidate(true); ui.profile.value = ''; ui.address.setCustomValidity(''); });
  listen(ui.profile, 'change', () => {
    invalidate(true);
    const rig = profiles.find(profile => profile.id === ui.profile.value);
    if (rig) { ui.address.value = rig.address; boundProfileId = rig.id; }
    emitContext();
    ui.address.setCustomValidity('');
  });
  listen(ui.form, 'submit', event => {
    event.preventDefault();
    if (destroyed || document.hidden || isActive(session.snapshot().phase)) return;
    touched = true; selectedAux = null; requestedNavigation = null; restoreCandidate = null; navIntent++; navigationMessage = '';
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
  const unsubscribeSettings = repository.subscribe?.(({ settings }) => {
    if (!settingsReady || destroyed) return;
    profiles = settings.profiles;
    if (boundProfileId && !profile()) { boundProfileId = null; navIntent++; restoreCandidate = requestedNavigation = null; invalidateDraft(); }
    render();
  }) || (() => {});
  function persistNavigation() {
    if (!settingsReady || !profile() || typeof repository.update !== 'function') return;
    const token = { intent: ++navIntent, profileId: boundProfileId, revision: contextRevision }, navigation = localNavigation();
    navigationMessage = 'Saving view on this device…';
    const change = settings => {
      if (destroyed || token.intent !== navIntent || token.profileId !== boundProfileId || token.revision !== contextRevision) throw Error('View context changed; navigation was not applied.');
      const rig = settings.profiles.find(profile => profile.id === token.profileId);
      if (!rig) throw Error('Local rig is unavailable.');
      if (navigation.expandedGroupId && !rig.groups.some(group => group.id === navigation.expandedGroupId)) throw Error('Group changed before saving the view.');
      rig.navigation = structuredClone(navigation);
    };
    let pending;
    try { pending = repository.update(change); } catch (error) { pending = Promise.reject(error); }
    navPending = Promise.resolve(pending).then(result => {
      if (destroyed || token.intent !== navIntent || token.profileId !== boundProfileId || token.revision !== contextRevision) return;
      navigationMessage = result.status.mode === 'persistent' && result.status.state === 'saved' ? 'View saved on this device.' : 'View is temporary; not saved on this device.';
      render();
    }).catch(() => {
      if (!destroyed && token.intent === navIntent && token.profileId === boundProfileId && token.revision === contextRevision) { navigationMessage = 'View is temporary; not saved on this device.'; render(); }
    });
  }
  function chooseNavigation(next) {
    restoreCandidate = null; requestedNavigation = next;
    invalidateDraft(); render(); persistNavigation(); render();
  }
  const ready = repository.initialize().then(result => {
    if (destroyed) return;
    const { settings, status } = repository.snapshot?.() || result;
    profiles = settings.profiles; settingsReady = true;
    const rig = !touched && !isActive(session.snapshot().phase) ? profiles.find(profile => profile.id === settings.selectedProfileId) : null;
    ui.profiles(profiles, rig?.id || '');
    if (rig) { ui.address.value = rig.address; boundProfileId = rig.id; }
    emitContext();
    view.preferences(settings.preferences);
    ui.settings.textContent = status.mode === 'persistent' ? 'Saved local rigs. Use Settings / test to edit rigs, preferences or backups.' : 'Local rigs are temporary/unavailable. Manual Connect still works.';
  }).catch(() => { if (!destroyed) ui.settings.textContent = 'Could not load local rigs. Manual Connect still works.'; });
  return {
    ready,
    context,
    subscribeContext(listener) { contextListeners.add(listener); listener(context()); return () => contextListeners.delete(listener); },
    selectAux(index) {
      if (selectedAux === index || projectLiveState(session.snapshot(), index).selectedAux === null) return false;
      selectedAux = index;
      const saved = profile()?.navigation;
      chooseNavigation(saved?.mixId === `a.${index}` ? structuredClone(saved) : null);
      return true;
    },
    toggleGroup(id) {
      if (selectedAux === null || !profile()?.groups.some(group => group.id === id)) return false;
      const current = localNavigation();
      chooseNavigation({ view: 'groups', expandedGroupId: current.view === 'groups' && current.expandedGroupId === id ? null : id });
      return true;
    },
    allChannels() { if (selectedAux !== null && localNavigation().view !== 'channels') chooseNavigation({ view: 'channels', expandedGroupId: null }); },
    overview() { selectedAux = null; chooseNavigation({ view: profile()?.groups.length ? 'groups' : 'channels', expandedGroupId: null }); },
    whenNavigationIdle: () => navPending,
    destroy() { invalidateDraft(true); destroyed = true; contextListeners.clear(); navIntent++; unsubscribeSettings(); unsubscribe(); session.disconnect(); for (const [target, type, callback] of handlers) target.removeEventListener(type, callback); ui.destroy?.(); view.destroy(); },
  };
}
