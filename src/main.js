import './style.css';
import { faderValueToDB } from 'soundcraft-ui-connection';
import { ReadOnlyConnection } from './protocol.js';

const $ = id => document.getElementById(id);
let state = Object.create(null);
let lastUpdate = null;
let connectionStatus = 'idle';
let offlineReady = false;
const logs = [];
function log(message) {
  logs.push(`${new Date().toISOString()} ${message}`);
  if (logs.length > 35) logs.shift();
  $('diagnostics').textContent = [`Mixmate 0.1.0`, navigator.userAgent, `Origin: ${location.origin}`, `Secure context: ${window.isSecureContext}`, ...logs].join('\n');
}
for (let n = 1; n <= 24; n++) $('channel').add(new Option(`Channel ${String(n).padStart(2, '0')}`, n));
try { $('address').value = localStorage.getItem('mixmate-address') || '192.168.0.60'; } catch { /* Storage is optional. */ }

const statuses = {
  connecting: ['Connecting to your desk…', 'Allow local network access if asked. Waiting up to 15 seconds for mixer state.'],
  connected: ['Socket connected', 'The connection is open. Waiting for channel state from the mixer.'],
  live: ['Live state received', 'Connected to your desk. This view follows changes from the original UI.'],
  blocked: ['Browser blocked the connection', 'This browser may block the mixer’s unencrypted local connection. Installation does not bypass that restriction.'],
  timeout: ['No channel state received', 'Check the mixer IP and desk Wi-Fi. The browser may also block local connections. You can retry safely.'],
  error: ['Couldn’t reach the desk', 'Check desk Wi-Fi, mixer IP and local network permission. Browser security can also block this connection.'],
  closed: ['Connection lost', 'Displayed values are no longer live. Check desk Wi-Fi, then reconnect.'],
  disconnected: ['Disconnected', 'Your mixer stays as it is. Connect again whenever you’re ready.'],
};
function setStatus(status, detail) {
  connectionStatus = status;
  const [title, description] = statuses[status];
  $('status-title').textContent = title;
  $('status-detail').textContent = description;
  $('status-dot').dataset.status = status;
  const active = ['connecting', 'connected', 'live'].includes(status);
  $('connect').disabled = active;
  $('disconnect').disabled = !active;
  $('address').disabled = active;
  if (!active) state = Object.create(null);
  renderChannel();
  log(`${status}${detail ? `: ${detail}` : ''}`);
}
function renderChannel() {
  const number = Number($('channel').value);
  const prefix = `i.${number - 1}.`;
  const live = connectionStatus === 'live';
  const name = live ? state[`${prefix}name`] : undefined;
  const mix = live ? state[`${prefix}mix`] : undefined;
  const mute = live ? state[`${prefix}mute`] : undefined;
  $('channel-number').textContent = `CH ${String(number).padStart(2, '0')}`;
  $('channel-name').textContent = name || (live ? `Channel ${number}` : 'Waiting for a name');
  $('mute').textContent = mute === undefined ? 'MUTE —' : mute === 1 ? 'MUTED' : 'UNMUTED';
  $('mute').dataset.muted = String(mute === 1);
  $('channel-display').dataset.stale = String(!live || mix === undefined);
  const db = mix === undefined ? undefined : faderValueToDB(mix);
  $('fader').textContent = db === undefined ? '—' : db === -Infinity ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
  const percent = mix === undefined ? 0 : mix * 100;
  $('fader-fill').style.width = `${percent}%`;
  $('fader-cap').style.left = `${percent}%`;
  document.querySelector('.fader-track').setAttribute('aria-label', mix === undefined ? 'Fader position, unavailable' : `Fader position ${Math.round(percent)} percent`);
}
let renderPending = false;
const connection = new ReadOnlyConnection({
  onStatus: setStatus,
  onUpdates: updates => {
    for (const [key, value] of updates) state[key] = value;
    lastUpdate = Date.now();
    if (!renderPending) {
      renderPending = true;
      requestAnimationFrame(() => { renderPending = false; renderChannel(); });
    }
  },
});
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  $('address').setCustomValidity('');
  state = Object.create(null);
  lastUpdate = null;
  try {
    connection.connect($('address').value);
    try { localStorage.setItem('mixmate-address', $('address').value.trim()); } catch { /* Optional. */ }
  } catch (error) {
    $('address').setCustomValidity(error.message);
    $('address').reportValidity();
  }
});
$('address').addEventListener('input', () => $('address').setCustomValidity(''));
$('disconnect').addEventListener('click', () => { connection.disconnect(); setStatus('disconnected'); });
$('channel').addEventListener('change', renderChannel);
window.addEventListener('pagehide', () => { connection.disconnect(); setStatus('disconnected'); });
setInterval(() => {
  $('last-seen').textContent = connectionStatus === 'live' && lastUpdate
    ? `State update ${Math.floor((Date.now() - lastUpdate) / 1000)}s ago` : 'Waiting for live state';
}, 1000);
$('copy-diagnostics').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('diagnostics').textContent);
    $('copy-result').textContent = 'Diagnostics copied. Review before sharing; they include device and connection details.';
  } catch { $('copy-result').textContent = 'Copy unavailable. Select the diagnostic text below instead.'; }
});
let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event;
  if (offlineReady) $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('install').hidden = true; }
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; log('App installed'); });
function showOfflineStatus(ready, message) {
  offlineReady = ready;
  $('offline-status').textContent = ready ? 'Saved for offline use' : 'Offline copy not ready';
  $('offline-detail').textContent = message;
  $('offline-icon').textContent = ready ? '✓' : '!';
  $('install').hidden = !ready || !installPrompt;
  log(ready ? 'Offline cache verified' : message);
}
async function prepareOffline() {
  if (!('serviceWorker' in navigator)) {
    showOfflineStatus(false, 'This browser does not support offline saving. Try a current Chrome or Safari.'); return;
  }
  try {
    // Wait for verified precaching, not merely for registration or an old worker.
    await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './' });
    await navigator.serviceWorker.ready;
    const controller = navigator.serviceWorker.controller;
    if (!controller) { showOfflineStatus(false, 'Offline worker is starting. Reopen or reload this app while online.'); return; }
    const result = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Offline cache verification timed out.')); }, 8000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timeout); channel.port1.close(); resolve(data); };
      controller.postMessage({ type: 'VERIFY_OFFLINE' }, [channel.port2]);
    });
    showOfflineStatus(result.ready, result.ready ? 'App files are on this device. No internet needed to open it.' : 'Some app files are missing. Reopen online to prepare a complete copy.');
  } catch (error) { showOfflineStatus(false, `Open online to save the app. ${error.message}`); }
}
navigator.serviceWorker?.addEventListener('controllerchange', prepareOffline);
log('App opened. No mixer connection started.');
renderChannel();
prepareOffline();
