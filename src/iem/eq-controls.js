import { installFaderGestures } from './gestures.js';
import { stereoRelationship } from './protocol.js';
import { AUX_EQ_DISPLAY_CENTRES, auxEqPositionToDb } from './aux-eq-protocol.js';
import { AUX_EQ_POINT_COUNT, auxEqCentreX, auxEqPointGain, mapRequestedAuxEqCurve, pointCentreGainLimit, requestedDrawSamples, requestedPointSamples } from './aux-eq-curve.js';

// Live AUX GEQ view. Presentation copies never grant authority: only the private
// session's typed GEQ API can select/begin/preview/commit. Received per-side band
// values stay separate from the requested curve; mixer strings use textContent.
const SVG = 'http://www.w3.org/2000/svg';
const BANDS = AUX_EQ_DISPLAY_CENTRES.length;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const hzText = f => f >= 1000 ? `${(f / 1000).toFixed(f < 10000 ? 2 : 1)} kHz` : `${Math.round(f)} Hz`;
const dbText = value => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
// Same request-side rules as the private owner (control-state-model.js, which
// only session-core may import): the observed desk echoes to 10 significant
// digits and a band within 1e-9 of its last request is not re-sent.
const ANCHOR_EPSILON = 1e-9;
const deskFormat = value => (value === 0 ? 0 : Number(value.toPrecision(10)));
const flatPoints = () => [0.233, 0.566, 0.85].map(x => ({ x, gainDb: 0, q: 0.5 }));
export const EQ_APPROXIMATION_NOTE = 'Approximation: band centres are the native display labels (20 Hz–20 kHz), not verified DSP centres. Lines join band values; they are not a measured response. No shelves, cuts, filters or parametric bands.';
// Editable basis: the session coordinate — received band values, or the last
// requested values while the desk has not echoed them (shown dashed).
// F09-S07 (user decision 2026-11-20): points are persistent parametric drawing
// aids over an anchored base, like the Demo, within one editing session.
export const EQ_MODE_NOTES = Object.freeze({
  points: 'Points: three persistent shape points (frequency, width, gain) over the curve captured when point editing starts. The requested curve is that base plus every point\'s bump at the 31 band centres, so moving FREQ or WIDTH moves a point\'s bump and the bands it leaves go back. Points restart at 0 dB from the current curve after a draw, a reset or a change made elsewhere.',
  draw: 'Draw: starts from the current editable basis (received bands, or your last requested curve if the desk has not echoed it); drag across the graph to redraw bands. Changed bands are sent live while you draw (throttled); release sends the final drawn bands.',
});
export const EQ_SIDE_COLOURS = Object.freeze(['#7fd17f', '#e58ee5']);

export function projectEqReadback(snapshot, auxIndex) {
  const observations = snapshot?.observations instanceof Map ? snapshot.observations : new Map(), eq = snapshot?.eq instanceof Map ? snapshot.eq : new Map();
  const id = `a.${auxIndex}`, link = stereoRelationship(observations, id), ids = link.status === 'linked' ? link.members : [id];
  const sides = ids.map(output => {
    const bands = AUX_EQ_DISPLAY_CENTRES.map((_, band) => { const value = eq.get(`${output}.eq.peak.${band}`); return unit(value) ? value : undefined; });
    const bypass = eq.get(`${output}.eq.bypass`);
    return { auxIndex: Number(output.slice(2)), bands, received: bands.filter(value => value !== undefined).length, bypass: typeof bypass === 'boolean' ? bypass : undefined };
  });
  const complete = sides.every(side => side.received === BANDS && side.bypass !== undefined);
  const equal = sides.length === 1 || sides[0].bypass === sides[1].bypass && sides[0].bands.every((value, index) => value !== undefined && value === sides[1].bands[index]);
  return { link: link.status, sides, complete, equal, bypassed: sides.some(side => side.bypass === true) };
}
export function eqSideText(side) {
  return `Output ${side.auxIndex + 1} · GEQ ${side.bypass === true ? 'BYPASSED on desk (status only; MixMate never changes bypass)' : side.bypass === false ? 'active' : 'bypass not received'} · ${side.received}/${BANDS} bands received`;
}
function unavailableReason(readback) {
  if (!['mono', 'linked'].includes(readback.link)) return 'Output link metadata is unknown or conflicting; GEQ stays read-only.';
  if (!readback.complete) return 'Waiting for every band and bypass state on each side; GEQ stays read-only.';
  if (!readback.equal) return 'Unequal linked GEQ profiles stay read-only; MixMate never equalizes sides.';
  return 'GEQ adjustment unavailable.';
}

