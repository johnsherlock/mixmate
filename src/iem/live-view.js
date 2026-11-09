import { installFaderGestures } from './gestures.js';
import { observeIemLayout } from './layout.js';
import { startLocalClock } from './clock.js';
import { outputColour, overviewColour } from './theme.js';

// Provider/mixer strings are always text. Keyed inputs/caps and bank containers
// survive readout changes, preserving touch/scroll position without any writer.
export function mountReadOnlyView(root, { onSelectAux = () => {}, onOverview = () => {} } = {}) {
  const $ = selector => root.querySelector(selector), document = root.ownerDocument;
  const content = $('.mm-content');
  const meterLegend = document.createElement('p');
  meterLegend.className = 'mm-live-meter-legend';
  meterLegend.textContent = 'VU: post-fader · source VU is NOT AUX-send contribution · library scale; firmware unverified';
  content.before(meterLegend);
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const empty = element('div', 'mm-empty');
  empty.append(element('h2', '', 'Waiting for received AUX state'), element('p', '', 'Connect explicitly to your desk. Unknown or unsupported state stays unavailable; Demo is a separate simulation.'));
  const grid = element('div', 'mm-strip-grid'), sends = element('div', 'mm-sends-layout');
  const sourceEmpty = element('p', 'mm-source-empty', 'No source sends received for this AUX yet.');
  const main = element('div', 'mm-sends-main'), bank = element('div', 'mm-strip-scroll'), pinned = element('aside', 'mm-pinned');
  main.append(sourceEmpty, bank); sends.append(main, pinned); content.replaceChildren(empty, grid, sends);
  const overviewStrips = new Map(), sourceStrips = new Map(), pinnedStrips = new Map();
  for (const button of root.querySelectorAll('button')) {
    if (!['fullscreen', 'overview'].includes(button.dataset.action)) button.disabled = true;
  }
  $('.mm-navigation').hidden = false;
  $('.mm-local-tabs').hidden = false;
  $('.mm-snapshot-name').textContent = 'Unavailable';
  $('.mm-desk').textContent = 'No socket connection';
  $('.mm-dirty').textContent = 'Read-only · no parameter writes';
  $('.mm-rec-state').textContent = 'Recording status unavailable';
  const shortcuts = $('.mm-group-switches');
  if (shortcuts) {
    const all = element('button', 'mm-all-channels mm-active', 'All Channels');
    all.type = 'button'; all.disabled = true;
    shortcuts.replaceChildren(all);
  }
  const gestures = installFaderGestures(root), layout = observeIemLayout(root, gestures.sync), stopClock = startLocalClock($('.mm-clock'));
  function createStrip(kind) {
    const article = element('article', `mm-strip ${kind === 'source' ? 'mm-channel' : 'mm-master'}`);
    const head = element('div', 'mm-strip-head'), name = element('button', 'mm-strip-name'), description = element('span', 'mm-strip-detail');
    name.type = 'button'; name.disabled = true; head.append(name, description);
    const output = element('output', 'mm-value'), space = element('div', 'mm-fader-space'), scale = element('span', 'mm-ruler', 'POSITION');
    const input = element('input', 'mm-vertical');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.001'; input.disabled = true;
    if (kind === 'source') input.dataset.channel = ''; else input.dataset.master = '';
    const meter = element('span', 'mm-meter-pair'); meter.setAttribute('role', 'img');
    const tracks = [0, 1].map(() => {
      const track = element('span', 'mm-meter'), fill = element('i'); track.append(fill); meter.append(track); return { track, fill };
    });
    const meterCaption = element('span', 'mm-live-meter-caption'), meterLabel = element('span', 'mm-live-meter-label'), meterStatus = element('span', 'mm-live-meter-status');
    meterCaption.append(meterLabel, meterStatus);
    const pan = element('span', 'mm-pan-button'), state = element('span', 'mm-live-strip-state');
    space.append(scale, input, meter); article.append(head, output, space, pan, state, meterCaption);
    return { article, name, description, output, input, pan, state, meter, tracks, meterCaption, meterLabel, meterStatus };
  }
  function updateMeter(strip, model) {
    const meter = model.meter || { status: 'missing', channelCount: 1, label: 'Meter', values: [], provenance: '' };
    // State frames may arrive alongside every VU packet. Existing fresh meter
    // fills/text publish only at the session cadence; missing/stale clears once.
    if (strip.meterRevision === meter.revision && (meter.status === 'fresh' || strip.meterState === meter.status)) return;
    strip.meterRevision = meter.revision; strip.meterState = meter.status;
    strip.meter.dataset.state = meter.status;
    strip.meterLabel.textContent = model.sourceId ? `Source VU${meter.channelCount === 2 ? ' L/R' : ''}` : 'Output VU';
    const numbers = meter.values.map(value => value.floor ? '−80 dB floor' : `${value.db.toFixed(1)} dB`);
    const numericText = meter.values.length === 2 ? meter.values.map(value => value.floor ? '−80 floor' : value.db.toFixed(1)).join('/') + ' dB' : numbers[0];
    strip.meterStatus.textContent = meter.status === 'fresh' ? numericText : meter.status === 'stale' ? 'Stale' : 'Unavailable';
    strip.meter.setAttribute('aria-label', `${meter.label}${meter.channelCount === 2 ? ' (L/R)' : ''}: ${strip.meterStatus.textContent}. ${meter.provenance}`);
    strip.meterCaption.setAttribute('title', `${meter.label}: ${strip.meterStatus.textContent}; ${meter.provenance}. Encoded zero is the meter floor, not proof of physical silence.`);
    strip.tracks.forEach(({ track, fill }, index) => {
      track.hidden = index >= meter.channelCount;
      fill.style.setProperty('--level', `${meter.status === 'fresh' ? (meter.values[index]?.position || 0) * 100 : 0}%`);
    });
  }
  function renderMeters(model) {
    for (const [strips, models] of [[overviewStrips, model.mixes], [sourceStrips, model.sources], [pinnedStrips, model.selectedMix ? [model.selectedMix] : []]]) {
      for (const item of models || []) { const strip = strips.get(item.id); if (strip) updateMeter(strip, item); }
    }
  }
  function reconcile(container, strips, models, kind) {
    const ids = new Set(models.map(model => model.id));
    for (const [id, strip] of strips) if (!ids.has(id)) { strip.article.remove(); strips.delete(id); }
    for (const [index, model] of models.entries()) {
      let strip = strips.get(model.id);
      if (!strip) { strip = createStrip(kind); strips.set(model.id, strip); container.append(strip.article); }
      if (container.children[index] !== strip.article) container.insertBefore(strip.article, container.children[index] || null);
      strip.article.dataset.id = model.id;
      if (model.auxIndex !== undefined) strip.article.style.setProperty('--mm-strip-color', outputColour(model.themeIndex ?? model.auxIndex));
      strip.name.textContent = model.name; strip.description.textContent = model.detail;
      strip.output.textContent = model.levelText ?? '—';
      strip.pan.textContent = model.panText ?? 'Pan unavailable'; strip.state.textContent = model.stateText ?? '';
      strip.pan.setAttribute('title', strip.pan.textContent); strip.state.setAttribute('title', strip.state.textContent);
      strip.name.setAttribute('title', model.name);
      strip.name.disabled = !model.browsable;
      if (model.browsable) strip.name.dataset.openAux = String(model.auxIndex); else delete strip.name.dataset.openAux;
      strip.input.setAttribute('aria-label', `${model.name} received level, read-only`);
      const known = typeof model.position === 'number' && Number.isFinite(model.position) && model.position >= 0 && model.position <= 1;
      strip.article.dataset.unknown = String(!known); strip.input.value = known ? String(model.position) : '0';
      updateMeter(strip, model);
    }
  }
  function render(model) {
    $('.mm-mode-label').textContent = 'READ-ONLY IEM';
    $('.mm-feedback').textContent = model.status;
    $('.mm-desk').textContent = model.connectionPhase ? `${model.modelLabel} · ${model.connectionPhase}` : 'No socket connection';
    const selected = model.selectedAux !== undefined && model.selectedAux !== null;
    root.dataset.auxView = String(selected);
    root.style.setProperty('--mm-mix-color', model.selectedMix ? outputColour(model.selectedMix.themeIndex ?? model.selectedMix.auxIndex) : overviewColour);
    $('.mm-local-tabs').hidden = !selected;
    if ($('.mm-title')) $('.mm-title').textContent = model.selectedMix?.name ?? '';
    if ($('.mm-page-state')) $('.mm-page-state').textContent = selected ? 'Observed AUX sources · read-only' : 'Individual received outputs';
    reconcile(grid, overviewStrips, model.mixes, 'master');
    reconcile(bank, sourceStrips, model.sources || [], 'source');
    reconcile(pinned, pinnedStrips, model.selectedMix ? [model.selectedMix] : [], 'master');
    grid.hidden = selected; sends.hidden = !selected;
    empty.hidden = selected || model.mixes.length > 0;
    sourceEmpty.hidden = !selected || (model.sources || []).length > 0;
    if (shortcuts) { shortcuts.hidden = !selected; shortcuts.querySelector('button').disabled = !selected; }
    gestures.prepare();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.openAux !== undefined) { gestures.cancel(); onSelectAux(Number(button.dataset.openAux)); }
    if (button.dataset.action === 'overview') { gestures.cancel(); onOverview(); }
    if (button.dataset.action === 'fullscreen') {
      const app = $('.mm-app');
      try {
        const promise = document.fullscreenElement ? document.exitFullscreen?.() : app.requestFullscreen?.();
        promise?.catch(() => { $('.mm-feedback').textContent = 'Fullscreen unavailable; use the installed app.'; });
      } catch { $('.mm-feedback').textContent = 'Fullscreen unavailable; use the installed app.'; }
    }
  }
  root.addEventListener('click', click);
  return {
    render, renderMeters,
    preferences(preferences) { root.dataset.preferredOrientation = preferences.orientation; root.dataset.showMeters = String(preferences.showMeters); layout.apply(); },
    clear() { gestures.cancel(); render({ status: 'Not connected — no received mixer state', mixes: [] }); },
    destroy() { meterLegend.remove(); root.removeEventListener('click', click); gestures.destroy(); layout.destroy(); stopClock(); },
  };
}
