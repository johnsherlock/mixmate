import { landscapeColumns, channelSlots } from './channel-layout.js';
import { installFaderGestures } from './gestures.js';
import { observeIemLayout } from './layout.js';
import { startLocalClock } from './clock.js';
import { sourceLabel } from './live-provider.js';
import { outputColour, overviewColour } from './theme.js';
import { panDisplayText } from './pan-display.js';
import { NUDGE_UP_DB, NUDGE_DOWN_DB, nextNudgeScale } from './nudge-config.js';
import { mountNudgeView } from './nudge-preview.js';
import { groupDisplayPosition } from './group-navigation.js';
import { FADER_SCALE_KEY_STEP_DB, FADER_SCALE_MIN, FADER_SCALE_POINTER_STEP_DB, FADER_SCALE_TICKS, FADER_SCALE_TOP_DB, positionDbText, positionToScale, scaleTickPercent, scaleToPosition } from './fader-scale.js';

// Provider/mixer strings are always text. Keyed inputs/caps and bank containers
// survive readout changes, preserving touch/scroll position without any writer.
// F09-S07: `?debug` (or any value except 0/false/no/off) shows development-only Details.
export function debugFlag(search = '') {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}
export function mountReadOnlyView(root, { onSelectAux = () => {}, onOverview = () => {}, onToggleGroup = () => {}, onAllGroups = () => {}, onAllChannels = () => {}, onOpenPan = () => {}, onOpenDetail = () => {}, onDetailUpdate = () => {}, onSelectGroupLevel = () => {}, onSelectLevel = () => {}, canEditLevel = null, nudgeUnavailable, onNudgeLevel = () => {}, onToggleLevel = () => {}, onBeginLevel = () => null, onPreviewLevel = (token, value) => value, onCommitLevel = () => {}, onCancelLevel = () => {}, onOpenEq = null, debug = false, onMessage = () => {}, onClearMessage = () => {}, onGestureStart = () => {} } = {}) {
  const $ = selector => root.querySelector(selector), document = root.ownerDocument;
  const content = $('.mm-content');
  let groupRefusal = false, groupEditing = false, auxSelected = false, attentionText = '', gestureWas = false;
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
    if (!['fullscreen', 'overview', 'install', 'dismiss-install', 'native'].includes(button.dataset.action)) button.disabled = true;
  }
  $('.mm-navigation').hidden = false;
  $('.mm-local-tabs').hidden = false;
  $('.mm-snapshot-name').textContent = 'Unavailable';
  $('.mm-dirty').textContent = 'Read-only · no parameter writes';
  $('.mm-rec-state').textContent = 'Recording status unavailable';
  const shortcuts = $('.mm-group-switches'), localTabs = $('.mm-local-tabs'), editButton = $('[data-action="edit-groups"]');
  const shortcutNodes = new Map(), levelTargets = new WeakMap();
  const nudgePreview = mountNudgeView(content, nudgeUnavailable);
  const nudgeButton = element('button', 'mm-open-nudge', 'Nudge');
  nudgeButton.type = 'button';
  nudgeButton.setAttribute('aria-controls', nudgePreview.panel.id);
  let nudgeModel, nudgeContext, faderScroll;
  const pageScroller = () => document.fullscreenElement || document.scrollingElement;

  function closeNudge(restoreFocus = false) {
    if (nudgePreview.panel.hidden) return;
    nudgePreview.panel.hidden = true;
    delete root.dataset.nudgeOpen;
    nudgeContext = undefined;
    nudgePreview.reset();
    if (restoreFocus) {
      bankLayout();
      gestures.sync();
      nudgeButton.focus?.({ preventScroll: true });
      bank.scrollLeft = faderScroll.bankLeft;
      const page = pageScroller();
      if (page) page.scrollTop = faderScroll.pageTop;
    }
    faderScroll = undefined;
  }
  const nudgeKey = model => model.nudgeViewKey ?? JSON.stringify([model.selectedMix.id, model.nudgePreview.profileId, model.nudgePreview.expanded?.id]);

  const nudgeOpen = key => !nudgePreview.panel.hidden && nudgeModel && nudgeContext === key && root.dataset.eqOpen !== 'true';

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
    // With no AUX selected the shortcut row is hidden, so the button returns to its original place after Mix EQ.
    if (!selected && editButton && editButton.parentElement !== localTabs) localTabs.append(editButton);
    // F09-S12: All Groups sits immediately left of All Channels; it is the
    // same navigation as collapsing the expanded group and writes nothing.
    // F09-S13: the existing Create/Edit Group node (never recreated) sits immediately right of All Groups.
    const choices = [
      ...(nudgeModel ? [{ key: 'nudge', node: nudgeButton }] : []),
      ...(model.groups || []).map(group => ({ key: `group:${group.id}`, name: group.name, id: group.id })),
      { key: 'all-groups', name: 'All Groups', mode: 'groups' },
      ...(editButton && selected ? [{ key: 'edit-groups', node: editButton }] : []),
      { key: 'channels', name: 'All Channels', mode: 'channels' },
    ];
    if (!nudgeModel && nudgeButton.parentElement) nudgeButton.remove();
    const keys = new Set(choices.map(choice => choice.key));
    for (const [key, button] of shortcutNodes) if (!keys.has(key)) { button.remove(); shortcutNodes.delete(key); }
    for (const [index, choice] of choices.entries()) {
      if (choice.node) { if (shortcuts.children[index] !== choice.node) shortcuts.insertBefore(choice.node, shortcuts.children[index] || null); continue; }
      let button = shortcutNodes.get(choice.key);
      if (!button) {
        button = element('button', ''); button.type = 'button';
        if (choice.id) button.dataset.toggleGroup = choice.id; else button.dataset.mode = choice.mode;
        shortcutNodes.set(choice.key, button); shortcuts.append(button);
      }
      if (shortcuts.children[index] !== button) shortcuts.insertBefore(button, shortcuts.children[index] || null);
      if (button.textContent !== choice.name) button.textContent = choice.name;
      button.setAttribute('title', choice.name);
      const active = choice.id ? model.view === 'groups' && model.expandedGroupId === choice.id
        : choice.mode === 'groups' ? model.view === 'groups' && !model.expandedGroupId : model.view === 'channels' || model.view === undefined;
      button.className = `${choice.id ? 'mm-group-shortcut' : choice.mode === 'groups' ? 'mm-all-groups' : 'mm-all-channels'}${active ? ' mm-active' : ''}`;
      button.setAttribute('aria-pressed', String(active)); button.disabled = !selected;
    }
    shortcuts.hidden = !selected;
  }
  const faderHandlers = {
    // Accepted prototype shortcut: a double tap on a master cap opens that AUX's
    // GEQ view. It never writes; the tapped cap's own gesture was cancelled.
    onMasterEQ(_, input) { const target = levelTargets.get(input); if (onOpenEq && target?.kind === 'master') onOpenEq(target.auxIndex); },
    onBegin(input) {
      const target = levelTargets.get(input);
      // F09-S08 review: a visible-but-not-yet-editable group cap (member echoes
      // outstanding, another target dispatching) never steals the selection;
      // it says why and starts nothing.
      if (target?.kind === 'group' && canEditLevel && !canEditLevel(target)) {
        groupRefusal = true;
        $('.mm-feedback').textContent = 'Group not editable yet: waiting for the desk to report the last member change. Try again in a moment.';
        $('.mm-feedback').setAttribute('aria-label', $('.mm-feedback').textContent);
        onMessage($('.mm-feedback').textContent);
        return null;
      }
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
  };
  const gestures = installFaderGestures(content, faderHandlers), layout = observeIemLayout(root, () => { bankLayout(); gestures.sync(); }), stopClock = startLocalClock($('.mm-clock'));
  // F09-S12 nudge (user decision 2026-11-22; amounts in nudge-config.js). One
  // press is one deliberate gesture through the same begin/preview/commit path as
  // a cap drag (so every private guard, throttle, own-echo and pair rule applies
  // unchanged): no new message, no repeat on hold, never from a scroll (a click only).
  function nudge(input, up) {
    const refuse = reason => { const text = `Level not changed: ${reason}`; $('.mm-feedback').textContent = text; $('.mm-feedback').setAttribute('aria-label', text); onMessage(text); };
    groupRefusal = false;
    const token = faderHandlers.onBegin(input);
    if (!token) { if (!groupRefusal) refuse(control?.reason || 'not editable right now; try again in a moment.'); return; }
    const next = faderHandlers.onPreview(input, token, nextNudgeScale(Number(input.value), up, groupInputs.has(input)));
    if (next === null) { faderHandlers.onCancel(input, token); refuse(control?.reason || 'the desk guard refused this step.'); return; }
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    faderHandlers.onCommit(input, token);
  }
  const nudgeInputs = new WeakMap();
  function createNudge(input) {
    const box = element('div', 'mm-nudge'), up = element('button', 'mm-nudge-up', '▲'), down = element('button', 'mm-nudge-down', '▼');
    up.type = down.type = 'button'; up.dataset.nudge = 'up'; down.dataset.nudge = 'down'; up.disabled = down.disabled = true;
    nudgeInputs.set(up, input); nudgeInputs.set(down, input); box.append(up, down);
    return { box, up, down };
  }
  function updateNudge(strip, name, enabled, reason) {
    const { up, down } = strip.nudge, why = enabled ? '' : ` (unavailable: ${reason})`;
    for (const [button, text] of [[up, `Raise ${name} by ${NUDGE_UP_DB} dB`], [down, `Lower ${name} by ${NUDGE_DOWN_DB} dB`]]) {
      if (button.disabled === enabled) button.disabled = !enabled;
      button.setAttribute('aria-label', text + why); button.setAttribute('title', text + why);
    }
  }
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
      output.textContent = '—';
      // Full-range group fader on the display scale (F09-S06): the cap starts at
      // the loudest member's displayed level; every member gets the same scale Δ,
      // so all move the same distance (top: loudest at max; bottom: quietest at
      // −∞ since F09-S08; a member already at −∞ allows no downward travel).
      unavailable.setAttribute('aria-label', 'Relative group level unavailable · read-only');
      space.append(scale, unavailable);
      let input, nudgeControls = null;
      if (control) {
        input = element('input', 'mm-vertical'); input.type = 'range'; levelInput(input); input.disabled = true; input.dataset.group = '';
        space.append(input);
      }
      if (control) {
        selection.className = 'mm-group-control-note mm-group-selection';
        selection.setAttribute('title', 'Group master · cap and readout follow the loudest member · one common Δ per gesture · no aggregate level or VU');
        nudgeControls = createNudge(input);
        article.append(head, output, nudgeControls.box, space, selection);
      } else article.append(head, output, space);
      const strip = { kind, article, name, description, output, nudge: nudgeControls, space, input, select, unavailable, status: statusNode(article, input || output) };
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
    let panReadout, panPrefix, panValue;
    if (control?.panCapable && kind === 'source') {
      // F09-S09: "PAN · L 30" / "PAN · CENTRE" / "PAN · R 30" as in the prototype;
      // the prefix is a separate span so ultra-compact strips can drop it.
      const short = element('span', 'mm-pan-short'); panPrefix = element('span', 'mm-pan-prefix', 'Pan'); panValue = element('span', 'mm-pan-amount'); short.append(panPrefix, panValue);
      panReadout = element('span', 'mm-pan-readout'); pan.append(short, panReadout);
      article.dataset.panBrowse = 'true';
    }
    const nudgeControls = createNudge(input);
    space.append(scale, input, meter); article.append(head, output, nudgeControls.box, space, pan, meterCaption);
    return { kind, article, name, description, output, nudge: nudgeControls, space, input, pan, panReadout, panPrefix, panValue, meter, tracks, meterCaption, meterLabel, meterStatus, status: statusNode(article, input) };
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
        const shown = groupDisplayPosition(model.groupId, selectedAux, model.referencePosition, control);
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
          if (preview?.input !== strip.input) strip.input.value = scaleText(unitPosition(shown) ? shown : 0);
          strip.unavailable.hidden = available;
        }
        // F09-S12 (user decision 2026-11-22): the readout is the loudest member's
        // displayed level (where the cap sits): received, or this owner's requested
        // common-delta preview while its gesture/echoes are live. It is not a
        // received group level or a hardware balance claim; "—" when unknown.
        const amount = available ? positionDbText(shown) : '—';
        if (strip.output.textContent !== amount) strip.output.textContent = amount;
        strip.output.setAttribute('title', available ? `Loudest member of ${model.name} (cap position); one common Δ moves every member` : 'Group level unavailable');
        strip.output.setAttribute('aria-label', available ? `Loudest member of group ${model.name}: ${amount}; not a received group level or hardware balance` : 'Group level unavailable');
        if (strip.nudge) updateNudge(strip, model.name, strip.input?.disabled === false, available ? control?.reason || 'Not editable right now' : 'Group level unavailable');
        setState(strip, chosen ? control.reason || control.status : model.stateText);
        strip.article.dataset.actionable = String(!available || chosen && (control?.pending || !control?.eligible));
        const diagnostic = JSON.stringify(control?.requestedDiagnostic || []);
        if (chosen && control?.requestedDiagnostic?.length) strip.requestedSignature = diagnostic;
        const inactive = !chosen && control?.requestedDiagnostic?.length && strip.requestedSignature === diagnostic;
        detailModels.set(detailButton, { ...model, requestedDetail: inactive ? `Last requested (inactive): ${control.requestedDiagnostic.map(item => `${item.path}=${item.value}`).join(', ')} · ${control.status}` : strip.stateFull });
        continue;
      }
      (strip.panReadout || strip.pan).textContent = model.panText ?? 'Pan unavailable';
      if (strip.panValue) {
        // This owner's requested pan while its gesture or own echoes are live,
        // else the shared received value; unknown/unequal shows just "Pan".
        const own = control?.selected?.kind === 'pan' && control.selected.sourceId === model.sourceId && control.selected.auxIndex === model.auxIndex
          && (typeof control.previewPan === 'number' || control.pending && typeof control.requestedValue === 'number');
        const label = panDisplayText(own ? control.previewPan ?? control.requestedValue : model.panWire);
        const prefix = label ? 'PAN · ' : 'Pan', amount = label ?? '';
        if (strip.panPrefix.textContent !== prefix) strip.panPrefix.textContent = prefix;
        if (strip.panValue.textContent !== amount) strip.panValue.textContent = amount;
        strip.pan.dataset.panRequested = String(own);
        strip.pan.dataset.panKnown = String(Boolean(label));
      }
      if (control?.panCapable && model.sourceId && model.auxIndex !== undefined) { strip.pan.type = 'button'; strip.pan.disabled = false; strip.pan.dataset.openPan = model.sourceId; strip.pan.dataset.panAux = String(model.auxIndex); strip.pan.setAttribute('aria-label', `AUX send pan for ${model.name}: ${strip.panValue?.textContent || 'unknown'}; opens the pan dialog`); strip.pan.setAttribute('aria-haspopup', 'dialog'); }
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
      // F09-S12: a channel/master nudge needs the same editability plus a known level to step from.
      updateNudge(strip, model.name, !strip.input.disabled && (known || requested || groupPreview), !control ? 'Not connected' : !known ? 'No received level' : control.reason || 'Not editable right now');
      strip.article.dataset.fx = String(Boolean(model.sourceId?.startsWith('f.')));
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
    // F09-S11: only an interrupted/cancelled/native-changed outcome reaches the footer slot; routine status stays in Diagnostics.
    // The session classifies by state transition (a stopped gesture or pending send); this view only displays it.
    const attention = control && !control.gestureActive && typeof control.attention === 'string' ? control.attention : '';
    if (control?.gestureActive && !gestureWas) onGestureStart();
    gestureWas = Boolean(control?.gestureActive);
    if (attention !== attentionText) { const previous = attentionText; attentionText = attention; if (attention) onMessage(attention); else onClearMessage(previous); }
    const selected = model.selectedAux !== undefined && model.selectedAux !== null;
    nudgeModel = selected && model.view === 'groups' && model.selectedMix && model.nudgePreview ? model : null;
    if (!nudgeModel || nudgeContext !== nudgeKey(nudgeModel)) closeNudge();
    else nudgePreview.render(nudgeModel);
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
    sourceEmpty.textContent = model.view === 'groups' ? 'No local groups yet. Create Group to add one.' : 'No source sends received for this AUX yet.';
    publishDetails();
    renderShortcuts(model, selected);
    renderEditLabel(model, selected);
    bankLayout();
    gestures.prepare();
  }
  // F09-S12: "Create Group" opens the editor on a new group; with a group expanded
  // the same button reads "Edit Group" and opens that group.
  function renderEditLabel(model, selected) {
    const button = $('[data-action="edit-groups"]');
    if (!button) return;
    const expanded = selected ? (model.groups || []).find(group => group.id === model.expandedGroupId) : null;
    const text = expanded ? 'Edit Group' : 'Create Group', label = expanded ? `Edit group ${expanded.name}` : 'Create a new group';
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-label', label); button.dataset.groupAction = expanded ? 'edit' : 'create';
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button === nudgeButton && nudgeModel && nudgePreview.panel.hidden && root.dataset.eqOpen !== 'true') {
      gestures.cancel();
      if (!nudgeModel) return;
      nudgeContext = nudgeKey(nudgeModel);
      const page = pageScroller();
      faderScroll = { bankLeft: bank.scrollLeft, pageTop: page?.scrollTop ?? 0 };
      nudgePreview.render(nudgeModel);
      root.dataset.nudgeOpen = 'true';
      nudgePreview.panel.hidden = false;
      nudgePreview.back.focus?.({ preventScroll: true });
      if (page) page.scrollTop = 0;
      return;
    }
    if (button === nudgePreview.back) { closeNudge(true); return; }
    if (swallow.has(button)) { swallow.delete(button); event.preventDefault?.(); return; }
    const target = nudgePreview.target(button);
    if (target) {
      if (nudgeOpen(nudgeContext)) {
        onNudgeLevel(target, nudgeContext, button.dataset.nudge === 'up');
      }
      return;
    }
    if (detailButtons.has(button)) { gestures.cancel(); onOpenDetail(detailModels.get(detailButtons.get(button))); return; }
    if (button.dataset.openPan !== undefined) { gestures.cancel(); onOpenPan({ sourceId: button.dataset.openPan, auxIndex: Number(button.dataset.panAux) }); }
    if (button.dataset.openAux !== undefined) { gestures.cancel(); onSelectAux(Number(button.dataset.openAux)); }
    if (control && levelTargets.has(button)) { gestures.cancel(); onSelectLevel(levelTargets.get(button)); }
    if (button.dataset.selectGroupLevel !== undefined) { gestures.cancel(); onSelectGroupLevel(button.dataset.selectGroupLevel); }
    if (button.dataset.toggleGroup !== undefined) { gestures.cancel(); onToggleGroup(button.dataset.toggleGroup); }
    if (button.dataset.mode === 'channels') { gestures.cancel(); onAllChannels(); }
    if (button.dataset.mode === 'groups') { gestures.cancel(); onAllGroups(); }
    if (button.dataset.nudge !== undefined && nudgeInputs.has(button)) { gestures.cancel(); nudge(nudgeInputs.get(button), button.dataset.nudge === 'up'); }
    if (button.dataset.action === 'overview') { gestures.cancel(); onOverview(); }
    if (button.dataset.action === 'fullscreen') {
      const app = $('.mm-app');
      try {
        const promise = document.fullscreenElement ? document.exitFullscreen?.() : app.requestFullscreen?.();
        promise?.catch(() => { $('.mm-feedback').textContent = 'Fullscreen unavailable; use the installed app.'; onMessage('Fullscreen unavailable; use the installed app.'); });
      } catch { $('.mm-feedback').textContent = 'Fullscreen unavailable; use the installed app.'; onMessage('Fullscreen unavailable; use the installed app.'); }
    }
  }
  // Holding Enter/Space on a nudge button must never stack gestures: ignore keyboard
  // auto-repeat, and swallow the click a Space release would fire after a held repeat.
  const repeated = new WeakSet();
  function keydown(event) {
    if (event.key === 'Escape' && !nudgePreview.panel.hidden && nudgePreview.panel.contains(event.target)) {
      event.preventDefault();
      closeNudge(true);
      return;
    }
    const button = event.target?.closest?.('button');
    if (!button || button.dataset.nudge === undefined) return;
    if (event.repeat) { event.preventDefault(); repeated.add(button); }
  }
  function keyup(event) {
    const button = event.target?.closest?.('button');
    if (button && repeated.has(button)) { repeated.delete(button); if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') { event.preventDefault(); swallow.add(button); } }
  }
  const swallow = new WeakSet();
  root.addEventListener('keydown', keydown); root.addEventListener('keyup', keyup);
  root.addEventListener('click', click);
  return {
    render, renderMeters, nudgeOpen,
    detailModel(id) {
      for (const strip of [...sourceStrips.values(), ...pinnedStrips.values(), ...overviewStrips.values()]) {
        const model = detailModels.get(strip.article);
        if (model?.id === id) return model;
      }
      return null;
    },
    groupEditing(enabled, reason = '') {
      groupEditing = enabled;
      root.dataset.groupEditing = String(enabled);
      const button = root.querySelector('[data-action="edit-groups"]');
      if (button) { button.disabled = false; button.title = enabled ? (button.dataset.groupAction === 'edit' ? 'Edit this group; kept on this device' : 'Create a group for this snapshot, kept on this device') : reason || 'Local group settings are loading'; }
      $('.mm-local-tabs').hidden = false;
    },
    // F02-S05: the desk's received current snapshot name, as text only.
    snapshotName(text) {
      for (const node of root.querySelectorAll('.mm-snapshot-name, .mm-native-snapshot')) if (node.textContent !== text) node.textContent = text;
    },
    preferences(preferences) { root.dataset.preferredOrientation = preferences.orientation; root.dataset.showMeters = String(preferences.showMeters); layout.apply(); },
    clear() { gestures.cancel(); render({ status: 'Not connected — no received mixer state', mixes: [] }); },
    destroy() { closeNudge(); nudgePreview.panel.remove(); nudgeButton.remove(); meterLegend.remove(); root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); root.removeEventListener('keyup', keyup); gestures.destroy(); layout.destroy(); stopClock(); },
  };
}