export function mountEqControls({ root, session, controller, window = globalThis.window }) {
  const document = root.ownerDocument;
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const svgNode = (tag, className) => {
    const node = document.createElementNS ? document.createElementNS(SVG, tag) : document.createElement(tag);
    if (className) node.setAttribute('class', className);
    return node;
  };
  const button = (text, label) => { const node = make('button', '', text); node.type = 'button'; if (label) node.setAttribute('aria-label', label); return node; };
  const section = make('section', 'mm-live-eq'); section.hidden = true; section.setAttribute('aria-label', 'AUX graphic EQ');
  const head = make('div', 'mm-live-eq-head'), back = button('← Mix', 'Close EQ and return to the mix'), title = make('strong', 'mm-live-eq-title'), bypassBadge = make('span', 'mm-live-eq-bypass');
  head.append(back, title, bypassBadge);
  const shell = make('div', 'mm-eq-shell mm-eq-native'), plot = make('div', 'mm-eq-plot'), svg = svgNode('svg', 'mm-eq-svg');
  svg.setAttribute('role', 'img');
  const grid = svgNode('g', 'mm-eq-grid'), actualGroup = svgNode('g', 'mm-eq-actual'), shapePath = svgNode('path', 'mm-eq-shape'), requestedPath = svgNode('path', 'mm-eq-requested'), handleGroup = svgNode('g', 'mm-eq-handles');
  svg.append(grid, shapePath, actualGroup, requestedPath, handleGroup); plot.append(svg);
  const sidebar = make('aside', 'mm-eq-sidebar'); sidebar.setAttribute('aria-label', 'EQ controls');
  const modes = make('div', 'mm-eq-mode');
  const pointsButton = button('•••', 'Points mode: three requested shape points'), drawButton = button('✎', 'Draw mode: redraw band values'), resetButton = button('↺', 'Reset this mix GEQ bands to 0 dB; bypass, filters and other processing are untouched');
  pointsButton.dataset.eqMode = 'points'; drawButton.dataset.eqMode = 'draw'; resetButton.dataset.eqReset = '';
  modes.append(pointsButton, drawButton, resetButton);
  const tabs = make('div', 'mm-band-tabs'); tabs.setAttribute('aria-label', 'Selected requested point');
  const pointButtons = Array.from({ length: AUX_EQ_POINT_COUNT }, (_, index) => { const node = button(String(index + 1), `Requested point ${index + 1}`); node.dataset.eqPoint = String(index); tabs.append(node); return node; });
  const bank = make('div', 'mm-eq-param-bank'), params = new Map();
  for (const [id, label, min, max, step, aria] of [['freq', 'FREQ', 0, 1, 0.001, 'frequency position'], ['q', 'WIDTH', 0, 1, 0.001, 'shape narrowness (not a hardware filter Q)'], ['gain', 'GAIN', -12, 12, 0.1, 'gain']]) {
    const wrap = make('label', 'mm-eq-param'), output = make('output'), input = make('input', 'mm-vertical');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.dataset.gestureStep = String(step); input.dataset.eqParam = id; input.disabled = true; input.value = '0';
    input.setAttribute('aria-label', `Selected requested point ${aria}; cap drag or arrow keys; changes are sent live while you drag`);
    wrap.append(make('span', '', label), output, input); bank.append(wrap); params.set(id, { input, output });
  }
  const unverified = make('p', 'mm-eq-cut-bank mm-eq-unverified', 'Shelves / cuts: unverified · not available');
  sidebar.append(modes, tabs, bank, unverified); shell.append(plot, sidebar);
  const status = make('p', 'mm-live-eq-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const modeNote = make('p', 'mm-caption mm-live-eq-mode-note');
  const legendText = 'Received band values: L filled green dots, R hollow magenta dots (one green line when both sides are equal). Dashed: requested curve at the 31 band centres. Dotted: point base plus every point\'s bump.';
  const legend = make('p', 'mm-caption mm-live-eq-legend', legendText);
  const approximation = make('p', 'mm-caption mm-live-eq-approximation', EQ_APPROXIMATION_NOTE); approximation.setAttribute('title', EQ_APPROXIMATION_NOTE);
  // Explicit two-step reset, like Delete group: the first tap only asks.
  const confirmRow = make('div', 'mm-dialog-actions mm-live-eq-reset-confirm'), confirmText = make('p'), confirmReset = button('Reset bands', 'Confirm: reset every GEQ band of this mix to 0 dB'), keepBands = button('Keep bands', 'Cancel reset; send nothing');
  confirmReset.dataset.eqResetConfirm = ''; keepBands.dataset.eqResetCancel = ''; confirmReset.className = 'mm-danger'; confirmRow.hidden = true; confirmRow.append(confirmText, confirmReset, keepBands);
  const details = make('details', 'mm-live-eq-details'), summary = make('summary', '', 'Band readback'), readbackRows = make('div', 'mm-live-eq-readbacks'), requestedRow = make('p', 'mm-live-eq-requested-text'), detailNotes = make('p', '', legendText);
  details.append(summary, detailNotes, readbackRows, requestedRow);
  section.append(head, shell, confirmRow, status, modeNote, legend, approximation, details);
  const content = root.querySelector('.mm-content');
  if (content?.insertAdjacentElement) content.insertAdjacentElement('afterend', section); else (content?.parentElement || root).append(section);
  const mixButton = root.querySelector('.mm-local-tabs [data-mode="eq"]');
  if (mixButton) { mixButton.disabled = true; mixButton.setAttribute('aria-pressed', 'false'); }

  // Keyed graph nodes survive every update; only attributes/text change.
  const gridLines = [-12, 0, 12].map(db => { const line = svgNode('line'), label = svgNode('text'); label.textContent = `${db > 0 ? '+' : ''}${db}`; grid.append(line, label); return { db, line, label }; });
  const gridFreqs = [20, 100, 1000, 10000, 20000].map(f => { const line = svgNode('line'), label = svgNode('text'); label.textContent = f >= 1000 ? `${f / 1000}k` : String(f); grid.append(line, label); return { f, line, label }; });
  const sideNodes = [0, 1].map(index => {
    const colour = EQ_SIDE_COLOURS[index], group = svgNode('g', `mm-eq-actual-side mm-eq-actual-${index}`), path = svgNode('path'), label = svgNode('text'); group.append(path, label);
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', colour); path.setAttribute('stroke-width', '1.6');
    label.setAttribute('text-anchor', 'end'); label.setAttribute('fill', colour); label.dataset.eqSideLabel = String(index);
    const dots = AUX_EQ_DISPLAY_CENTRES.map(() => { const dot = svgNode('circle'); dot.setAttribute('r', index ? '3.2' : '2.6'); dot.setAttribute('fill', index ? 'none' : colour); dot.setAttribute('stroke', colour); dot.setAttribute('stroke-width', '1.4'); group.append(dot); return dot; });
    group.dataset.eqSide = String(index); actualGroup.append(group); return { group, path, label, dots };
  });
  const handles = Array.from({ length: AUX_EQ_POINT_COUNT }, (_, index) => {
    const group = svgNode('g', 'mm-eq-handle'), halo = svgNode('circle'), dot = svgNode('circle'), label = svgNode('text');
    halo.setAttribute('r', '20'); halo.setAttribute('fill-opacity', '.18'); dot.setAttribute('r', '12'); label.setAttribute('text-anchor', 'middle'); label.textContent = String(index + 1);
    group.dataset.eqHandle = String(index); group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.append(halo, dot, label); handleGroup.append(group); return { group, halo, dot, label };
  });
  const readbackNodes = new Map();

  let open = false, auxIndex = null, binding = null, destroyed = false, mode = 'points', selectedPoint = 0, points = flatPoints();
  // F09-S07 point anchor (in memory only, never persisted): base = the session
  // coordinate in dB captured when point editing starts; points keep their
  // x/q/gain across gestures and every points gesture requests base + bumps of
  // ALL points. Re-anchored (base := current coordinate, gains := 0, x/q kept)
  // on open, after a draw/reset, and when the coordinate no longer matches the
  // last requested base + bumps (native edits, other editors, interruptions).
  let anchor = null;
  const zeroGains = () => { points = points.map(point => ({ ...point, gainDb: 0 })); };
  const dropAnchor = () => { anchor = null; zeroGains(); };
  function reanchor(coordinate) { anchor = { base: Object.freeze(coordinate.map(auxEqPositionToDb)), interrupted: false }; zeroGains(); }
  // Own requested values may come back as the desk's 10-significant-digit echo
  // or stay within the sparse-dispatch epsilon; anything else is an outside change.
  function anchorMatches(coordinate) {
    let expected;
    try { expected = mapRequestedAuxEqCurve(requestedPointSamples(points, anchor.base)).values; } catch { return false; }
    return coordinate.length === expected.length && coordinate.every((value, index) => Math.abs(value - expected[index]) < ANCHOR_EPSILON || deskFormat(value) === deskFormat(expected[index]));
  }
  // `settling` suppresses the render-time anchor check while begin/finish run
  // (the owner emits synchronously inside them); finish renders once afterwards.
  let gesture = null, drag = null, previewValues = null, snapshot = null, editable = false, focusBefore = null, hint = '', settling = false;
  const RESTART_OUTSIDE = 'Curve changed on the desk; points restarted from the current curve.';
  const RESTART_INTERRUPTED = 'The last point change was interrupted; points restarted from the current curve.';
  const ZERO_GAIN_HINT = 'No change sent: every point gain is 0 dB, so frequency and width have no bump to move yet.';
  const owned = control => control?.selected?.kind === 'geq' && control.selected.auxIndex === auxIndex;
  // Display-only basis for handles/shape: the point anchor, else the session
  // coordinate, else complete equal received bands. Never sent by itself.
  function displayBasis(readback) {
    if (anchor) return anchor.base;
    const coordinate = owned(snapshot?.control) ? snapshot.control.eqCoordinate : null;
    if (coordinate) return coordinate.map(auxEqPositionToDb);
    const side = readback?.sides[0];
    return side && side.bands.every(value => value !== undefined) ? side.bands.map(auxEqPositionToDb) : null;
  }
  function basisAt(basis, x) {
    const xs = AUX_EQ_DISPLAY_CENTRES.map(auxEqCentreX);
    if (x <= 0) return basis[0];
    for (let index = 1; index < xs.length; index++) if (x <= xs[index]) return basis[index - 1] + (basis[index] - basis[index - 1]) * (x - xs[index - 1]) / (xs[index] - xs[index - 1]);
    return basis.at(-1);
  }
  function geometry() {
    const rect = svg.getBoundingClientRect?.() || { width: 0, height: 0 }, w = Math.max(150, rect.width || 0), h = Math.max(80, rect.height || 0);
    return { rect, w, h, left: w < 260 ? 28 : 35, right: w - 14, top: 14, bottom: h - 25, range: h - 39 };
  }
  const xPixel = (g, x) => g.left + x * (g.right - g.left);
  const yPixel = (g, db) => g.top + (15 - clamp(db, -15, 15)) / 30 * g.range;
  const linePath = (g, values) => {
    let path = '', pen = false;
    values.forEach((db, index) => {
      if (typeof db !== 'number' || !Number.isFinite(db)) { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${xPixel(g, auxEqCentreX(AUX_EQ_DISPLAY_CENTRES[index])).toFixed(2)},${yPixel(g, db).toFixed(2)} `; pen = true;
    });
    return path.trim();
  };
  function paint(readback) {
    const g = geometry();
    svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
    for (const { db, line, label } of gridLines) {
      const y = yPixel(g, db);
      line.setAttribute('x1', g.left); line.setAttribute('x2', g.right); line.setAttribute('y1', y); line.setAttribute('y2', y); line.setAttribute('stroke', db === 0 ? '#76838a' : '#34434e');
      label.setAttribute('x', g.left - 4); label.setAttribute('y', y + 4); label.setAttribute('text-anchor', 'end');
    }
    for (const { f, line, label } of gridFreqs) {
      const x = xPixel(g, auxEqCentreX(f));
      line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('y1', g.top); line.setAttribute('y2', g.bottom); line.setAttribute('stroke', '#34434e');
      label.setAttribute('x', x); label.setAttribute('y', g.h - 7); label.setAttribute('text-anchor', f === 20 ? 'start' : f === 20000 ? 'end' : 'middle');
    }
    // A single line for equal sides; both individual sides otherwise.
    sideNodes.forEach((node, index) => {
      const side = readback?.sides[index], visible = Boolean(side) && !(index === 1 && readback.equal);
      node.group.setAttribute('visibility', visible ? 'visible' : 'hidden');
      const linked = readback?.sides.length === 2;
      node.label.textContent = side ? `${linked ? readback.equal ? 'L=R · ' : index ? 'R · ' : 'L · ' : ''}Output ${side.auxIndex + 1}${linked && readback.equal ? `/${readback.sides[1].auxIndex + 1}` : ''}` : '';
      node.label.setAttribute('x', g.right - 2); node.label.setAttribute('y', g.top + 10 + index * 13);
      const values = side ? side.bands.map(value => value === undefined ? undefined : auxEqPositionToDb(value)) : [];
      node.path.setAttribute('d', visible ? linePath(g, values) : '');
      node.dots.forEach((dot, band) => {
        const known = visible && typeof values[band] === 'number';
        dot.setAttribute('visibility', known ? 'visible' : 'hidden');
        dot.setAttribute('cx', xPixel(g, auxEqCentreX(AUX_EQ_DISPLAY_CENTRES[band])).toFixed(2)); dot.setAttribute('cy', known ? yPixel(g, values[band]).toFixed(2) : '0');
      });
    });
    const control = snapshot?.control, requested = previewValues || (owned(control) ? control.eqRequested : null);
    requestedPath.setAttribute('d', requested ? linePath(g, requested.map(auxEqPositionToDb)) : '');
    const basis = displayBasis(readback), shape = mode === 'points' && basis ? requestedPointSamples(points, basis).samples.map(sample => sample.gainDb) : null;
    shapePath.setAttribute('d', shape ? linePath(g, shape) : '');
    handles.forEach((handle, index) => {
      const point = points[index], x = xPixel(g, point.x), y = yPixel(g, (basis ? basisAt(basis, point.x) : 0) + auxEqPointGain(points, point.x));
      handle.group.setAttribute('visibility', mode === 'points' ? 'visible' : 'hidden');
      for (const circle of [handle.halo, handle.dot]) { circle.setAttribute('cx', x.toFixed(2)); circle.setAttribute('cy', y.toFixed(2)); }
      handle.halo.setAttribute('fill', '#abbea0'); handle.dot.setAttribute('fill', index === selectedPoint ? '#ecd3a7' : '#bcc7a8'); handle.dot.setAttribute('stroke', '#879b80');
      handle.label.setAttribute('x', x.toFixed(2)); handle.label.setAttribute('y', (y + 4).toFixed(2));
      handle.group.setAttribute('aria-label', `Requested point ${index + 1}, ${hzText(20 * Math.pow(1000, point.x))}, Δ ${dbText(point.gainDb)}; Enter or Space selects it for the sliders`);
    });
    svg.setAttribute('aria-label', `AUX GEQ graph. ${readback ? readback.sides.map(eqSideText).join('. ') : 'No received bands.'} ${requested ? 'Requested curve shown dashed.' : 'No requested curve.'}`);
    svg.dataset.draw = String(mode === 'draw' && editable);
  }
  function syncParams() {
    const point = points[selectedPoint], width = 0.13 / Math.sqrt(0.1 * Math.pow(100, point.q));
    const values = { freq: point.x, q: point.q, gain: point.gainDb }, text = { freq: hzText(20 * Math.pow(1000, point.x)), q: `σ ${width.toFixed(2)}`, gain: `Δ ${dbText(point.gainDb)}` };
    for (const [id, { input, output }] of params) {
      input.disabled = !editable || mode !== 'points';
      if (!(gesture?.input === input)) input.value = String(values[id]);
      output.textContent = mode === 'points' ? text[id] : '—';
    }
    pointButtons.forEach((node, index) => {
      const chosen = mode === 'points' && index === selectedPoint;
      node.disabled = mode !== 'points'; node.className = chosen ? 'mm-active' : ''; node.setAttribute('aria-pressed', String(chosen));
    });
    for (const node of [pointsButton, drawButton]) { const chosen = node.dataset.eqMode === mode; node.className = chosen ? 'mm-active' : ''; node.setAttribute('aria-pressed', String(chosen)); }
    gestures?.sync();
  }
  function render(next = session.snapshot(), kind) {
    snapshot = next;
    if (!open || destroyed || kind === 'meters') return; // Meter-only emits change nothing here.
    if (!['connecting', 'connected', 'partial', 'live'].includes(next.phase)) { close(); return; }
    const control = next.control, readback = projectEqReadback(next, auxIndex);
    const name = next.observations?.get(`a.${auxIndex}.name`);
    title.textContent = `${typeof name === 'string' && name ? name : `Output ${auxIndex + 1}`} · AUX ${readback.sides.map(side => side.auxIndex + 1).join('/')} GEQ · ${BANDS} bands`;
    bypassBadge.textContent = readback.bypassed ? 'GEQ BYPASSED on desk · status only' : '';
    bypassBadge.dataset.bypass = String(readback.bypassed);
    editable = Boolean(session.canEditEqTarget(auxIndex) && !control?.dispatching);
    // The owner ended the gesture (native change, revalidation): the points stay;
    // the next gesture re-anchors if the curve no longer matches them.
    if (gesture && !control?.gestureActive) { gesture = null; previewValues = null; gestures?.cancel(); drag = null; }
    // Between gestures, keep handles/shape over the curve the next gesture will
    // edit: when the editable coordinate (requested values while own echoes are
    // pending, else complete equal received bands once the owner allows editing)
    // no longer matches base + bumps, restart the points from it (F09-S07 review).
    if (!gesture && !settling && mode === 'points' && anchor && editable) {
      const coordinate = owned(control) && control.eqCoordinate ? control.eqCoordinate
        : readback.complete && readback.equal ? readback.sides[0].bands : null;
      if (coordinate && !anchorMatches(coordinate)) { hint = anchor.interrupted ? RESTART_INTERRUPTED : RESTART_OUTSIDE; reanchor(coordinate); }
    }
    resetButton.disabled = !editable; pointsButton.disabled = drawButton.disabled = false;
    if (!editable && !confirmRow.hidden) hideConfirm(false);
    confirmText.textContent = `Reset all ${BANDS} GEQ bands of Output ${readback.sides.map(side => side.auxIndex + 1).join(' and ')} to 0 dB? Bypass, filters and other processing are untouched.`;
    // A local hint is shown alongside the owner's status, never in place of it.
    const ownerText = owned(control) ? control.reason || control.status : editable ? 'Ready: drag a point or slider, or draw. Changes are sent live while you drag (throttled).' : unavailableReason(readback);
    status.textContent = hint && (editable || owned(control)) ? `${hint} ${ownerText}` : ownerText;
    modeNote.textContent = EQ_MODE_NOTES[mode]; detailNotes.textContent = `${EQ_MODE_NOTES[mode]} ${legendText}`;
    const sides = new Set(readback.sides.map(side => side.auxIndex));
    for (const [key, row] of readbackNodes) if (!sides.has(key)) { row.remove(); readbackNodes.delete(key); }
    readback.sides.forEach((side, index) => {
      let row = readbackNodes.get(side.auxIndex); if (!row) { row = make('p'); readbackNodes.set(side.auxIndex, row); readbackRows.append(row); }
      if (readbackRows.children[index] !== row) readbackRows.insertBefore(row, readbackRows.children[index] || null);
      row.textContent = `${readback.sides.length === 2 ? index ? 'R · ' : 'L · ' : ''}${eqSideText(side)}: ${side.bands.map((value, band) => `${hzText(AUX_EQ_DISPLAY_CENTRES[band])} ${value === undefined ? 'not received' : `${dbText(auxEqPositionToDb(value))} (raw ${value})`}`).join(' · ')}`;
    });
    const requested = owned(control) ? control.eqRequested : null;
    requestedRow.textContent = requested ? `Requested (not proof of application): ${requested.map((value, band) => `${hzText(AUX_EQ_DISPLAY_CENTRES[band])} ${dbText(auxEqPositionToDb(value))}`).join(' · ')}`
      : owned(control) && control.requestedDiagnostic?.length ? `Last requested (inactive): ${control.requestedDiagnostic.length} band values · ${control.status}` : 'No requested GEQ curve in this connection.';
    syncParams(); paint(readback);
  }
  // Gesture authority: begin always (re)selects this output's typed GEQ target,
  // so selection/native changes never need a manual Enable or re-arm.
  function begin(input = null) {
    if (!open || destroyed || !editable) return null;
    settling = true;
    let token;
    try { if (!owned(session.snapshot().control)) session.selectEqTarget(auxIndex); token = session.beginEqGesture(); } finally { settling = false; }
    if (!token) { render(); return null; }
    const coordinate = session.snapshot().control?.eqCoordinate;
    if (!coordinate) { session.cancelEqGesture(); render(); return null; }
    hint = '';
    if (mode === 'points') {
      if (!anchor) reanchor(coordinate);
      else if (!anchorMatches(coordinate)) { hint = anchor.interrupted ? RESTART_INTERRUPTED : RESTART_OUTSIDE; reanchor(coordinate); }
      else anchor.interrupted = false;
      syncParams(); // Sliders show the (possibly restarted) values before the gesture reads its start.
    }
    gesture = { token, input, draw: coordinate.map(auxEqPositionToDb), lastDraw: null };
    previewValues = null;
    return token;
  }
  function previewIntent(intent) {
    if (!gesture) return null;
    const values = session.previewEqGesture(gesture.token, intent);
    if (values) previewValues = values;
    paint(projectEqReadback(snapshot, auxIndex));
    return values;
  }
  function finish(commit) {
    const active = gesture; gesture = null; drag = null;
    if (!active) return;
    settling = true;
    try {
      if (commit) {
        const sent = session.commitEqGesture(active.token), outcome = session.snapshot().control?.outcome;
        // Sparse dispatch: a release whose bands all match sends nothing; say so.
        if (mode === 'points' && outcome === 'no-op') hint = points.every(point => point.gainDb === 0) ? ZERO_GAIN_HINT : 'No change sent: every band already matches the requested curve.';
        // A failed or partial release is our interruption, not a desk change.
        else if (mode === 'points' && anchor && !sent) anchor.interrupted = true;
      } else {
        if (mode === 'points' && anchor) anchor.interrupted = true;
        session.cancelEqGesture();
      }
    } finally { settling = false; }
    // A draw gesture (committed or not) changes the curve under the points.
    if (mode === 'draw') dropAnchor();
    previewValues = null; render();
  }
  const gestures = installFaderGestures(section, {
    onBegin: input => begin(input),
    onPreview(input, token, value) {
      if (!gesture || gesture.token !== token || !anchor) return null;
      const key = { freq: 'x', q: 'q', gain: 'gainDb' }[input.dataset.eqParam], previous = points[selectedPoint][key];
      // F09-S06: other bands saturate at ±15 dB in the requested samples; the
      // point's gain itself stops once its own centre reaches the limit.
      if (key === 'gainDb') value = pointCentreGainLimit(centreRest(selectedPoint, points[selectedPoint].x), value, previous);
      points[selectedPoint] = { ...points[selectedPoint], [key]: value };
      // Every point's persistent bump over the anchored base (never a reset Δ).
      if (!previewIntent(requestedPointSamples(points, anchor.base))) { points[selectedPoint] = { ...points[selectedPoint], [key]: previous }; syncParams(); return previous; }
      syncParams(); return value;
    },
    onCommit: () => finish(true),
    onCancel: () => finish(false),
  });
  // Base plus the OTHER points' persistent bumps at x (for the centre limit).
  const centreRest = (index, x) => basisAt(anchor.base, x) + auxEqPointGain(points.filter((_, i) => i !== index), x);
  function pointer(event) {
    const g = geometry(), rect = g.rect;
    return { x: clamp((event.clientX - (rect.left || 0) - g.left) / (g.right - g.left), 0, 1), db: clamp(15 - (event.clientY - (rect.top || 0) - g.top) / g.range * 30, -15, 15) };
  }
  const nearestBand = x => AUX_EQ_DISPLAY_CENTRES.reduce((best, f, index) => Math.abs(auxEqCentreX(f) - x) < Math.abs(auxEqCentreX(AUX_EQ_DISPLAY_CENTRES[best]) - x) ? index : best, 0);
  function drawAt(event) {
    const p = pointer(event), band = nearestBand(p.x), from = gesture.lastDraw ?? { band, db: p.db };
    for (let index = Math.min(band, from.band); index <= Math.max(band, from.band); index++) {
      const t = band === from.band ? 1 : (index - from.band) / (band - from.band);
      gesture.draw[index] = from.db + (p.db - from.db) * t;
    }
    gesture.lastDraw = { band, db: p.db };
    if (previewIntent(requestedDrawSamples(gesture.draw))) drag.changed = true;
  }
  function onPointerDown(event) {
    if (event.button !== 0 || !open || !editable || gesture) return;
    const handle = event.target.closest?.('[data-eq-handle]');
    if (mode === 'points' && !handle) return; // Background touches scroll; no write.
    if (handle) { selectedPoint = Number(handle.dataset.eqHandle); syncParams(); }
    if (!begin()) return;
    if (mode === 'draw' && !gesture.draw) { finish(false); return; }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, changed: false };
    svg.setPointerCapture?.(event.pointerId); event.preventDefault?.();
    if (mode === 'draw') drawAt(event);
  }
  function onPointerMove(event) {
    if (!drag || drag.id !== event.pointerId || !gesture) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    if (mode === 'draw') { drawAt(event); return; }
    if (!anchor) return;
    const p = pointer(event), previous = points[selectedPoint];
    // The handle follows the pointer: its own gain is the remainder after the
    // basis and the other points' shape at the new position. F09-S06 (live
    // finding): bands the bump would push past ±15 dB saturate in the requested
    // samples, so x always follows and the gain stops only when the handle's own
    // centre reaches the limit; a band already at ±15 elsewhere never blocks it.
    const rest = centreRest(selectedPoint, p.x);
    points[selectedPoint] = { ...previous, x: p.x, gainDb: pointCentreGainLimit(rest, clamp(p.db - rest, -12, 12), previous.gainDb) };
    if (previewIntent(requestedPointSamples(points, anchor.base))) drag.changed = true;
    else points[selectedPoint] = { ...previous, x: p.x }; // keep following horizontally
    syncParams();
  }
  function onPointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const changed = drag.changed; drag = null;
    svg.releasePointerCapture?.(event.pointerId);
    finish(changed);
  }
  const onPointerCancel = () => { if (drag) finish(false); };
  svg.addEventListener('pointerdown', onPointerDown); svg.addEventListener('pointermove', onPointerMove); svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerCancel); svg.addEventListener('lostpointercapture', onPointerCancel);
  function setMode(next) {
    if (mode === next) return;
    if (gesture) { gestures.cancel(); finish(false); }
    hideConfirm(false); mode = next; render(); // Mutually exclusive intents; switching sends nothing.
  }
  function onClick(event) {
    const target = event.target.closest?.('button');
    if (!target || target.disabled || !open) return;
    if (target === back) { close(); return; }
    if (target.dataset.eqMode) { setMode(target.dataset.eqMode); return; }
    if (target.dataset.eqPoint !== undefined && mode === 'points') { if (gesture) { gestures.cancel(); finish(false); } selectedPoint = Number(target.dataset.eqPoint); render(); return; }
    if (target === resetButton && editable) {
      if (gesture) { gestures.cancel(); finish(false); }
      confirmRow.hidden = false; render(); keepBands.focus?.(); return;
    }
    if (target === keepBands) { hideConfirm(true); return; }
    if (target === confirmReset) {
      hideConfirm(true);
      if (!editable) return;
      if (!owned(session.snapshot().control)) session.selectEqTarget(auxIndex);
      dropAnchor(); session.resetEqBands(); render(); // Points restart from the reset curve.
    }
  }
  function hideConfirm(focusReset) { confirmRow.hidden = true; if (focusReset) resetButton.focus?.(); }
  section.addEventListener('click', onClick);
  function onKey(event) {
    if (!open) return;
    const handle = event.target?.closest?.('[data-eq-handle]');
    if (handle && (event.key === 'Enter' || event.key === ' ') && mode === 'points') {
      event.preventDefault?.(); if (gesture) { gestures.cancel(); finish(false); }
      selectedPoint = Number(handle.dataset.eqHandle); render(); return;
    }
    if (event.key !== 'Escape' || gesture || event.target?.closest?.('.mm-fader-control')) return;
    if (!confirmRow.hidden) { event.preventDefault?.(); hideConfirm(true); return; }
    close();
  }
  section.addEventListener('keydown', onKey);
  function show(index) {
    if (destroyed) return false;
    const context = controller.context();
    if (context.selectedAux !== index && !controller.selectAux(index)) return false;
    controller.clearLevelContext();
    const current = controller.context();
    if (current.selectedAux === null) return false;
    auxIndex = current.selectedAux; binding = { profileId: current.profileId, revision: current.revision, selectedAux: current.selectedAux };
    focusBefore = document.activeElement; open = true; mode = 'points'; selectedPoint = 0; points = flatPoints(); anchor = null; previewValues = null; gesture = null;
    section.hidden = false; root.dataset.eqOpen = 'true';
    if (mixButton) { mixButton.setAttribute('aria-pressed', 'true'); mixButton.classList?.add('mm-active'); }
    session.selectEqTarget(auxIndex);
    gestures.prepare(); render(); back.focus?.();
    return true;
  }
  function close() {
    if (!open) return;
    if (gesture) { gestures.cancel(); finish(false); }
    confirmRow.hidden = true; open = false; binding = null; section.hidden = true; root.dataset.eqOpen = 'false';
    if (mixButton) { mixButton.setAttribute('aria-pressed', 'false'); mixButton.classList?.remove('mm-active'); }
    session.closeEq?.();
    if (focusBefore?.isConnected !== false && !focusBefore?.disabled) focusBefore?.focus?.();
  }
  const onMixButton = () => { if (open) close(); else { const index = controller.context().selectedAux; if (index !== null) show(index); } };
  mixButton?.addEventListener('click', onMixButton);
  const unsubscribe = session.subscribe((next, kind) => render(next, kind));
  const unsubscribeContext = controller.subscribeContext(context => {
    if (mixButton) mixButton.disabled = context.selectedAux === null || !['connecting', 'connected', 'partial', 'live'].includes(session.snapshot().phase);
    if (open && (context.profileId !== binding.profileId || context.revision !== binding.revision || context.selectedAux !== binding.selectedAux)) close();
  });
  const resize = () => { if (open) { gestures.sync(); paint(projectEqReadback(snapshot, auxIndex)); } };
  window?.addEventListener?.('resize', resize);
  return {
    open: show, close, section,
    get mode() { return mode; },
    destroy() { close(); destroyed = true; unsubscribe(); unsubscribeContext(); gestures.destroy(); section.removeEventListener('click', onClick); section.removeEventListener('keydown', onKey); mixButton?.removeEventListener('click', onMixButton); window?.removeEventListener?.('resize', resize); section.remove(); },
  };
}
