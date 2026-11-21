import { restoreDialogFocus } from './dialog-owner.js';
import { buildInfo } from '../build-info.js';

export const DIAGNOSTICS_LOG_LIMIT = 30;
export const MESSAGE_TTL_MS = 8000;
const pad = value => String(value).padStart(2, '0');
export const clockText = date => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

// F09-S11 (user decision 2026-11-21): the live entry's footer message slot and
// the Diagnostics modal. Every string (including mixer/user strings read from
// the hidden status sink) is written with textContent only. Nothing here sends
// anything, persists anything or owns a socket: the live controller wires the
// Connect/Disconnect controls to the same explicit paths as the Connect dialog.
export function createDiagnostics(root, { dialogOwner, info = buildInfo(), now = () => new Date(), levels = true, pan = true, timers = globalThis } = {}) {
  const document = root.ownerDocument, $ = selector => root.querySelector(selector);
  const make = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node; };
  const view = make('div', 'mm-diag');
  const section = title => { const node = make('section', 'mm-diag-section'); node.append(make('h4', '', title)); view.append(node); return node; };
  const row = (parent, label) => { const line = make('div', 'mm-diag-row'), value = make('span', 'mm-diag-value'); line.append(make('span', 'mm-diag-label', label), value); parent.append(line); return value; };
  const sinkText = selector => $(selector)?.textContent || '';

  const build = section('Build'), version = row(build, 'Version'), commit = row(build, 'Commit'), built = row(build, 'Built (UTC)'), offline = row(build, 'Offline');
  // F07-S05: update state and install state; the optional button re-shows a dismissed install prompt.
  const updateRow = row(build, 'Update'), installRow = row(build, 'Install'), reshow = make('button', '', 'Show install prompt');
  reshow.type = 'button'; reshow.hidden = true; build.append(reshow); updateRow.textContent = 'No update waiting'; installRow.textContent = 'Unknown';
  let onReshow = () => {}; const reshowClick = () => onReshow(); reshow.addEventListener('click', reshowClick);
  version.textContent = `v${info.version}`; commit.textContent = info.commit; built.textContent = info.time; offline.textContent = 'Offline copy not verified';

  const connection = section('Connection');
  const form = make('form', 'mm-diag-connection'), address = make('input'), label = make('label', '', 'Mixer private IPv4 address');
  address.required = true; address.autocomplete = 'off'; address.spellcheck = false; address.setAttribute('inputmode', 'decimal'); address.setAttribute('list', 'iem-diag-known-addresses');
  address.setAttribute('aria-label', 'Mixer private IPv4 address');
  const known = make('datalist'); known.id = 'iem-diag-known-addresses';
  const connect = make('button', '', levels ? 'Connect live IEM' : 'Connect read-only'), disconnect = make('button', '', 'Disconnect');
  connect.type = 'submit'; disconnect.type = 'button'; disconnect.disabled = true;
  const actions = make('div', 'mm-dialog-actions'); actions.append(connect, disconnect);
  label.append(address); form.append(label, known, actions); connection.append(form);
  const status = row(connection, 'Status'), connected = row(connection, 'Address'), session = row(connection, 'Session');
  const auto = row(connection, 'Automatic'), attempts = make('ul', 'mm-diag-list'); connection.append(attempts);
  status.textContent = 'Not connected'; connected.textContent = 'none'; session.textContent = 'No received mixer state'; auto.textContent = 'No automatic pass yet';

  const desk = section('Desk and state');
  const mode = row(desk, 'Mode'), snapshot = row(desk, 'Snapshot'), rig = row(desk, 'Groups rig'), control = row(desk, 'Controls'), recording = row(desk, 'Recording'), page = row(desk, 'Page'), feedback = row(desk, 'Latest feedback');

  // F07-S02: received snapshot state and the last snapshot operation (text only).
  const snapshots = section('Snapshots');
  const snapshotRows = { show: row(snapshots, 'Show'), current: row(snapshots, 'Current'), list: row(snapshots, 'List'), operation: row(snapshots, 'Last operation'), lock: row(snapshots, 'Lock') };
  const emptySnapshots = { show: 'unavailable', current: 'unavailable', list: 'unavailable', operation: 'none', lock: 'unavailable' };

  const recent = section('Recent messages'), log = make('ol', 'mm-diag-list mm-diag-log'); recent.append(log);

  const settingsSection = section('Settings'), settings = make('p', '', 'Checking local settings storage…');
  settings.setAttribute('role', 'status');
  const notes = [
    levels ? pan ? 'Known compatible levels and normalized pan are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Known compatible levels are editable after connecting. Drag or use keys; changes are sent live while you drag (throttled).' : 'Only received state is shown. No mixer parameter writes.',
    'Groups are kept on this device for each desk snapshot name and work offline. Addresses that connect are remembered and tried automatically when the app opens or wakes.',
  ].map(text => make('p', 'mm-caption', text));
  settingsSection.append(settings, ...notes);

  const linksSection = section('Links'), nav = make('nav', 'mm-diag-links');
  nav.setAttribute('aria-label', 'Other MixMate pages');
  const demo = make('a', '', 'Demo'), test = make('a', '', 'Settings / test');
  demo.href = './demo.html'; test.href = './connection-test.html'; test.title = 'Settings and connection test';
  nav.append(demo, test); linksSection.append(nav);

  const entries = []; let state = { auto: null, rig: '', status: null, connected: '', note: '', snapshots: emptySnapshots };
  const messageNode = () => $('.mm-message');
  let transient = '', lasting = '', transientTimer;
  const paintSlot = () => { const node = messageNode(), value = transient || lasting; if (node) { node.textContent = value; node.setAttribute('title', value); } };
  const paintLog = () => log.replaceChildren(...[...entries].reverse().map(entry => make('li', '', `${entry.time} ${entry.text}`)));
  const paint = () => {
    offline.textContent = sinkText('.mm-offline-state') || 'Offline copy not verified';
    mode.textContent = sinkText('.mm-mode-label') || 'Unavailable';
    snapshot.textContent = sinkText('.mm-snapshot-name') || 'Unavailable';
    rig.textContent = state.rig || 'No rig';
    control.textContent = sinkText('.mm-dirty') || 'Unavailable';
    recording.textContent = sinkText('.mm-rec-state') || 'Recording status unavailable';
    page.textContent = sinkText('.mm-page-state') || 'Unavailable';
    feedback.textContent = sinkText('.mm-feedback') || 'None';
    status.textContent = state.status?.text || 'Not connected'; connected.textContent = state.connected || 'none';
    const pass = state.auto;
    auto.textContent = pass ? `${pass.reason} pass · ${pass.outcome}` : 'No automatic pass yet';
    attempts.replaceChildren(...(pass?.attempts || []).map(item => make('li', '', `${item.address} — ${item.result}`)));
    for (const [key, node] of Object.entries(snapshotRows)) node.textContent = state.snapshots[key];
    paintLog();
  };

  let lease = null, focusBefore, clean = () => {};
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button'), title = $('#mm-dialog-title');
  function close(token, reason = {}) {
    if (lease !== token) return;
    lease = null; clean(); dialog?.classList?.remove('mm-diag-dialog'); dialogOwner?.release(token);
    if (!dialogOwner?.active()) layer.hidden = true;
    if (!reason.replaced && !dialogOwner?.active()) restoreDialogFocus(focusBefore);
  }
  function show() {
    if (lease && dialogOwner?.owns(lease)) return true;
    const token = dialogOwner ? dialogOwner.claim('diagnostics', reason => close(token, reason)) : Symbol('diagnostics');
    if (!token) return false;
    lease = token; focusBefore = document.activeElement;
    dialog.classList.remove('mm-group-dialog', 'mm-pan-dialog'); dialog.classList.add('mm-diag-dialog');
    title.textContent = 'Diagnostics'; body.replaceChildren(view); layer.hidden = false; paint();
    const click = event => { if (!dialogOwner || dialogOwner.owns(token)) { event.stopImmediatePropagation?.(); close(token); } };
    const key = event => { if (event.key === 'Escape' && (!dialogOwner || dialogOwner.owns(token))) { event.preventDefault(); event.stopImmediatePropagation?.(); close(token); } };
    // Per-opening closures cannot close a replacement owner.
    clean = () => { closeButton.removeEventListener('click', click); root.removeEventListener('keydown', key); };
    closeButton.addEventListener('click', click); root.addEventListener('keydown', key);
    closeButton.focus();
    return true;
  }
  const visible = () => Boolean(lease && (!dialogOwner || dialogOwner.owns(lease)));
  const refresh = () => { if (visible()) paint(); };
  const opener = $('.mm-diagnostics-open');
  opener?.setAttribute?.('title', `Diagnostics — MixMate v${info.version} (${info.commit})`);
  if (opener) opener.disabled = false; // The live view disables every button present at mount; this one is always available.
  const onOpen = () => show();
  opener?.addEventListener('click', onOpen);
  const api = {
    form, address, connect, disconnect, settings, note: session, links: [demo, test], show, visible, refresh, close: () => { if (lease) close(lease); },
    knownAddresses(addresses) { known.replaceChildren(...addresses.map(value => { const option = make('option'); option.value = value; return option; })); },
    // The connection controls mirror the Connect dialog's: Connect while idle, Disconnect while active.
    connected(active) { connect.disabled = active; disconnect.disabled = !active; },
    // Footer connection status button and the Connection section.
    status(value) {
      state = { ...state, status: value, connected: value.state === 'connected' ? value.address || '' : '' };
      const desk = $('.mm-desk');
      if (desk) { desk.textContent = value.text; desk.dataset.state = value.state; desk.setAttribute?.('title', value.title || value.text); }
      refresh();
    },
    updates(text) { updateRow.textContent = String(text || 'No update waiting'); refresh(); },
    install(value, onShow) { installRow.textContent = String(value?.text || 'Unknown'); reshow.hidden = !value?.canShow; if (onShow) onReshow = onShow; refresh(); },
    rig(text) { if (state.rig !== text) { state = { ...state, rig: text }; refresh(); } },
    // Snapshot rows: plain strings built by the snapshot controls from received state.
    snapshots(value) { state = { ...state, snapshots: value ? Object.fromEntries(Object.keys(emptySnapshots).map(key => [key, String(value[key] ?? emptySnapshots[key])])) : emptySnapshots }; refresh(); },
    autoPass(pass) { state = { ...state, auto: pass ? { ...pass, attempts: pass.attempts.map(item => ({ ...item })) } : null }; refresh(); },
    // Footer message slot: only actionable feedback. A transient message clears
    // after MESSAGE_TTL_MS or at the next deliberate gesture; a lasting condition
    // (temporary view, groups unavailable) shows while it holds and while no
    // transient message is showing. Full text stays in the title.
    message(text) {
      const value = String(text || '');
      timers.clearTimeout(transientTimer); transientTimer = undefined; transient = value;
      if (value) { api.log(value); transientTimer = timers.setTimeout(() => { transientTimer = undefined; transient = ''; paintSlot(); }, MESSAGE_TTL_MS); transientTimer?.unref?.(); }
      paintSlot();
    },
    clearMessage() { timers.clearTimeout(transientTimer); transientTimer = undefined; transient = ''; paintSlot(); },
    condition(text) { const value = String(text || ''); if (value === lasting) return; lasting = value; if (value) api.log(value); paintSlot(); },
    currentMessage: () => transient || lasting,
    transientMessage: () => transient,
    // Bounded, in-memory only (never persisted).
    log(text) {
      const value = String(text || '').trim();
      if (!value || entries.at(-1)?.text === value) return;
      entries.push({ time: clockText(now()), text: value });
      while (entries.length > DIAGNOSTICS_LOG_LIMIT) entries.shift();
      refresh();
    },
    entries: () => entries.map(entry => ({ ...entry })),
    destroy() { timers.clearTimeout(transientTimer); reshow.removeEventListener('click', reshowClick); opener?.removeEventListener('click', onOpen); if (lease) close(lease); },
  };
  return api;
}
