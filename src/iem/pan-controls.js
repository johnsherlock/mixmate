import { installFaderGestures } from './gestures.js';
import { restoreDialogFocus } from './dialog-owner.js';
import { sourceLabel } from './live-provider.js';
import { stereoRelationship } from './protocol.js';
import { resolveAuxPanTargets } from './aux-pan-protocol.js';
import { commonPanWire, panDisplayText } from './pan-display.js';

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
// F09-S09: the dialog matches the prototype/Demo (MIX · CHANNEL · PAN, LEFT /
// CENTRE / RIGHT, a large L/CENTRE/R readout, full-width slider, Hard L / Centre /
// Hard R, a small footer). Raw values, status and Details exist only with ?debug.
export const PAN_FOOTER = 'Fine control · full-width travel';
export function panUnavailableText(actual) {
  if (actual.values.some(item => !item.known)) return 'Pan not received';
  if (commonPanWire(actual.values.map(item => item.value)) === undefined) return 'Read-only · L/R pan unequal';
  return 'Pan unavailable';
}
export function mountPanControls({ root, session, controller, dialogOwner, window = globalThis.window, debug = false }) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button');
  const content = make('div', 'mm-live-pan-controls');
  const labels = make('div', 'mm-pan-labels'); for (const value of ['LEFT', 'CENTRE', 'RIGHT']) labels.append(make('span', '', value));
  const valueLabel = make('div', 'mm-pan-value', '—');
  const input = make('input', 'mm-pan-large'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = 'any'; input.dataset.gestureStep = '0.001'; input.disabled = true;
  input.setAttribute('aria-label', 'AUX send pan; cap drag, double track tap or arrow keys; changes are sent live while you drag');
  const presets = make('div', 'mm-pan-presets'), presetButtons = [[0, 'Hard L', 'hard left'], [0.5, 'Centre', 'centre'], [1, 'Hard R', 'hard right']].map(([value, text, aria]) => {
    const button = make('button', '', text); button.type = 'button'; button.dataset.panPreset = String(value); button.setAttribute('aria-label', `Pan ${aria}`); presets.append(button); return button;
  });
  // The footer doubles as the compact one-line reason while pan is read-only.
  const footer = make('div', 'mm-pan-keys', PAN_FOOTER); footer.setAttribute('role', 'status'); footer.setAttribute('aria-live', 'polite');
  content.append(labels, valueLabel, input, presets, footer);
  // Development-only diagnostics (?debug): never created otherwise.
  let diag = null;
  if (debug) {
    const previewLabel = make('p', 'mm-pan-diagnostic', 'Preview wire position: —'), status = make('p', 'mm-pan-status');
    const details = make('details', 'mm-pan-details'), summary = make('summary', '', 'Details'), description = make('p', 'mm-caption', 'Normalized wire position; L/CENTRE/R is display only (wire 0 = L 100, 0.5 = CENTRE, 1 = R 100). Stereo balance is unverified.'), readbacks = make('div', 'mm-pan-readbacks');
    details.append(summary, description, readbacks); content.append(previewLabel, status, details);
    diag = { previewLabel, status, details, readbacks, rows: new Map() };
  }
  const showValue = wire => {
    const text = panDisplayText(wire);
    valueLabel.textContent = text ?? '—';
    if (text) input.setAttribute('aria-valuetext', `Pan ${text}`); else input.removeAttribute?.('aria-valuetext');
  };
  let lease = null, target = null, binding = null, focusBefore, gestures = null, preview = false, destroyed = false, boundListeners = [];
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
    $('#mm-dialog-title').textContent = panTitle(snapshot.observations, receivedName);
    const selected = control?.selected?.kind === 'pan' && control.selected.sourceId === target.sourceId && control.selected.auxIndex === target.auxIndex;
    content.dataset.panKnown = String(Boolean(actual.values[0]?.known));
    const enabled = selected && control.eligible && !control.dispatching;
    if (!control?.gestureActive && preview) { preview = false; gestures?.cancel(); }
    input.disabled = !enabled;
    for (const button of presetButtons) button.disabled = !enabled;
    if (!preview) {
      // Same rule as the strip Pan button (F09-S09 review P1): this owner's
      // requested value only while its gesture or own echoes are live. After an
      // unconfirmed send's window the retained chain is not shown as the value:
      // readout, aria-valuetext and slider show the shared received value, else
      // a dash (unknown or unequal sides).
      const live = selected && (control.gestureActive || control.pending) && typeof control.requestedValue === 'number';
      const shown = live ? control.requestedValue : commonPanWire(actual.values.map(item => item.value));
      input.value = shown !== undefined ? String(shown) : actual.values[0].known ? String(actual.values[0].value) : '0';
      showValue(shown);
    }
    const statusText = control?.pending ? control.status : actual.reason || (selected ? control.status : control?.status || 'Pan adjustment unavailable.');
    // A live gesture's own dispatch never flashes a reason into the footer.
    const quiet = enabled || selected && (control.gestureActive || control.dispatching) && !actual.reason;
    const reason = quiet ? '' : actual.reason ? panUnavailableText(actual) : selected ? control.reason || control.status : 'Pan unavailable';
    footer.textContent = reason || PAN_FOOTER; footer.dataset.state = quiet ? 'editable' : 'read-only'; footer.setAttribute('title', quiet ? '' : statusText);
    if (diag) renderDiagnostics(actual, control, selected, enabled, statusText);
    gestures?.sync();
  }
  function panTitle(observations, channel) {
    const mix = observations?.get?.(`a.${target.auxIndex}.name`);
    return `${typeof mix === 'string' && mix ? mix : `AUX ${target.auxIndex + 1}`} · ${channel} · PAN`;
  }
  function renderDiagnostics(actual, control, selected, enabled, statusText) {
    const { rows, readbacks } = diag, ids = new Set(actual.values.map(item => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    for (const [index, item] of actual.values.entries()) {
      let row = rows.get(item.id); if (!row) { row = make('p'); rows.set(item.id, row); readbacks.append(row); }
      if (readbacks.children[index] !== row) readbacks.insertBefore(row, readbacks.children[index] || null);
      row.textContent = `${sourceLabel(item.id)} received normalized pan: ${item.known ? String(item.value) : 'not received'}`;
      row.setAttribute('title', row.textContent);
    }
    if (!preview) diag.previewLabel.textContent = selected && typeof control?.expectedPan === 'number' ? `Requested ${control.expectedPan}` : control?.requestedDiagnostic?.length ? `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')}` : `Received ${actual.values[0]?.known ? actual.values[0].value : '—'}`;
    diag.status.hidden = Boolean(enabled && !control?.pending && !actual.reason && !control?.authorized);
    diag.status.textContent = statusText;
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
    $('#mm-dialog-title').textContent = panTitle(session.snapshot().observations, name);
    if (diag) diag.details.open = false;
    body.replaceChildren(content); layer.hidden = false;
    session.selectPanTarget(target);
    if (!owns(next)) return false;
    const begin = () => owns(next) ? session.beginPanGesture() : null;
    const update = (token, value) => {
      if (!owns(next)) return null;
      const wire = session.previewPanGesture(token, value);
      if (wire !== null) { preview = true; showValue(wire); if (diag) diag.previewLabel.textContent = `Preview ${wire.toFixed(3)}`; }
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
