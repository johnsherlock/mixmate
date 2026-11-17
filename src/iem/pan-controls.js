import { installFaderGestures } from './gestures.js';
import { restoreDialogFocus } from './dialog-owner.js';
import { sourceLabel } from './live-provider.js';
import { stereoRelationship } from './protocol.js';
import { resolveAuxPanTargets } from './aux-pan-protocol.js';

// Presentation copies never grant authority: only the private session's pan API
// can select/begin/commit. Raw normalized receive values remain visible unchanged.
export function projectPanReadback(snapshot, target) {
  const received = snapshot.observations, link = stereoRelationship(received, `a.${target.auxIndex}`);
  const outputs = link.status === 'linked' ? link.members : [`a.${target.auxIndex}`];
  const values = outputs.map(id => {
    const path = `${target.sourceId}.aux.${Number(id.slice(2))}.pan`, value = received.get(path);
    const known = received.has(path) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    return { id, known, value: known ? value : undefined };
  });
  let reason = '';
  try { resolveAuxPanTargets(received, target); } catch (error) { reason = error.message; }
  return { values, reason };
}
export function mountPanControls({ root, session, controller, dialogOwner, window = globalThis.window }) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button');
  const content = make('div', 'mm-live-pan-controls'), description = make('p', 'mm-caption', 'Normalized position only · physical directions and stereo balance are unverified.');
  const labels = make('div', 'mm-pan-labels'); for (const value of ['0', '0.5', '1']) labels.append(make('span', '', value));
  const readbacks = make('div', 'mm-pan-readbacks'), previewLabel = make('div', 'mm-pan-value', 'Preview wire position: —');
  const input = make('input', 'mm-pan-large'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = 'any'; input.dataset.gestureStep = '0.001'; input.disabled = true;
  input.setAttribute('aria-label', 'Normalized pan preview; cap drag, double track tap or arrow keys; release to apply');
  const presets = make('div', 'mm-pan-presets'), presetButtons = [0, 0.5, 1].map(value => {
    const button = make('button', '', String(value)); button.type = 'button'; button.setAttribute('aria-label', `Apply normalized pan position ${value}`); presets.append(button); return button;
  });
  const status = make('p', 'mm-pan-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  content.append(description, readbacks, labels, previewLabel, input, presets, status);
  let lease = null, target = null, binding = null, focusBefore, gestures = null, preview = false, destroyed = false, boundListeners = [];
  const rows = new Map();
  const owns = token => !destroyed && lease === token && dialogOwner.owns(token);
  function closeFor(token, reason = {}, fromOwner = false) {
    if (!token || lease !== token || !fromOwner && !dialogOwner.owns(token)) return;
    input.disabled = true;
    for (const button of presetButtons) button.disabled = true;
    lease = null; target = binding = null; preview = false;
    gestures?.destroy(); gestures = null;
    for (const [node, type, fn] of boundListeners) node.removeEventListener(type, fn); boundListeners = [];
    dialogOwner.release(token); session.closePan?.();
    if (!dialogOwner.active()) { layer.hidden = true; dialog.classList.remove('mm-pan-dialog'); }
    if (!reason.replaced && !dialogOwner.active()) restoreDialogFocus(focusBefore);
  }
  function render(snapshot = session.snapshot()) {
    if (!lease || !owns(lease)) return;
    if (!['connecting', 'connected', 'partial', 'live'].includes(snapshot.phase)) { closeFor(lease); return; }
    const control = snapshot.control;
    if (control?.selected && control.selected.kind !== 'pan') { closeFor(lease); return; }
    const actual = projectPanReadback(snapshot, target);
    const receivedName = snapshot.observations.get(`${target.sourceId}.name`) || sourceLabel(target.sourceId);
    $('#mm-dialog-title').textContent = `AUX ${target.auxIndex + 1} · ${receivedName} · NORMALIZED PAN`;
    const selected = control?.selected?.kind === 'pan' && control.selected.sourceId === target.sourceId && control.selected.auxIndex === target.auxIndex;
    content.dataset.panKnown = String(Boolean(actual.values[0]?.known));
    const enabled = selected && control.eligible && !control.dispatching;
    if (!control?.gestureActive && preview) { preview = false; gestures?.cancel(); }
    input.disabled = !enabled;
    for (const button of presetButtons) button.disabled = !enabled;
    const ids = new Set(actual.values.map(item => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    for (const [index, item] of actual.values.entries()) {
      let row = rows.get(item.id); if (!row) { row = make('p'); rows.set(item.id, row); readbacks.append(row); }
      if (readbacks.children[index] !== row) readbacks.insertBefore(row, readbacks.children[index] || null);
      row.textContent = `${sourceLabel(item.id)} received normalized pan: ${item.known ? String(item.value) : 'not received'}`;
      row.setAttribute('title', row.textContent);
    }
    if (!preview) {
      const received = actual.values[0]; input.value = selected && typeof control?.requestedValue === 'number' ? String(control.requestedValue) : received.known ? String(received.value) : '0';
      previewLabel.textContent = selected && typeof control?.expectedPan === 'number' ? `Requested wire position: ${control.expectedPan}; application unverified` : control?.requestedDiagnostic?.length ? `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')}` : 'Requested wire position: —';
    }
    status.textContent = control?.pending ? control.status : actual.reason || (selected ? control.status : control?.status || 'Pan adjustment unavailable.');
    gestures?.sync();
  }
  function open(request) {
    if (destroyed) return false;
    const context = controller.context();
    if (context.selectedAux !== request.auxIndex || !context.sources.some(source => source.sourceId === request.sourceId)) return false;
    if (lease) closeFor(lease, { replaced: true });
    controller.clearLevelContext();
    const next = dialogOwner.claim('pan', reason => closeFor(next, reason, true));
    if (!next) return false;
    lease = next; target = Object.freeze({ sourceId: request.sourceId, auxIndex: request.auxIndex });
    const current = controller.context(); binding = { profileId: current.profileId, revision: current.revision, selectedAux: current.selectedAux };
    focusBefore = document.activeElement;
    dialog.classList.remove('mm-group-dialog'); dialog.classList.add('mm-pan-dialog');
    const name = current.sources.find(source => source.sourceId === target.sourceId)?.name || sourceLabel(target.sourceId);
    $('#mm-dialog-title').textContent = `AUX ${target.auxIndex + 1} · ${name} · NORMALIZED PAN`;
    body.replaceChildren(content); layer.hidden = false;
    session.selectPanTarget(target);
    if (!owns(next)) return false;
    const begin = () => owns(next) ? session.beginPanGesture() : null;
    const update = (token, value) => {
      if (!owns(next)) return null;
      const wire = session.previewPanGesture(token, value);
      if (wire !== null) { preview = true; previewLabel.textContent = `Preview wire position: ${wire.toFixed(3)}`; }
      return wire;
    };
    gestures = installFaderGestures(content, {
      onBegin: begin,
      onPreview: (node, token, value) => update(token, value),
      onCommit(node, token) { preview = false; if (owns(next)) session.commitPanGesture(token); },
      onCancel() { preview = false; if (owns(next)) session.cancelPanGesture(); },
    });
    const listen = (node, type, fn) => { node.addEventListener(type, fn); boundListeners.push([node, type, fn]); };
    presetButtons.forEach((button, index) => listen(button, 'click', () => {
      if (!owns(next) || button.disabled) return;
      const token = begin(); if (!token) return;
      if (update(token, [0, 0.5, 1][index]) !== null) { preview = false; session.commitPanGesture(token); }
    }));
    listen(closeButton, 'click', event => { if (owns(next)) { event.stopImmediatePropagation?.(); closeFor(next); } });
    listen(root, 'keydown', event => { if (owns(next) && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation?.(); closeFor(next); } });
    gestures.prepare(); render();
    (input.disabled ? closeButton : input).focus();
    return true;
  }
  const unsubscribe = session.subscribe(snapshot => render(snapshot));
  const unsubscribeContext = controller.subscribeContext(context => {
    if (lease && (context.profileId !== binding.profileId || context.revision !== binding.revision || context.selectedAux !== binding.selectedAux)) closeFor(lease);
  });
  const sync = () => gestures?.sync(); window?.addEventListener('resize', sync); window?.visualViewport?.addEventListener('resize', sync);
  return {
    open,
    close: () => closeFor(lease),
    destroy() { closeFor(lease); destroyed = true; unsubscribe(); unsubscribeContext(); window?.removeEventListener('resize', sync); window?.visualViewport?.removeEventListener('resize', sync); },
  };
}
