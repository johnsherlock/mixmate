import { installFaderGestures } from './gestures.js';
import { stereoRelationship } from './protocol.js';
import { AUX_EQ_DISPLAY_CENTRES, AUX_EQ_FILTERS, auxEqPositionToDb } from './aux-eq-protocol.js';
import { AUX_EQ_FILTER_DEFAULT, auxEqFilterHz, auxEqFilterOn, auxEqFilterRolloffDb } from './aux-eq-filter.js';
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
// F09-S08 point handles: the r=20 halo is the hit target; a press on the empty
// graph within 24 px of a handle grabs the nearest one; arrow keys move the
// selected point (Left/Right ±1/62 of the x range, Up/Down ±0.5 dB, Shift 4×).
const HANDLE_RADIUS = 20, HANDLE_MARGIN = 22, HANDLE_GRAB_PX = 24, KEY_X_STEP = 1 / 62, KEY_GAIN_STEP = 0.5, KEY_SHIFT = 4;
const ARROWS = Object.freeze({ ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['gainDb', 1], ArrowDown: ['gainDb', -1] });
const flatPoints = () => [0.233, 0.566, 0.85].map(x => ({ x, gainDb: 0, q: 0.5 }));
export const EQ_APPROXIMATION_NOTE = 'Approximation: band centres are the native display labels (20 Hz–20 kHz), not verified DSP centres. Lines join band values; they are not a measured response. Low/High cut handles show the received high-pass/low-pass positions (native 20 × 1000^v Hz, OFF at hpf 0 / lpf 1); the roll-off drawn past them is the Demo −12 dB/oct approximation, not the verified native slope. No shelves or parametric bands.';
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
  // F06-S05: hpf/lpf positions per side (undefined until received).
  for (const side of sides) for (const filter of AUX_EQ_FILTERS) { const value = eq.get(`a.${side.auxIndex}.eq.${filter}`); side[filter] = unit(value) ? value : undefined; }
  const filterComplete = sides.every(side => side.hpf !== undefined && side.lpf !== undefined);
  const filterEqual = sides.length === 1 || sides[0].hpf === sides[1].hpf && sides[0].lpf === sides[1].lpf;
  const filters = { complete: filterComplete, equal: filterEqual, ok: filterComplete && filterEqual, hpf: sides[0]?.hpf, lpf: sides[0]?.lpf };
  const complete = sides.every(side => side.received === BANDS && side.bypass !== undefined);
  const equal = sides.length === 1 || sides[0].bypass === sides[1].bypass && sides[0].bands.every((value, index) => value !== undefined && value === sides[1].bands[index]);
  return { link: link.status, sides, complete, equal, filters, bypassed: sides.some(side => side.bypass === true) };
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
// F06-S05: the compact reason the Low/High cut controls are read-only.
export function eqFilterCompactState(readback) {
  if (!readback.filters.complete) return 'Cuts read-only · waiting for filters';
  if (!readback.filters.equal) return 'Cuts read-only · L/R cuts unequal';
  return '';
}
// F09-S09: the compact one-line head state (full text in its title/aria and the
// app's header/footer status), never a multi-line block below the graph.
export function eqCompactState(readback) {
  if (!['mono', 'linked'].includes(readback.link)) return 'Read-only · output link unknown';
  if (!readback.complete) return 'Read-only · waiting for bands';
  if (!readback.equal) return 'Read-only · L/R GEQ unequal';
  return 'Read-only';
}

