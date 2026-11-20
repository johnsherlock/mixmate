import { landscapeColumns, channelSlots } from './channel-layout.js';
import { installFaderGestures } from './gestures.js';
import { observeIemLayout } from './layout.js';
import { startLocalClock } from './clock.js';
import { sourceLabel } from './live-provider.js';
import { outputColour, overviewColour } from './theme.js';
import { FADER_SCALE_KEY_STEP_DB, FADER_SCALE_MIN, FADER_SCALE_POINTER_STEP_DB, FADER_SCALE_TICKS, FADER_SCALE_TOP_DB, positionDbText, positionToScale, scaleTickPercent, scaleToPosition } from './fader-scale.js';

// Provider/mixer strings are always text. Keyed inputs/caps and bank containers
// survive readout changes, preserving touch/scroll position without any writer.
// F09-S07: `?debug` (or any value except 0/false/no/off) shows development-only Details.
export function debugFlag(search = '') {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}
export function mountReadOnlyView(root, { onSelectAux = () => {}, onOverview = () => {}, onToggleGroup = () => {}, onAllChannels = () => {}, onOpenPan = () => {}, onOpenDetail = () => {}, onDetailUpdate = () => {}, onSelectGroupLevel = () => {}, onSelectLevel = () => {}, canEditLevel = null, onToggleLevel = () => {}, onBeginLevel = () => null, onPreviewLevel = (token, value) => value, onCommitLevel = () => {}, onCancelLevel = () => {}, onOpenEq = null, debug = false } = {}) {
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

  let control = null, preview = null, selectedAux = null, bankModels = [];
  // Detail models are keyed by strip article; Details buttons exist only with ?debug.
  const detailModels = new WeakMap(), detailButtons = new WeakMap();
  function bankLayout() {
    const columns = landscapeColumns(bank.clientWidth || bank.getBoundingClientRect().width);
    bank.style.setProperty('--mm-bank-columns', String(columns));
    const slots = channelSlots(bankModels, columns);
    [...bank.children].forEach((node, index) => { node.style.gridColumn = root.dataset.orientation === 'landscape' ? String(slots[index]) : ''; });
  }
  const groupInputs = new WeakMap(), levelPeerIds = new WeakMap();
  const isCoordinate = model => {
    const target = control?.selected;
    return target?.kind === 'send' && target.auxIndex === model.auxIndex && model.levelPeerIds?.includes(target.sourceId)
      || target?.kind === 'master' && !model.sourceId && model.outputMembers?.includes(`a.${target.auxIndex}`);
  };
  function mirrorPreview(input, value) {
    const ids = levelPeerIds.get(input);
    if (!ids || !Number.isFinite(value)) return;
    for (const strip of sourceStrips.values()) {
      const target = levelTargets.get(strip.input);
      if (target?.kind === 'send' && ids.includes(target.sourceId) && target.auxIndex === selectedAux && !strip.input.disabled) strip.input.value = String(value);
    }
  }
  // One decimal so the group Δ fits a compact landscape strip; two in the title.
  // F09-S07: the readout is a fixed "Δ " prefix span plus an amount span, so
  // compact landscape can hide the prefix (CSS) instead of truncating.
  const deltaAmount = (value, digits = 1) => `${value > 0 ? '+' : ''}${value.toFixed(digits)} dB`;
  const deltaText = (value, digits = 1) => `Δ ${deltaAmount(value, digits)}`;
  // F09-S06 dB-linear level display: input values are scale units (dB from
  // -70 to +10, plus a short bottom segment down to -inf); the private session
  // still receives and returns desk positions 0..1.
  const unitPosition = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const scaleText = position => String(positionToScale(position));
  function levelInput(input) {
    input.min = String(FADER_SCALE_MIN); input.max = String(FADER_SCALE_TOP_DB); input.step = 'any';
    input.dataset.gestureStep = String(FADER_SCALE_POINTER_STEP_DB); input.dataset.keyStep = String(FADER_SCALE_KEY_STEP_DB);
    input.dataset.scale = 'db'; input.value = String(FADER_SCALE_MIN);
  }
  function ruler(scale) {
    scale.textContent = '';
    for (const value of [...FADER_SCALE_TICKS, FADER_SCALE_MIN]) {
      const tick = element('span', '', value === FADER_SCALE_MIN ? '−∞' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`);
      // F09-S07: compact layouts drop the −∞ label (CSS) so it never overlaps −70.
      tick.dataset.tick = value === FADER_SCALE_MIN ? 'off' : String(value);
      tick.style.top = `${scaleTickPercent(value)}%`; scale.append(tick);
    }
    scale.setAttribute('aria-hidden', 'true');
    scale.setAttribute('title', 'dB scale: equal dB = equal distance from +10 to −70 dB; the bottom segment reaches −∞');
  }
  // F09-S07: no per-strip state line (not in the design; its text changes made
  // strips jitter mid-drag). The text lives only in the fader space's title
  // tooltip and the debug-only Details; header/footer keep the single status.
  // Attribute-only, so it never changes layout during a gesture.
  // Screen readers get the same text through a visually hidden description
  // referenced by the fader (aria-describedby); it occupies no layout.
  const setState = (strip, text, title = text) => {
    if (strip.stateFull === title) return;
    strip.space.setAttribute('title', title); strip.status.textContent = title; strip.stateFull = title;
  };
  let statusIds = 0;
  function statusNode(article, control) {
    const node = element('span', 'mm-sr-only'); node.id = `mm-strip-status-${++statusIds}`; article.append(node);
    control?.setAttribute('aria-describedby', node.id); return node;
  }
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
    // Accepted prototype shortcut: a double tap on a master cap opens that AUX's
    // GEQ view. It never writes; the tapped cap's own gesture was cancelled.
    onMasterEQ(_, input) { const target = levelTargets.get(input); if (onOpenEq && target?.kind === 'master') onOpenEq(target.auxIndex); },
    onBegin(input) {
      const target = levelTargets.get(input);
      if (target && !selectedTarget(target)) {
        if (target.kind === 'group') onSelectGroupLevel(target.groupId);
        else onSelectLevel(target);
      }
      const token = onBeginLevel();
      if (token) preview = { input, token };
      return token;
    },
    onPreview(input, token, value) {
      // Scale → desk position for the private owner; its returned (clamped)
      // position → scale for the cap. Groups return the loudest-member
      // reference position; one common Δ renders from the owned snapshot.
      const position = onPreviewLevel(token, scaleToPosition(value));
      if (!unitPosition(position)) return null;
      const next = positionToScale(position);
      const group = groupInputs.get(input);
      if (preview?.input === input) { preview.value = next; preview.position = position; }
      mirrorPreview(input, next);
      return next;
    },
    onCommit(input, token) {
      const position = preview?.input === input && unitPosition(preview.position) ? preview.position : scaleToPosition(Number(input.value));
      preview = null; onCommitLevel(token, position);
    },
    onCancel(input, token) { preview = null; onCancelLevel(token); },
  }), layout = observeIemLayout(root, () => { bankLayout(); gestures.sync(); }), stopClock = startLocalClock($('.mm-clock'));
  function createStrip(kind) {
    const article = element('article', `mm-strip ${kind === 'source' ? 'mm-channel' : kind === 'group' ? 'mm-group' : 'mm-master'}`);
    const head = element('div', 'mm-strip-head'), name = element('button', 'mm-strip-name'), description = element('span', 'mm-strip-detail');
    name.type = 'button'; name.disabled = true; head.append(name, description);
    // F09-S07: Details is a development diagnostic, shown only with ?debug.
    if (debug) {
      const detail = element('button', 'mm-detail-button', 'Details'); detail.type = 'button'; detail.dataset.channelDetail = ''; detail.setAttribute('aria-haspopup', 'dialog');
      detailButtons.set(detail, article); article.append(detail);
    }
    const output = element('output', 'mm-value'), space = element('div', 'mm-fader-space'), scale = element('span', 'mm-ruler');
    ruler(scale);
    if (kind === 'group') {
      const badge = element('span', 'mm-group-master-label', 'GROUP MASTER');
      const selection = element('div', 'mm-group-selection'); selection.append(badge);
      const select = control ? element('button', 'mm-group-level-select', 'Select level') : null;
      if (select) { select.type = 'button'; selection.append(select); }
      if (!control) head.append(selection);
      const unavailable = element('div', 'mm-group-level-placeholder', 'Level unavailable');
      const deltaPrefix = element('span', 'mm-delta-prefix', 'Δ '), delta = element('span', 'mm-delta-amount', '—'); output.append(deltaPrefix, delta);
      // Full-range group fader on the display scale (F09-S06): the cap starts at
      // the loudest member's displayed level; every member gets the same scale Δ,
      // so all move the same distance (top: loudest at max; bottom: quietest at
      // −∞ since F09-S08; a member already at −∞ allows no downward travel).
      unavailable.setAttribute('aria-label', 'Relative group level unavailable · read-only');
      space.append(scale, unavailable);
      let input;
      if (control) {
        input = element('input', 'mm-vertical'); input.type = 'range'; levelInput(input); input.disabled = true; input.dataset.group = '';
        space.append(input);
      }
      if (control) {
        selection.className = 'mm-group-control-note mm-group-selection';
        selection.setAttribute('title', 'Group master · cap follows the loudest member · one common Δ per gesture · no aggregate level or VU');
        article.append(head, output, space, selection);
      } else article.append(head, output, space);
      const strip = { kind, article, name, description, output, delta, space, input, select, unavailable, status: statusNode(article, input || output) };
      if (input) groupInputs.set(input, strip);
      return strip;
    }
    const input = element('input', 'mm-vertical');
    input.type = 'range'; levelInput(input); input.disabled = true;
    if (kind === 'source') input.dataset.channel = ''; else input.dataset.master = '';
    const meter = element('span', 'mm-meter-pair'); meter.setAttribute('role', 'img');
    const tracks = [0, 1].map(() => {
      const track = element('span', 'mm-meter'), fill = element('i'); track.append(fill); meter.append(track); return { track, fill };
    });
    const meterCaption = element('span', 'mm-live-meter-caption'), meterLabel = element('span', 'mm-live-meter-label'), meterStatus = element('span', 'mm-live-meter-status');
    meterCaption.append(meterLabel, meterStatus);
    const pan = element(control?.panCapable && kind === 'source' ? 'button' : 'span', 'mm-pan-button');
    let panReadout;
    if (control?.panCapable && kind === 'source') {
      panReadout = element('span', 'mm-pan-readout'); pan.append(element('span', 'mm-pan-short', 'Pan'), panReadout);
      article.dataset.panBrowse = 'true';
    }
    space.append(scale, input, meter); article.append(head, output, space, pan, meterCaption);
    return { kind, article, name, description, output, space, input, pan, panReadout, meter, tracks, meterCaption, meterLabel, meterStatus, status: statusNode(article, input) };
  }
  function updateMeter(strip, model) {
    if (strip.kind === 'group') return;
    const meter = model.meter || { status: 'missing', channelCount: 1, label: 'Meter', values: [], provenance: '' };
    // State frames may arrive alongside every VU packet. Existing fresh meter
    // fills/text publish only at the session cadence; missing/stale clears once.
    const shape = JSON.stringify([meter.channelCount, meter.label]);
    if (strip.meterShape === shape && strip.meterRevision === meter.revision && (meter.status === 'fresh' || strip.meterState === meter.status)) return;
    strip.meterShape = shape;
    strip.meterRevision = meter.revision; strip.meterState = meter.status;
    strip.meter.dataset.state = meter.status;
    strip.meterLabel.textContent = model.sourceId ? `Source VU${meter.channelCount === 2 ? ' L/R' : ''}` : model.sides?.length === 2 ? `Output VU ${model.sides.map(side => side.auxIndex + 1).join('/')}` : 'Output VU';
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
  function publishDetails() {
    onDetailUpdate([...sourceStrips.values(), ...pinnedStrips.values(), ...overviewStrips.values()].filter(strip => strip.article.parentElement && !strip.article.parentElement.hidden && !(strip.article.parentElement === bank && sends.hidden)).map(strip => detailModels.get(strip.article)));
  }
  function renderMeters(model) {
    for (const [strips, models] of [[overviewStrips, model.mixes], [sourceStrips, model.sources], [pinnedStrips, model.selectedMix ? [model.selectedMix] : []]]) {
      for (const item of models || []) { const strip = strips.get(strips === sourceStrips ? item.sourceId || item.renderKey || item.id : item.id); if (strip) {
        updateMeter(strip, item);
        detailModels.set(strip.article, { ...item, requestedDetail: detailModels.get(strip.article)?.requestedDetail });
      } }
    }
    publishDetails();
  }
  function reconcile(container, strips, models, kind) {
    const key = model => strips === sourceStrips ? model.sourceId || model.renderKey || model.id : model.id;
    const ids = new Set(models.map(key));
    for (const [id, strip] of strips) if (!ids.has(id)) { strip.article.remove();
      // At most ten overview outputs: retain detached keyed nodes across pair/unpair.
      if (strips !== overviewStrips || !models.length) strips.delete(id); }
    for (const [index, model] of models.entries()) {
      let strip = strips.get(key(model));
      if (!strip) { strip = createStrip(model.kind === 'group' ? 'group' : kind); strips.set(key(model), strip); container.append(strip.article); }
      if (container.children[index] !== strip.article) container.insertBefore(strip.article, container.children[index] || null);
      strip.article.dataset.id = model.id;
      const detailButton = strip.article; // detail model key (the strip itself)
      detailModels.set(detailButton, model); strip.article.querySelector('.mm-detail-button')?.setAttribute('aria-label', `Details for ${model.name}`);
      if (model.auxIndex !== undefined) strip.article.style.setProperty('--mm-strip-color', outputColour(model.themeIndex ?? model.auxIndex));
      strip.name.textContent = model.name; strip.description.textContent = model.detail;
      if (strip.kind !== 'group') strip.output.textContent = model.levelText ?? '—';
      strip.article.dataset.unresolved = String(Boolean(model.unresolved));
      if (strip.kind === 'group') {
        strip.name.disabled = false; strip.name.dataset.toggleGroup = model.groupId;
        strip.name.setAttribute('title', `${model.name} · group master`);
        const target = { kind: 'group', groupId: model.groupId, auxIndex: selectedAux };
        const chosen = Boolean(selectedTarget(target)), eligible = Boolean(control && (canEditLevel ? canEditLevel(target) : chosen && control.eligible));
        // F09-S08: "Level unavailable" only when controls are genuinely absent or
        // no member has any finite displayed position, never transiently while a
        // member gesture, live step or own-echo window makes the group briefly
        // non-editable. The session still refuses a group gesture it cannot
        // anchor (begin returns no token), so presentation grants no authority.
        const available = Boolean(control) && unitPosition(model.referencePosition);
        if (strip.input) levelTargets.set(strip.input, target);
        strip.article.dataset.levelSelected = String(chosen);
        strip.article.dataset.unknown = String(!available);
        strip.article.dataset.editable = String(eligible);
        if (strip.select) {
          strip.select.dataset.selectGroupLevel = model.groupId; strip.select.disabled = false;
          strip.select.setAttribute('aria-label', `Select relative level for group ${model.name}`); strip.select.setAttribute('aria-pressed', String(chosen));
          strip.input.dataset.group = model.groupId;
          strip.input.disabled = !(available && !(chosen && control.dispatching));
          strip.input.setAttribute('aria-label', `${model.name} group fader at the loudest member; one common Δ to every member; cap drag or arrow keys; changes are sent live while you drag`);
          const reference = chosen && unitPosition(control?.groupReference) ? control.groupReference : unitPosition(model.referencePosition) ? model.referencePosition : 0;
          if (preview?.input !== strip.input) strip.input.value = scaleText(reference);
          strip.unavailable.hidden = available;
        }
        // The common Δ is in display-scale units: dB above −70 dB; within the
        // short bottom segment it is the same on-screen distance (F09-S08).
        const delta = chosen ? control.gestureActive ? control.previewDelta || 0 : control.lastDelta || 0 : 0;
        const amount = available ? deltaAmount(delta) : '—';
        if (strip.delta.textContent !== amount) strip.delta.textContent = amount;
        strip.output.setAttribute('title', available ? `${deltaText(delta, 2)} (scale units: dB above −70 dB, equal distance below)` : 'Group adjustment unavailable');
        strip.output.setAttribute('aria-label', available ? 'Requested gesture delta; not received group level or hardware balance' : 'Group adjustment unavailable');
        setState(strip, chosen ? control.reason || control.status : model.stateText);
        strip.article.dataset.actionable = String(!available || chosen && (control?.pending || !control?.eligible));
        const diagnostic = JSON.stringify(control?.requestedDiagnostic || []);
        if (chosen && control?.requestedDiagnostic?.length) strip.requestedSignature = diagnostic;
        const inactive = !chosen && control?.requestedDiagnostic?.length && strip.requestedSignature === diagnostic;
        detailModels.set(detailButton, { ...model, requestedDetail: inactive ? `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')} · ${control.status}` : strip.stateFull });
        continue;
      }
      (strip.panReadout || strip.pan).textContent = model.panText ?? 'Pan unavailable';
      if (control?.panCapable && model.sourceId && model.auxIndex !== undefined) { strip.pan.type = 'button'; strip.pan.disabled = false; strip.pan.dataset.openPan = model.sourceId; strip.pan.dataset.panAux = String(model.auxIndex); strip.pan.setAttribute('aria-label', `Inspect normalized AUX pan for ${model.name}`); strip.pan.setAttribute('aria-haspopup', 'dialog'); }
      else if (strip.panReadout) { strip.pan.disabled = true; delete strip.pan.dataset.openPan; delete strip.pan.dataset.panAux; strip.pan.setAttribute('aria-label', 'Pan unavailable for unresolved member'); }
      setState(strip, model.stateText ?? '');
      strip.pan.setAttribute('title', model.panText ?? 'Pan unavailable');
      strip.name.setAttribute('title', model.name);
      const levelTarget = model.sourceId && model.auxIndex !== undefined ? { kind: 'send', auxIndex: model.auxIndex, sourceId: model.sourceId }
        : model.auxIndex !== undefined ? { kind: 'master', auxIndex: model.auxIndex } : null;
      if (levelTarget) { levelTargets.set(strip.name, levelTarget); levelTargets.set(strip.input, levelTarget); }
      levelPeerIds.set(strip.input, model.levelPeerIds);
      const isSelected = levelTarget && selectedTarget(levelTarget);
      strip.article.dataset.levelSelected = String(Boolean(isSelected));
      strip.name.setAttribute('aria-pressed', String(Boolean(isSelected)));
      strip.name.disabled = !model.browsable && !(control && levelTarget);
      if (model.browsable) strip.name.dataset.openAux = String(model.auxIndex); else delete strip.name.dataset.openAux;
      strip.input.setAttribute('aria-label', `${model.name} received level, read-only`);
      const known = typeof model.position === 'number' && Number.isFinite(model.position) && model.position >= 0 && model.position <= 1;
      strip.article.dataset.unknown = String(!known);
      strip.input.disabled = !(control && levelTarget && (canEditLevel ? canEditLevel(levelTarget) : isSelected && control.eligible) && !control.dispatching);
      const requested = (isSelected || isCoordinate(model) && control?.eligible) && typeof control?.requestedValue === 'number';
      // Group live preview: the requested common-delta member value moves this
      // cap; the received level text stays the last actual (echoes follow).
      const groupValue = control?.groupRequested?.find(item => item.sourceId === model.sourceId && item.auxIndex === model.auxIndex)?.value;
      const groupPreview = typeof groupValue === 'number' && !isSelected;
      strip.article.dataset.groupRequested = String(groupPreview);
      // Requested levels are formatted dB (1 decimal); raw positions stay in
      // the title and Details, never in the fixed strip line (F09-S06).
      if (groupPreview) setState(strip, `Last received ${model.levelText ?? '—'} · Group requested ${positionDbText(groupValue)}`, `Last received ${model.levelText ?? '—'} · Group requested ${positionDbText(groupValue)} (raw ${groupValue})`);
      if (requested) setState(strip, `Last received ${model.levelText ?? '—'} · Requested ${positionDbText(control.requestedValue)}`, `Last received ${model.levelText ?? '—'} · Requested ${positionDbText(control.requestedValue)} (raw ${control.requestedValue})`);
      if (isSelected && !control.armed && control.requestedDiagnostic?.length) {
        const text = `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')}`;
        setState(strip, `Last requested (inactive): ${control.requestedDiagnostic.length === 1 ? positionDbText(control.requestedDiagnostic[0].value) : `${control.requestedDiagnostic.length} values`}`, text);
      }
      strip.output.setAttribute('aria-label', `${model.name} last received level${model.actualLevelText ? ': ' + model.actualLevelText : ''}`);
      strip.output.setAttribute('title', model.actualLevelText || model.levelText || 'No received level');
      strip.input.setAttribute('aria-label', `${model.name} ${strip.input.disabled ? 'received level, adjustment unavailable' : 'level preview; cap drag, double track tap or arrow keys; changes are sent live while you drag'}`);
      if (preview?.input !== strip.input) strip.input.value = groupPreview ? scaleText(groupValue) : isCoordinate(model) && !strip.input.disabled && typeof preview?.value === 'number' ? String(preview.value) : requested && unitPosition(control.requestedValue) ? scaleText(control.requestedValue) : known ? scaleText(model.position) : String(FADER_SCALE_MIN);
      strip.article.dataset.actionable = String(strip.input.disabled || isSelected && (control?.pending || !control?.eligible));
      const diagnostic = JSON.stringify(control?.requestedDiagnostic || []);
      if ((isSelected || requested) && control?.requestedDiagnostic?.length) strip.requestedSignature = diagnostic;
      const inactive = !isSelected && control?.requestedDiagnostic?.length && strip.requestedSignature === diagnostic;
      detailModels.set(detailButton, { ...model, requestedDetail: inactive ? `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')} · ${control.status}` : `${strip.stateFull}${isSelected ? ' · ' + control.status : ''}` });
      updateMeter(strip, model);
    }
  }
  function render(model) {
    control = model.control || null; selectedAux = model.selectedAux;
    root.dataset.levelControls = String(Boolean(control));
    if (!control?.gestureActive && preview) { preview = null; gestures.cancel(); }
    const targetLabel = control?.selected ? `${control.selected.kind === 'group' ? `Group ${control.groupName || control.selected.groupId}` : control.selected.kind === 'master' ? 'Master' : control.selected.kind === 'geq' ? 'GEQ' : sourceLabel(control.selected.sourceId)} → AUX ${control.selected.auxIndex + 1}` : 'no selected level';

    $('.mm-mode-label').textContent = control ? `LIVE IEM · ${control.operation === 'pan' ? 'PAN' : control.operation === 'geq' ? 'EQ' : control.panCapable && !control.selected ? 'CONTROLS' : 'LEVELS'} ${control.dispatching ? 'SENDING' : control.eligible || !control.selected && model.connectionPhase === 'live' ? 'READY' : 'WAITING'}` : 'READ-ONLY IEM';
    $('.mm-dirty').textContent = control ? control.status : 'Read-only · no parameter writes';
    $('.mm-dirty').setAttribute('title', control?.status || 'Read-only');
    const terminal = ['error', 'closed', 'timeout', 'blocked', 'unsupported', 'invalid'].includes(model.connectionPhase);
    const terminalMessage = control?.authorized > 0 ? `${model.status} ${control.status}` : model.status;
    $('.mm-feedback').textContent = terminal ? terminalMessage : control ? `${targetLabel}: ${control.pending ? control.status : control.reason || control.status}` : model.status;
    empty.children[0].textContent = terminal ? 'Connection stopped' : 'Waiting for received AUX state';
    empty.children[1].textContent = terminal ? terminalMessage : 'Connect explicitly to your desk. Unknown or unsupported state stays unavailable; Demo is a separate simulation.';
    $('.mm-feedback').setAttribute('title', `${model.status} · ${targetLabel}: ${control?.reason || control?.status || ''}`);
    $('.mm-feedback').setAttribute('aria-label', $('.mm-feedback').textContent);
    $('.mm-desk').textContent = model.connectionPhase ? `${model.modelLabel} · ${model.connectionPhase}` : 'No socket connection';
    const selected = model.selectedAux !== undefined && model.selectedAux !== null;
    root.dataset.auxView = String(selected);
    root.style.setProperty('--mm-mix-color', model.selectedMix ? outputColour(model.selectedMix.themeIndex ?? model.selectedMix.auxIndex) : overviewColour);
    auxSelected = selected;
    $('.mm-local-tabs').hidden = false;
    if ($('.mm-title')) $('.mm-title').textContent = model.selectedMix?.name ?? '';
    if ($('.mm-page-state')) $('.mm-page-state').textContent = selected ? model.view === 'groups' ? model.expandedGroupId ? control ? 'Expanded group · relative Δ controls' : 'Expanded group · level unavailable' : control ? 'Local group masters · relative Δ controls' : 'Local group masters · level unavailable' : control ? 'All observed AUX sources · select a level to edit' : 'All observed AUX sources · read-only' : 'Logical mixes · individual received sides';
    grid.style.setProperty('--mm-overview-count', String(Math.max(1, model.mixes.length)));
    reconcile(grid, overviewStrips, model.mixes, 'master');
    bankModels = model.sources || [];
    reconcile(bank, sourceStrips, bankModels, 'source');
    reconcile(pinned, pinnedStrips, model.selectedMix && model.showAuxMaster !== false ? [model.selectedMix] : [], 'master');
    grid.hidden = selected; sends.hidden = !selected;
    sends.className = `mm-sends-layout${model.expandedGroupId ? ' mm-no-master' : ''}`;
    bank.className = `mm-strip-scroll${model.expandedGroupId ? ' mm-expanded' : ''}`;
    pinned.hidden = Boolean(model.expandedGroupId);
    empty.hidden = selected || model.mixes.length > 0;
    sourceEmpty.hidden = !selected || (model.sources || []).length > 0;
    sourceEmpty.textContent = model.view === 'groups' ? 'No local groups yet. Edit Groups to create one.' : 'No source sends received for this AUX yet.';
    publishDetails();
    renderShortcuts(model, selected);
    bankLayout();
    gestures.prepare();
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (detailButtons.has(button)) { gestures.cancel(); onOpenDetail(detailModels.get(detailButtons.get(button))); return; }
    if (button.dataset.openPan !== undefined) { gestures.cancel(); onOpenPan({ sourceId: button.dataset.openPan, auxIndex: Number(button.dataset.panAux) }); }
    if (button.dataset.openAux !== undefined) { gestures.cancel(); onSelectAux(Number(button.dataset.openAux)); }
    if (control && levelTargets.has(button)) { gestures.cancel(); onSelectLevel(levelTargets.get(button)); }
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
    detailModel(id) {
      for (const strip of [...sourceStrips.values(), ...pinnedStrips.values(), ...overviewStrips.values()]) {
        const model = detailModels.get(strip.article);
        if (model?.id === id) return model;
      }
      return null;
    },
    groupEditing(enabled) {
      groupEditing = enabled;
      root.dataset.groupEditing = String(enabled);
      const button = root.querySelector('[data-action="edit-groups"]');
      if (button) { button.disabled = false; button.title = enabled ? 'Edit groups kept on this device' : 'Local group settings are loading'; }
      $('.mm-local-tabs').hidden = false;
    },
    preferences(preferences) { root.dataset.preferredOrientation = preferences.orientation; root.dataset.showMeters = String(preferences.showMeters); layout.apply(); },
    clear() { gestures.cancel(); render({ status: 'Not connected — no received mixer state', mixes: [] }); },
    destroy() { meterLegend.remove(); root.removeEventListener('click', click); gestures.destroy(); layout.destroy(); stopClock(); },
  };
}
