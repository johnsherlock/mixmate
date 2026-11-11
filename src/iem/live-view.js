import { installFaderGestures } from './gestures.js';
import { observeIemLayout } from './layout.js';
import { startLocalClock } from './clock.js';
import { GROUP_DELTA_WINDOW } from './relative-groups.js';
import { sourceLabel } from './live-provider.js';
import { outputColour, overviewColour } from './theme.js';

// Provider/mixer strings are always text. Keyed inputs/caps and bank containers
// survive readout changes, preserving touch/scroll position without any writer.
export function mountReadOnlyView(root, { onSelectAux = () => {}, onOverview = () => {}, onToggleGroup = () => {}, onAllChannels = () => {}, onOpenPan = () => {}, onSelectGroupLevel = () => {}, onSelectLevel = () => {}, onToggleLevel = () => {}, onBeginLevel = () => null, onPreviewLevel = (token, value) => value, onCommitLevel = () => {}, onCancelLevel = () => {} } = {}) {
  const $ = selector => root.querySelector(selector), document = root.ownerDocument;
  const content = $('.mm-content');
  let groupEditing = false, auxSelected = false;
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
  const shortcutNodes = new Map(), levelTargets = new WeakMap();
  const enableLevel = element('button', 'mm-level-enable', 'Enable level'); enableLevel.type = 'button'; enableLevel.disabled = true; enableLevel.hidden = true;
  $('.mm-local-tabs').append(enableLevel);
  let control = null, preview = null, selectedAux = null;
  const groupInputs = new WeakMap();
  const deltaText = value => `Δ ${value > 0 ? '+' : ''}${value.toFixed(2)} dB`;
  const selectedTarget = target => control?.selected && JSON.stringify(target) === JSON.stringify(control.selected);
  function renderShortcuts(model, selected) {
    if (!shortcuts) return;
    const choices = [...(model.groups || []).map(group => ({ key: `group:${group.id}`, name: group.name, id: group.id })), { key: 'channels', name: 'All Channels' }];
    const keys = new Set(choices.map(choice => choice.key));
    for (const [key, button] of shortcutNodes) if (!keys.has(key)) { button.remove(); shortcutNodes.delete(key); }
    for (const [index, choice] of choices.entries()) {
      let button = shortcutNodes.get(choice.key);
      if (!button) {
        button = element('button', ''); button.type = 'button';
        if (choice.id) button.dataset.toggleGroup = choice.id; else button.dataset.mode = 'channels';
        shortcutNodes.set(choice.key, button); shortcuts.append(button);
      }
      if (shortcuts.children[index] !== button) shortcuts.insertBefore(button, shortcuts.children[index] || null);
      if (button.textContent !== choice.name) button.textContent = choice.name;
      button.setAttribute('title', choice.name);
      const active = choice.id ? model.view === 'groups' && model.expandedGroupId === choice.id : model.view === 'channels' || model.view === undefined;
      button.className = `${choice.id ? 'mm-group-shortcut' : 'mm-all-channels'}${active ? ' mm-active' : ''}`;
      button.setAttribute('aria-pressed', String(active)); button.disabled = !selected;
    }
    shortcuts.hidden = !selected;
  }
  const gestures = installFaderGestures(content, {
    onBegin(input) {
      const token = onBeginLevel();
      if (token) preview = { input, token };
      return token;
    },
    onPreview(input, token, value) {
      const next = onPreviewLevel(token, value);
      const group = groupInputs.get(input);
      if (group && typeof next === 'number') { group.output.textContent = deltaText(next); group.output.setAttribute('title', `Relative delta ${next} dB; whole-group limit applied.`); }
      return next;
    },
    onCommit(input, token) { preview = null; onCommitLevel(token, Number(input.value)); },
    onCancel(input, token) { preview = null; onCancelLevel(token); },
  }), layout = observeIemLayout(root, gestures.sync), stopClock = startLocalClock($('.mm-clock'));
  function createStrip(kind) {
    const article = element('article', `mm-strip ${kind === 'source' ? 'mm-channel' : kind === 'group' ? 'mm-group' : 'mm-master'}`);
    const head = element('div', 'mm-strip-head'), name = element('button', 'mm-strip-name'), description = element('span', 'mm-strip-detail');
    name.type = 'button'; name.disabled = true; head.append(name, description);
    const output = element('output', 'mm-value'), space = element('div', 'mm-fader-space'), scale = element('span', 'mm-ruler', 'POSITION');
    if (kind === 'group') {
      const badge = element('span', 'mm-group-master-label', 'GROUP MASTER');
      const selection = element('div', 'mm-group-selection'); selection.append(badge);
      const select = control ? element('button', 'mm-group-level-select', 'Select level') : null;
      if (select) { select.type = 'button'; selection.append(select); }
      if (!control) head.append(selection);
      const unavailable = element('div', 'mm-group-level-placeholder', 'Level unavailable');
      unavailable.setAttribute('aria-label', 'Relative group level unavailable · read-only');
      const state = element('span', 'mm-live-strip-state'), note = element('span', 'mm-group-control-note', control ? 'RELATIVE Δ · 0 per gesture · no VU' : 'Local definition · no group meter');
      space.append(scale, unavailable);
      let input;
      if (control) {
        scale.textContent = 'RELATIVE Δ';
        input = element('input', 'mm-vertical'); input.type = 'range'; input.min = String(-GROUP_DELTA_WINDOW); input.max = String(GROUP_DELTA_WINDOW); input.step = 'any'; input.dataset.gestureStep = '0.1'; input.value = '0'; input.disabled = true; input.dataset.group = '';
        space.append(input);
      }
      if (control) {
        selection.className = 'mm-group-control-note mm-group-selection';
        selection.setAttribute('title', 'Group master · relative delta zero per gesture · no aggregate level or VU');
        const reference = element('span', 'mm-pan-button', 'RELATIVE Δ · 0 per gesture');
        article.append(head, output, space, reference, state, selection);
      } else article.append(head, output, space, state, note);
      const strip = { kind, article, name, description, output, state, input, select, unavailable };
      if (input) groupInputs.set(input, strip);
      return strip;
    }
    const input = element('input', 'mm-vertical');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.001'; input.disabled = true;
    if (kind === 'source') input.dataset.channel = ''; else input.dataset.master = '';
    const meter = element('span', 'mm-meter-pair'); meter.setAttribute('role', 'img');
    const tracks = [0, 1].map(() => {
      const track = element('span', 'mm-meter'), fill = element('i'); track.append(fill); meter.append(track); return { track, fill };
    });
    const meterCaption = element('span', 'mm-live-meter-caption'), meterLabel = element('span', 'mm-live-meter-label'), meterStatus = element('span', 'mm-live-meter-status');
    meterCaption.append(meterLabel, meterStatus);
    const pan = element(control?.panCapable && kind === 'source' ? 'button' : 'span', 'mm-pan-button'), state = element('span', 'mm-live-strip-state');
    let panReadout;
    if (control?.panCapable && kind === 'source') {
      panReadout = element('span', 'mm-pan-readout'); pan.append(element('span', 'mm-pan-short', 'Pan'), panReadout);
      article.dataset.panBrowse = 'true';
    }
    space.append(scale, input, meter); article.append(head, output, space, pan, state, meterCaption);
    return { kind, article, name, description, output, input, pan, panReadout, state, meter, tracks, meterCaption, meterLabel, meterStatus };
  }
  function updateMeter(strip, model) {
    if (strip.kind === 'group') return;
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
      if (!strip) { strip = createStrip(model.kind === 'group' ? 'group' : kind); strips.set(model.id, strip); container.append(strip.article); }
      if (container.children[index] !== strip.article) container.insertBefore(strip.article, container.children[index] || null);
      strip.article.dataset.id = model.id;
      if (model.auxIndex !== undefined) strip.article.style.setProperty('--mm-strip-color', outputColour(model.themeIndex ?? model.auxIndex));
      strip.name.textContent = model.name; strip.description.textContent = model.detail;
      strip.output.textContent = model.kind === 'group' ? '—' : model.levelText ?? '—';
      strip.article.dataset.unresolved = String(Boolean(model.unresolved));
      if (strip.kind === 'group') {
        strip.name.disabled = false; strip.name.dataset.toggleGroup = model.groupId;
        strip.name.setAttribute('title', `${model.name} · group master`);
        const target = { kind: 'group', groupId: model.groupId, auxIndex: selectedAux };
        const chosen = Boolean(selectedTarget(target)), eligible = chosen && control?.eligible;
        strip.article.dataset.levelSelected = String(chosen);
        strip.article.dataset.unknown = String(!eligible);
        if (strip.select) {
          strip.select.dataset.selectGroupLevel = model.groupId; strip.select.disabled = false;
          strip.select.setAttribute('aria-label', `Select relative level for group ${model.name}`); strip.select.setAttribute('aria-pressed', String(chosen));
          strip.input.dataset.group = model.groupId;
          strip.input.disabled = !(eligible && control.armed && !control.pending);
          strip.input.setAttribute('aria-label', `${model.name} relative delta, zero per gesture; cap drag or arrow keys, release to apply`);
          if (preview?.input !== strip.input) strip.input.value = '0';
          strip.unavailable.hidden = Boolean(eligible);
        }
        strip.output.textContent = eligible ? deltaText(control.gestureActive ? control.previewDelta || 0 : control.pending ? control.lastDelta || 0 : 0) : 'Δ —';
        strip.output.setAttribute('aria-label', eligible ? 'Relative adjustment delta; not a group level' : 'Group adjustment unavailable');
        strip.state.textContent = chosen ? control.reason || control.status : model.stateText;
        continue;
      }
      (strip.panReadout || strip.pan).textContent = model.panText ?? 'Pan unavailable';
      if (control?.panCapable && model.sourceId && model.auxIndex !== undefined) { strip.pan.type = 'button'; strip.pan.disabled = false; strip.pan.dataset.openPan = model.sourceId; strip.pan.dataset.panAux = String(model.auxIndex); strip.pan.setAttribute('aria-label', `Inspect normalized AUX pan for ${model.name}`); strip.pan.setAttribute('aria-haspopup', 'dialog'); }
      else if (strip.panReadout) { strip.pan.disabled = true; delete strip.pan.dataset.openPan; delete strip.pan.dataset.panAux; strip.pan.setAttribute('aria-label', 'Pan unavailable for unresolved member'); } strip.state.textContent = model.stateText ?? '';
      strip.pan.setAttribute('title', model.panText ?? 'Pan unavailable'); strip.state.setAttribute('title', strip.state.textContent);
      strip.name.setAttribute('title', model.name);
      const levelTarget = model.sourceId && model.auxIndex !== undefined ? { kind: 'send', auxIndex: model.auxIndex, sourceId: model.sourceId }
        : model.auxIndex !== undefined ? { kind: 'master', auxIndex: model.auxIndex } : null;
      if (levelTarget) levelTargets.set(strip.name, levelTarget);
      const isSelected = levelTarget && selectedTarget(levelTarget);
      strip.article.dataset.levelSelected = String(Boolean(isSelected));
      strip.name.setAttribute('aria-pressed', String(Boolean(isSelected)));
      strip.name.disabled = !model.browsable && !(control && levelTarget);
      if (model.browsable) strip.name.dataset.openAux = String(model.auxIndex); else delete strip.name.dataset.openAux;
      strip.input.setAttribute('aria-label', `${model.name} received level, read-only`);
      const known = typeof model.position === 'number' && Number.isFinite(model.position) && model.position >= 0 && model.position <= 1;
      strip.article.dataset.unknown = String(!known);
      strip.input.disabled = !(control && isSelected && control.eligible && control.armed && !control.pending);
      strip.input.setAttribute('aria-label', `${model.name} ${strip.input.disabled ? 'received level, controls off' : 'level preview; cap drag, double track tap or arrow keys; release to apply'}`);
      if (preview?.input !== strip.input) strip.input.value = known ? String(model.position) : '0';
      updateMeter(strip, model);
    }
  }
  function render(model) {
    control = model.control || null; selectedAux = model.selectedAux;
    root.dataset.levelControls = String(Boolean(control));
    if (!control?.gestureActive && preview) { preview = null; gestures.cancel(); }
    const targetLabel = control?.selected ? `${control.selected.kind === 'group' ? `Group ${control.groupName || control.selected.groupId}` : control.selected.kind === 'master' ? 'Master' : sourceLabel(control.selected.sourceId)} → AUX ${control.selected.auxIndex + 1}` : 'no selected level';
    enableLevel.hidden = !control;
    const levelArmed = control?.armed && control.operation !== 'pan';
    enableLevel.disabled = !control?.selected || control.operation === 'pan' || !control.eligible || control.pending;
    enableLevel.textContent = levelArmed ? 'Disable level' : 'Enable level';
    enableLevel.setAttribute('aria-label', `${levelArmed ? 'Disable' : 'Enable'} level for ${targetLabel}`);
    enableLevel.setAttribute('title', `${targetLabel}: ${control?.reason || control?.status || ''}`);
    $('.mm-mode-label').textContent = control ? `LIVE IEM · ${control.operation === 'pan' ? 'PAN' : control.panCapable && !control.selected ? 'CONTROLS' : 'LEVELS'} ${control.pending ? 'PENDING' : control.armed ? 'ENABLED' : 'OFF'}` : 'READ-ONLY IEM';
    $('.mm-dirty').textContent = control ? control.status : 'Read-only · no parameter writes';
    $('.mm-dirty').setAttribute('title', control?.status || 'Read-only');
    const terminal = ['error', 'closed', 'timeout', 'blocked', 'unsupported', 'invalid'].includes(model.connectionPhase);
    $('.mm-feedback').textContent = terminal ? model.status : control ? `${targetLabel}: ${control.pending ? control.status : control.reason || control.status}` : model.status;
    empty.children[0].textContent = terminal ? 'Connection stopped' : 'Waiting for received AUX state';
    empty.children[1].textContent = terminal ? model.status : 'Connect explicitly to your desk. Unknown or unsupported state stays unavailable; Demo is a separate simulation.';
    $('.mm-feedback').setAttribute('title', `${model.status} · ${targetLabel}: ${control?.reason || control?.status || ''}`);
    $('.mm-feedback').setAttribute('aria-label', $('.mm-feedback').textContent);
    $('.mm-desk').textContent = model.connectionPhase ? `${model.modelLabel} · ${model.connectionPhase}` : 'No socket connection';
    const selected = model.selectedAux !== undefined && model.selectedAux !== null;
    root.dataset.auxView = String(selected);
    root.style.setProperty('--mm-mix-color', model.selectedMix ? outputColour(model.selectedMix.themeIndex ?? model.selectedMix.auxIndex) : overviewColour);
    auxSelected = selected;
    $('.mm-local-tabs').hidden = !selected && !groupEditing;
    if ($('.mm-title')) $('.mm-title').textContent = model.selectedMix?.name ?? '';
    if ($('.mm-page-state')) $('.mm-page-state').textContent = selected ? model.view === 'groups' ? model.expandedGroupId ? control ? 'Expanded group · relative Δ controls' : 'Expanded group · level unavailable' : control ? 'Local group masters · relative Δ controls' : 'Local group masters · level unavailable' : control ? 'All observed AUX sources · select and enable a level' : 'All observed AUX sources · read-only' : 'Individual received outputs';
    reconcile(grid, overviewStrips, model.mixes, 'master');
    reconcile(bank, sourceStrips, model.sources || [], 'source');
    reconcile(pinned, pinnedStrips, model.selectedMix && model.showAuxMaster !== false ? [model.selectedMix] : [], 'master');
    grid.hidden = selected; sends.hidden = !selected;
    sends.className = `mm-sends-layout${model.expandedGroupId ? ' mm-no-master' : ''}`;
    bank.className = `mm-strip-scroll${model.expandedGroupId ? ' mm-expanded' : ''}`;
    pinned.hidden = Boolean(model.expandedGroupId);
    empty.hidden = selected || model.mixes.length > 0;
    sourceEmpty.hidden = !selected || (model.sources || []).length > 0;
    sourceEmpty.textContent = model.view === 'groups' ? 'No local groups yet. Edit Groups to create one.' : 'No source sends received for this AUX yet.';
    renderShortcuts(model, selected);
    gestures.prepare();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.openPan !== undefined) { gestures.cancel(); onOpenPan({ sourceId: button.dataset.openPan, auxIndex: Number(button.dataset.panAux) }); }
    if (button.dataset.openAux !== undefined) { gestures.cancel(); onSelectAux(Number(button.dataset.openAux)); }
    if (control && levelTargets.has(button)) { gestures.cancel(); onSelectLevel(levelTargets.get(button)); }
    if (button === enableLevel) { gestures.cancel(); onToggleLevel(); }
    if (button.dataset.selectGroupLevel !== undefined) { gestures.cancel(); onSelectGroupLevel(button.dataset.selectGroupLevel); }
    if (button.dataset.toggleGroup !== undefined) { gestures.cancel(); onToggleGroup(button.dataset.toggleGroup); }
    if (button.dataset.mode === 'channels') { gestures.cancel(); onAllChannels(); }
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
    groupEditing(enabled) {
      groupEditing = enabled;
      root.dataset.groupEditing = String(enabled);
      const button = root.querySelector('[data-action="edit-groups"]');
      if (button) button.disabled = !enabled;
      $('.mm-local-tabs').hidden = !auxSelected && !enabled;
    },
    preferences(preferences) { root.dataset.preferredOrientation = preferences.orientation; root.dataset.showMeters = String(preferences.showMeters); layout.apply(); },
    clear() { gestures.cancel(); render({ status: 'Not connected — no received mixer state', mixes: [] }); },
    destroy() { meterLegend.remove(); root.removeEventListener('click', click); gestures.destroy(); layout.destroy(); stopClock(); },
  };
}
