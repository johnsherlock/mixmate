import { projectLiveState } from './live-provider.js';

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
  let focusBefore;
  const show = () => { focusBefore = document.activeElement; layer.hidden = false; address.focus(); };
  const close = () => { layer.hidden = true; focusBefore?.focus?.(); };
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
    form, profile, address, connect, disconnect, settings, note, close,
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
  const handlers = [];
  const listen = (target, type, callback) => { target.addEventListener(type, callback); handlers.push([target, type, callback]); };
  const isActive = phase => ['connecting', 'connected', 'partial', 'live'].includes(phase);
  function render(snapshot = session.snapshot()) {
    if (destroyed) return;
    const model = projectLiveState(snapshot, selectedAux);
    selectedAux = model.selectedAux;
    view.render(model);
    ui.connect.disabled = isActive(snapshot.phase); ui.disconnect.disabled = !isActive(snapshot.phase);
    ui.note.textContent = snapshot.detail;
  }
  const unsubscribe = session.subscribe(render);
  function invalidate() { touched = true; selectedAux = null; session.disconnect(); }
  listen(ui.address, 'input', () => { invalidate(); ui.profile.value = ''; ui.address.setCustomValidity(''); });
  listen(ui.profile, 'change', () => {
    invalidate();
    const rig = profiles.find(profile => profile.id === ui.profile.value);
    if (rig) ui.address.value = rig.address;
    ui.address.setCustomValidity('');
  });
  listen(ui.form, 'submit', event => {
    event.preventDefault();
    if (destroyed || document.hidden || isActive(session.snapshot().phase)) return;
    touched = true; selectedAux = null; ui.address.setCustomValidity('');
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
  const ready = repository.initialize().then(({ settings, status }) => {
    if (destroyed) return;
    profiles = settings.profiles;
    const rig = !touched && !isActive(session.snapshot().phase) ? profiles.find(profile => profile.id === settings.selectedProfileId) : null;
    ui.profiles(profiles, rig?.id || '');
    if (rig) ui.address.value = rig.address;
    view.preferences(settings.preferences);
    ui.settings.textContent = status.mode === 'persistent' ? 'Saved local rig definitions. Edit/save rigs in the connection test.' : 'Local rigs are temporary/unavailable. Manual Connect still works.';
  }).catch(() => { if (!destroyed) ui.settings.textContent = 'Could not load local rigs. Manual Connect still works.'; });
  return {
    ready,
    selectAux(index) { selectedAux = index; render(); },
    overview() { selectedAux = null; render(); },
    destroy() { destroyed = true; unsubscribe(); session.disconnect(); for (const [target, type, callback] of handlers) target.removeEventListener(type, callback); ui.destroy?.(); view.destroy(); },
  };
}