// `debug` (live-entry's `?debug` flag, F09-S09): the status/notes/legend/band
// readback diagnostics below the graph exist only in development; otherwise
// they are never created, so they take no layout space.
export function mountEqControls({ root, session, controller, window = globalThis.window, debug = false }) {
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
  // F09-S08/S09: local restart/no-op hints and the compact read-only state show
  // in the head line. Without ?debug they are the panel's own live regions.
  const hintBadge = make('span', 'mm-live-eq-hint'), stateBadge = make('span', 'mm-live-eq-state');
  for (const badge of [hintBadge, stateBadge]) { badge.hidden = true; if (debug) badge.setAttribute('aria-hidden', 'true'); else { badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite'); } }
  head.append(back, title, hintBadge, stateBadge, bypassBadge);
  const shell = make('div', 'mm-eq-shell mm-eq-native'), plot = make('div', 'mm-eq-plot'), svg = svgNode('svg', 'mm-eq-svg');
  svg.setAttribute('role', 'img');
  const grid = svgNode('g', 'mm-eq-grid'), actualGroup = svgNode('g', 'mm-eq-actual'), shapePath = svgNode('path', 'mm-eq-shape'), requestedPath = svgNode('path', 'mm-eq-requested'), handleGroup = svgNode('g', 'mm-eq-handles');
  svg.append(grid, shapePath, actualGroup, requestedPath, handleGroup); plot.append(svg);
  const sidebar = make('aside', 'mm-eq-sidebar'); sidebar.setAttribute('aria-label', 'EQ controls');
  const modes = make('div', 'mm-eq-mode');
  const pointsButton = button('•••', 'Points mode: three requested shape points'), drawButton = button('✎', 'Draw mode: redraw band values'), resetButton = button('↺', 'Reset this mix GEQ bands to 0 dB and turn both cuts off; bypass and other processing are untouched');
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
  // F06-S05: Low cut (hpf) / High cut (lpf) toggles, as the Demo's cut bank.
  const cutBank = make('div', 'mm-eq-cut-bank'), CUT_NAMES = { hpf: ['Low cut', 'high-pass'], lpf: ['High cut', 'low-pass'] };
  const cutButtons = AUX_EQ_FILTERS.map(filter => { const node = button(CUT_NAMES[filter][0]); node.dataset.eqFilter = filter; node.setAttribute('aria-pressed', 'false'); node.disabled = true; cutBank.append(node); return { filter, node }; });
  sidebar.append(modes, tabs, bank, cutBank); shell.append(plot, sidebar);
  const legendText = 'Received band values: L filled green dots, R hollow magenta dots (one green line when both sides are equal). Dashed: requested curve at the 31 band centres. Dotted: point base plus every point\'s bump.';
  section.append(head, shell);
  // Development-only diagnostics (?debug): never created otherwise.
  let diag = null;
  if (debug) {
    const status = make('p', 'mm-live-eq-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const modeNote = make('p', 'mm-caption mm-live-eq-mode-note'), legend = make('p', 'mm-caption mm-live-eq-legend', legendText);
    const approximation = make('p', 'mm-caption mm-live-eq-approximation', EQ_APPROXIMATION_NOTE); approximation.setAttribute('title', EQ_APPROXIMATION_NOTE);
    const details = make('details', 'mm-live-eq-details'), summary = make('summary', '', 'Band readback'), readbackRows = make('div', 'mm-live-eq-readbacks'), requestedRow = make('p', 'mm-live-eq-requested-text'), detailNotes = make('p', '', legendText);
    details.append(summary, detailNotes, readbackRows, requestedRow);
    section.append(status, modeNote, legend, approximation, details);
    diag = { status, modeNote, detailNotes, readbackRows, requestedRow, rows: new Map() };
  }
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
  // F06-S05 LC/HC handles (Demo paintEQ): dashed vertical line, r=14 dot, label and
  // frequency; the r=24 transparent hit circle is the touch/mouse target.
  const CUT_COLOURS = { hpf: ['#7caabb', '#436d7b', 'LC'], lpf: ['#c7a16d', '#83653c', 'HC'] };
  const cutHandles = AUX_EQ_FILTERS.map(filter => {
    const group = svgNode('g', 'mm-eq-handle mm-eq-cut-handle'), line = svgNode('line'), hit = svgNode('circle'), dot = svgNode('circle'), label = svgNode('text'), freq = svgNode('text');
    line.setAttribute('stroke', CUT_COLOURS[filter][0]); line.setAttribute('stroke-dasharray', '3 4'); line.setAttribute('pointer-events', 'none');
    hit.setAttribute('r', String(HANDLE_GRAB_PX)); hit.setAttribute('class', 'mm-eq-handle-hit'); hit.setAttribute('fill', 'transparent');
    dot.setAttribute('r', '14'); dot.setAttribute('fill', CUT_COLOURS[filter][1]); label.setAttribute('text-anchor', 'middle'); label.setAttribute('fill', '#edf1ee'); label.textContent = CUT_COLOURS[filter][2];
    freq.setAttribute('text-anchor', filter === 'hpf' ? 'start' : 'end'); freq.dataset.eqFilterHz = filter;
    group.dataset.eqFilterHandle = filter; group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.setAttribute('visibility', 'hidden'); group.append(line, hit, dot, label, freq); handleGroup.append(group);
    return { filter, group, line, hit, dot, label, freq, cx: NaN, cy: NaN };
  });
  const handles = Array.from({ length: AUX_EQ_POINT_COUNT }, (_, index) => {
    // F09-S08 review: a transparent r=24 hit circle belongs to the handle itself,
    // so a touch near the handle is a grab. F09-S10: the <svg> (not the handle)
    // must be touch-action:none — Chrome uses the svg's value for its children.
    const group = svgNode('g', 'mm-eq-handle'), hit = svgNode('circle'), halo = svgNode('circle'), dot = svgNode('circle'), label = svgNode('text');
    hit.setAttribute('r', String(HANDLE_GRAB_PX)); hit.setAttribute('class', 'mm-eq-handle-hit'); hit.setAttribute('fill', 'transparent');
    halo.setAttribute('r', String(HANDLE_RADIUS)); halo.setAttribute('class', 'mm-eq-handle-halo'); halo.setAttribute('fill-opacity', '.18'); dot.setAttribute('r', '12'); label.setAttribute('text-anchor', 'middle'); label.textContent = String(index + 1);
    group.dataset.eqHandle = String(index); group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.append(hit, halo, dot, label); handleGroup.append(group); return { group, hit, halo, dot, label, cx: NaN, cy: NaN };
  });

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
  // F06-S05: filterEditable = GEQ editable AND the received hpf/lpf (both sides of
  // a pair equal) are usable; filterPreview = positions requested by the active
  // cut gesture (distinct from received); lastCut remembers the last ON position
  // per output for this mount (session-local, never persisted).
  let filterEditable = false, filterPreview = null;
  const lastCut = new Map();
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
  // Displayed cut positions: the active gesture's requested value, else received.
  const shownFilter = (readback, filter) => filterPreview?.[filter] ?? readback?.filters[filter];
  const cutIsOn = (filter, position) => typeof position === 'number' && auxEqFilterOn(filter, position);
  function geometry() {
    const rect = svg.getBoundingClientRect?.() || { width: 0, height: 0 }, w = Math.max(150, rect.width || 0), h = Math.max(80, rect.height || 0);
    // F09-S08: top/right margins keep a handle's whole r=20 halo inside the
    // viewBox even when its centre sits at +15 dB or 20 kHz, so it stays grabbable.
    return { rect, w, h, left: w < 260 ? 28 : 35, right: w - HANDLE_MARGIN, top: HANDLE_MARGIN, bottom: h - 25, range: h - 25 - HANDLE_MARGIN };
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
  let paintNote = '';
  function paint(readback, note = paintNote) {
    paintNote = note;
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
      // Received cuts bend the displayed received band values (approximation only).
      const hpf = filterPreview?.hpf ?? side?.hpf, lpf = filterPreview?.lpf ?? side?.lpf;
      const values = side ? side.bands.map((value, band) => value === undefined ? undefined : auxEqPositionToDb(value) + auxEqFilterRolloffDb(hpf, lpf, AUX_EQ_DISPLAY_CENTRES[band])) : [];
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
      for (const circle of [handle.hit, handle.halo, handle.dot]) { circle.setAttribute('cx', x.toFixed(2)); circle.setAttribute('cy', y.toFixed(2)); }
      handle.cx = x; handle.cy = y;
      handle.halo.setAttribute('fill', '#abbea0'); handle.dot.setAttribute('fill', index === selectedPoint ? '#ecd3a7' : '#bcc7a8'); handle.dot.setAttribute('stroke', '#879b80');
      handle.label.setAttribute('x', x.toFixed(2)); handle.label.setAttribute('y', (y + 4).toFixed(2));
      handle.group.setAttribute('aria-label', `Requested point ${index + 1}, ${hzText(20 * Math.pow(1000, point.x))}, Δ ${dbText(point.gainDb)}; Enter or Space selects it for the sliders; arrow keys move it (Shift for larger steps)`);
    });
    for (const handle of cutHandles) {
      const position = shownFilter(readback, handle.filter), on = cutIsOn(handle.filter, position);
      handle.group.setAttribute('visibility', on ? 'visible' : 'hidden');
      if (!on) { handle.cx = handle.cy = NaN; continue; }
      const x = xPixel(g, position), y = g.top + 15, hzLabel = hzText(auxEqFilterHz(position));
      handle.line.setAttribute('x1', x.toFixed(2)); handle.line.setAttribute('x2', x.toFixed(2)); handle.line.setAttribute('y1', (y + 12).toFixed(2)); handle.line.setAttribute('y2', g.bottom);
      for (const circle of [handle.hit, handle.dot]) { circle.setAttribute('cx', x.toFixed(2)); circle.setAttribute('cy', y.toFixed(2)); }
      handle.label.setAttribute('x', x.toFixed(2)); handle.label.setAttribute('y', (y + 4).toFixed(2));
      handle.freq.setAttribute('x', (x + (handle.filter === 'hpf' ? 18 : -18)).toFixed(2)); handle.freq.setAttribute('y', (y + 4).toFixed(2)); handle.freq.textContent = hzLabel;
      handle.cx = x; handle.cy = y;
      handle.group.setAttribute('aria-label', `${CUT_NAMES[handle.filter][0]} handle, ${hzLabel} (${CUT_NAMES[handle.filter][1]} filter); arrow keys move it (Shift for larger steps), Enter or Space turns it off`);
    }
    svg.setAttribute('aria-label', `AUX GEQ graph. ${readback ? readback.sides.map(eqSideText).join('. ') : 'No received bands.'} ${requested ? 'Requested curve shown dashed.' : 'No requested curve.'}${paintNote ? ` ${paintNote}` : ''}`);
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
    if (gesture && !control?.gestureActive) { gesture = null; previewValues = null; filterPreview = null; gestures?.cancel(); drag = null; }
    // F06-S05: remember the last ON position per output; derive cut availability.
    for (const filter of AUX_EQ_FILTERS) if (!filterPreview && cutIsOn(filter, readback.filters[filter]) && readback.filters.ok) lastCut.set(`${auxIndex}.${filter}`, readback.filters[filter]);
    filterEditable = Boolean(editable && readback.filters.ok);
    // Between gestures, keep handles/shape over the curve the next gesture will
    // edit: when the editable coordinate (requested values while own echoes are
    // pending, else complete equal received bands once the owner allows editing)
    // no longer matches base + bumps, restart the points from it (F09-S07 review).
    if (!gesture && !settling && mode === 'points' && anchor && editable) {
      const coordinate = owned(control) && control.eqCoordinate ? control.eqCoordinate
        : readback.complete && readback.equal ? readback.sides[0].bands : null;
      if (coordinate && !anchorMatches(coordinate)) { hint = anchor.interrupted ? RESTART_INTERRUPTED : RESTART_OUTSIDE; reanchor(coordinate); }
      // The desk holds base + bumps: an earlier cancel/no-move release left
      // nothing interrupted, so a later desk change is labelled as such.
      else if (coordinate) anchor.interrupted = false;
    }
    resetButton.disabled = !editable; pointsButton.disabled = drawButton.disabled = false;
    for (const { filter, node } of cutButtons) {
      const position = shownFilter(readback, filter), on = cutIsOn(filter, position), hzLabel = on ? hzText(auxEqFilterHz(position)) : 'off';
      node.disabled = !filterEditable; node.className = on ? 'mm-active' : ''; node.setAttribute('aria-pressed', String(on));
      node.setAttribute('aria-label', `${CUT_NAMES[filter][0]} (${CUT_NAMES[filter][1]} filter), ${hzLabel}${filterEditable ? '' : `; ${eqFilterCompactState(readback) || 'unavailable'}`}`);
      node.setAttribute('title', filterEditable ? '' : eqFilterCompactState(readback));
    }
    // A local hint is shown alongside the owner's status, never in place of it.
    const ownerText = owned(control) ? control.reason || control.status : editable ? 'Ready: drag a point or slider, or draw. Changes are sent live while you drag (throttled).' : unavailableReason(readback);
    const showHint = Boolean(hint) && (editable || owned(control));
    hintBadge.textContent = showHint ? hint : ''; hintBadge.hidden = !showHint; hintBadge.setAttribute('title', showHint ? hint : '');
    // Compact read-only state: a readback reason, else the owner's one-line reason
    // (the full text also stays in the app's header/footer status and the title).
    const readbackOk = ['mono', 'linked'].includes(readback.link) && readback.complete && readback.equal;
    const stateText = editable ? eqFilterCompactState(readback) : readbackOk && owned(control) ? control.reason || control.status : eqCompactState(readback);
    stateBadge.textContent = stateText; stateBadge.hidden = !stateText; stateBadge.setAttribute('title', editable ? '' : ownerText);
    stateBadge.dataset.state = editable ? 'editable' : 'read-only';
    if (diag) renderDiagnostics(readback, control, showHint ? `${hint} ${ownerText}` : ownerText);
    syncParams(); paint(readback, editable ? '' : ownerText);
  }
  function renderDiagnostics(readback, control, statusText) {
    diag.status.textContent = statusText;
    diag.modeNote.textContent = EQ_MODE_NOTES[mode]; diag.detailNotes.textContent = `${EQ_MODE_NOTES[mode]} ${legendText}`;
    const sides = new Set(readback.sides.map(side => side.auxIndex));
    for (const [key, row] of diag.rows) if (!sides.has(key)) { row.remove(); diag.rows.delete(key); }
    readback.sides.forEach((side, index) => {
      let row = diag.rows.get(side.auxIndex); if (!row) { row = make('p'); diag.rows.set(side.auxIndex, row); diag.readbackRows.append(row); }
      if (diag.readbackRows.children[index] !== row) diag.readbackRows.insertBefore(row, diag.readbackRows.children[index] || null);
      row.textContent = `${readback.sides.length === 2 ? index ? 'R · ' : 'L · ' : ''}${eqSideText(side)}: ${side.bands.map((value, band) => `${hzText(AUX_EQ_DISPLAY_CENTRES[band])} ${value === undefined ? 'not received' : `${dbText(auxEqPositionToDb(value))} (raw ${value})`}`).join(' · ')}`;
    });
    const requested = owned(control) ? control.eqRequested : null;
    diag.requestedRow.textContent = requested ? `Requested (not proof of application): ${requested.map((value, band) => `${hzText(AUX_EQ_DISPLAY_CENTRES[band])} ${dbText(auxEqPositionToDb(value))}`).join(' · ')}`
      : owned(control) && control.requestedDiagnostic?.length ? `Last requested (inactive): ${control.requestedDiagnostic.length} band values · ${control.status}` : 'No requested GEQ curve in this connection.';
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
    gesture = { token, input, draw: coordinate.map(auxEqPositionToDb), lastDraw: null, touched: false, keyboard: null, changed: false };
    previewValues = null;
    return token;
  }
  function previewIntent(intent) {
    if (!gesture) return null;
    gesture.touched = true;
    const values = session.previewEqGesture(gesture.token, intent);
    if (values) previewValues = values;
    paint(projectEqReadback(snapshot, auxIndex));
    return values;
  }
  // F06-S05: one cut intent through the private owner; the owner clamps it and
  // answers with the position it will request (null = refused, nothing changes).
  function previewFilter(intent) {
    if (!gesture) return null;
    gesture.touched = true;
    const mapped = session.previewEqFilterGesture(gesture.token, intent);
    if (mapped) { filterPreview = { ...filterPreview, [mapped.filter]: mapped.value }; gesture.changed = true; if (drag) drag.changed = true; }
    paint(projectEqReadback(snapshot, auxIndex));
    return mapped;
  }
  function finish(commit) {
    const active = gesture; gesture = null; drag = null;
    if (!active) return;
    settling = true;
    try {
      if (commit) {
        const sent = session.commitEqGesture(active.token), outcome = session.snapshot().control?.outcome;
        // Sparse dispatch: a release whose bands all match sends nothing; say so.
        if (active.filter) { /* A cut gesture never touches the point anchor or band hints. */ }
        else if (mode === 'points' && outcome === 'no-op') hint = points.every(point => point.gainDb === 0) ? ZERO_GAIN_HINT : 'No change sent: every band already matches the requested curve.';
        // A failed or partial release is our interruption, not a desk change.
        else if (mode === 'points' && anchor && !sent) anchor.interrupted = true;
      } else {
        // Only a gesture that moved points can leave the desk short of them.
        if (mode === 'points' && anchor && active.touched && !active.filter) anchor.interrupted = true;
        session.cancelEqGesture();
      }
    } finally { settling = false; }
    // A draw gesture (committed or not) changes the curve under the points.
    if (mode === 'draw' && !active.filter) dropAnchor();
    previewValues = null; filterPreview = null; render();
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
    const cutNode = event.target.closest?.('[data-eq-filter-handle]');
    if (cutNode) {
      // A cut handle grabs in both modes through its own hit circle only.
      if (!filterEditable) return;
      if (!begin()) return;
      gesture.filter = cutNode.dataset.eqFilterHandle;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, changed: false, filter: gesture.filter };
      svg.setPointerCapture?.(event.pointerId); event.preventDefault?.();
      return;
    }
    const handle = event.target.closest?.('[data-eq-handle]');
    // Only a mouse press on the background may grab a nearby handle; touch/pen
    // grabs come from the handle's own hit circle (the svg is touch-action:none,
    // so a background touch neither pans nor starts a gesture).
    const index = handle ? Number(handle.dataset.eqHandle) : mode === 'points' && event.pointerType === 'mouse' ? nearHandle(event) : -1;
    if (mode === 'points' && index < 0) return; // Background touch/pen: no gesture, no write.
    if (mode === 'points') { selectedPoint = index; syncParams(); handles[index].group.focus?.({ preventScroll: true }); }
    if (!begin()) return;
    if (mode === 'draw' && !gesture.draw) { finish(false); return; }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, changed: false };
    svg.setPointerCapture?.(event.pointerId); event.preventDefault?.();
    if (mode === 'draw') drawAt(event);
  }
  // Nearest visible handle within HANDLE_GRAB_PX of the press (viewBox units are
  // CSS pixels: the viewBox matches the rendered size).
  function nearHandle(event) {
    const rect = geometry().rect, x = event.clientX - (rect.left || 0), y = event.clientY - (rect.top || 0);
    let best = -1, distance = HANDLE_GRAB_PX;
    handles.forEach((handle, index) => {
      const d = Math.hypot(handle.cx - x, handle.cy - y);
      if (Number.isFinite(d) && d <= distance) { best = index; distance = d; }
    });
    return best;
  }
  function onPointerMove(event) {
    if (!drag || drag.id !== event.pointerId || !gesture) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    if (drag.filter) { previewFilter({ filter: drag.filter, enabled: true, value: pointer(event).x }); return; }
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
  // No text selection or native drag inside the graph (it would steal the press).
  const suppress = event => event.preventDefault?.();
  svg.addEventListener('dragstart', suppress); svg.addEventListener('selectstart', suppress);
  function setMode(next) {
    if (mode === next) return;
    if (gesture) { gestures.cancel(); finish(false); }
    mode = next; render(); // Mutually exclusive intents; switching sends nothing.
  }
  function onClick(event) {
    const target = event.target.closest?.('button');
    if (!target || target.disabled || !open) return;
    if (target === back) { close(); return; }
    if (target.dataset.eqMode) { setMode(target.dataset.eqMode); return; }
    if (target.dataset.eqFilter) { toggleFilter(target.dataset.eqFilter); return; }
    if (target.dataset.eqPoint !== undefined && mode === 'points') { if (gesture) { gestures.cancel(); finish(false); } selectedPoint = Number(target.dataset.eqPoint); render(); return; }
    // F09-S09 (user decision 2026-11-20): one click is one immediate, deliberate
    // scoped reset through the private owner (sparse; bypass/filters untouched;
    // never native resetGraphEQ). An active gesture is cancelled first (its live
    // steps stay applied); the owner then refuses the reset while it cannot arm
    // (e.g. its own echoes are outstanding), so nothing is queued or replayed.
    if (target === resetButton && editable) {
      if (gesture) { gestures.cancel(); finish(false); }
      if (!editable) return;
      if (!owned(session.snapshot().control)) session.selectEqTarget(auxIndex);
      dropAnchor(); session.resetEqBands(); render(); // Points restart from the reset curve.
    }
  }
  // F06-S05: Low/High cut toggle = one immediate, deliberate one-shot through the
  // private owner (never streamed): on writes the last used (else the Demo
  // default) position, off writes exactly 0 (hpf) / 1 (lpf). Nothing is queued.
  function toggleFilter(filter) {
    if (!open || !AUX_EQ_FILTERS.includes(filter)) return;
    if (gesture) { gestures.cancel(); finish(false); }
    if (!filterEditable) return;
    if (!owned(session.snapshot().control)) session.selectEqTarget(auxIndex);
    const control = session.snapshot().control, readback = projectEqReadback(snapshot, auxIndex);
    const retained = owned(control) && control.eqFilters?.coordinate ? control.eqFilters.coordinate[AUX_EQ_FILTERS.indexOf(filter)] : undefined;
    const position = typeof retained === 'number' ? retained : readback.filters[filter], key = `${auxIndex}.${filter}`;
    if (cutIsOn(filter, position)) { lastCut.set(key, position); session.setEqFilter({ filter, enabled: false, value: position }); }
    else session.setEqFilter({ filter, enabled: true, value: lastCut.get(key) ?? AUX_EQ_FILTER_DEFAULT[filter] });
    render();
  }
  section.addEventListener('click', onClick);
  // Holding Enter on the focused reset button must not auto-repeat resets.
  const onResetKey = event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault?.(); };
  resetButton.addEventListener('keydown', onResetKey);
  // Deliberate keyboard gesture on a focused handle: the first arrow keydown
  // begins, each press previews through the same private path, keyup commits
  // (like faders); Escape or leaving the handle cancels.
  function keyMove(handle, event) {
    const index = Number(handle.dataset.eqHandle), [key, sign] = ARROWS[event.key];
    if (gesture && gesture.keyboard !== index) return;
    if (!gesture) {
      if (!editable) return;
      if (selectedPoint !== index) { selectedPoint = index; syncParams(); }
      if (!begin()) return;
      gesture.keyboard = index;
    }
    if (!anchor) return;
    const previous = points[index], factor = event.shiftKey ? KEY_SHIFT : 1;
    const x = key === 'x' ? clamp(previous.x + sign * KEY_X_STEP * factor, 0, 1) : previous.x;
    const rest = centreRest(index, x);
    const gainDb = key === 'gainDb' ? pointCentreGainLimit(rest, clamp(previous.gainDb + sign * KEY_GAIN_STEP * factor, -12, 12), previous.gainDb) : previous.gainDb;
    points[index] = { ...previous, x, gainDb };
    if (previewIntent(requestedPointSamples(points, anchor.base))) gesture.changed = true;
    else points[index] = { ...previous, x }; // x still follows; the gain stays.
    syncParams(); paint(projectEqReadback(snapshot, auxIndex));
  }
  // Deliberate keyboard gesture on a focused cut handle (same rules as points).
  function keyMoveFilter(handle, event) {
    const filter = handle.dataset.eqFilterHandle, [, sign] = ARROWS[event.key];
    if (gesture && gesture.keyboardFilter !== filter) return;
    if (!gesture) {
      if (!filterEditable || !begin()) return;
      gesture.filter = filter; gesture.keyboardFilter = filter; gesture.filterPosition = shownFilter(projectEqReadback(snapshot, auxIndex), filter);
    }
    if (typeof gesture.filterPosition !== 'number') return;
    const mapped = previewFilter({ filter, enabled: true, value: clamp(gesture.filterPosition + sign * KEY_X_STEP * (event.shiftKey ? KEY_SHIFT : 1), 0, 1) });
    if (mapped) gesture.filterPosition = mapped.value;
  }
  function onKeyUp(event) {
    if (gesture?.keyboardFilter && ARROWS[event.key]) {
      const cut = event.target?.closest?.('[data-eq-filter-handle]');
      if (cut && cut.dataset.eqFilterHandle === gesture.keyboardFilter) { event.preventDefault?.(); finish(gesture.changed); }
      return;
    }
    if (!gesture || gesture.keyboard === null || !ARROWS[event.key]) return;
    const handle = event.target?.closest?.('[data-eq-handle]');
    if (!handle || Number(handle.dataset.eqHandle) !== gesture.keyboard) return;
    event.preventDefault?.(); finish(gesture.changed);
  }
  function onFocusOut(event) {
    const cut = event.target?.closest?.('[data-eq-filter-handle]');
    if (cut && gesture && gesture.keyboardFilter === cut.dataset.eqFilterHandle) { finish(false); return; }
    const handle = event.target?.closest?.('[data-eq-handle]');
    if (handle && gesture && gesture.keyboard === Number(handle.dataset.eqHandle)) finish(false);
  }
  function onKey(event) {
    if (!open) return;
    const cutHandle = event.target?.closest?.('[data-eq-filter-handle]');
    if (cutHandle) {
      if (ARROWS[event.key]) { event.preventDefault?.(); keyMoveFilter(cutHandle, event); return; }
      if (event.key === 'Escape' && gesture?.keyboardFilter) { event.preventDefault?.(); finish(false); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); if (!event.repeat) toggleFilter(cutHandle.dataset.eqFilterHandle); return; }
    }
    const handle = event.target?.closest?.('[data-eq-handle]');
    if (handle && mode === 'points' && ARROWS[event.key]) { event.preventDefault?.(); keyMove(handle, event); return; }
    if (handle && event.key === 'Escape' && gesture && gesture.keyboard !== null) { event.preventDefault?.(); finish(false); return; }
    if (handle && (event.key === 'Enter' || event.key === ' ') && mode === 'points') {
      event.preventDefault?.(); if (gesture) { gestures.cancel(); finish(false); }
      selectedPoint = Number(handle.dataset.eqHandle); render(); return;
    }
    if (event.key !== 'Escape' || gesture || event.target?.closest?.('.mm-fader-control')) return;
    close();
  }
  section.addEventListener('keydown', onKey); section.addEventListener('keyup', onKeyUp); section.addEventListener('focusout', onFocusOut);
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
    open = false; binding = null; section.hidden = true; root.dataset.eqOpen = 'false';
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
    destroy() { close(); destroyed = true; unsubscribe(); unsubscribeContext(); gestures.destroy(); section.removeEventListener('click', onClick); section.removeEventListener('keydown', onKey); section.removeEventListener('keyup', onKeyUp); section.removeEventListener('focusout', onFocusOut); resetButton.removeEventListener('keydown', onResetKey); svg.removeEventListener('dragstart', suppress); svg.removeEventListener('selectstart', suppress); mixButton?.removeEventListener('click', onMixButton); window?.removeEventListener?.('resize', resize); section.remove(); },
  };
}
