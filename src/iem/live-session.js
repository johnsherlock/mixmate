import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';

// Private capability: no socket, generic sender, write method or queue escapes.
export function createReadOnlySession({ WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000 } = {}) {
  const provider = createLiveProvider(), listeners = new Set();
  let socket = null, generation = 0, deadline, keepalive, idle;
  let phase = 'idle', detail = 'Not connected — no received mixer state';
  const snapshot = () => ({ phase, detail, observations: provider.snapshot() });
  const emit = () => { for (const listener of listeners) listener(snapshot()); };
  const clearTimers = () => { timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearInterval(keepalive); };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    clearTimers();
    const old = socket;
    socket = null;
    provider.clear();
    phase = next; detail = message;
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try { old.close(); } catch { /* Already invalidated; never retry close or writes. */ }
    }
    emit();
  }
  function connect(address) {
    stop('idle', 'Starting an explicit connection');
    let url;
    try { url = mixerURL(address); }
    catch (error) { phase = 'invalid'; detail = error.message; emit(); return false; }
    const token = generation;
    phase = 'connecting'; detail = 'Connecting — waiting for socket and received Ui24 AUX state'; emit();
    if (generation !== token) return false;
    let current;
    try { current = new WebSocketClass(url); }
    catch { stop('blocked', 'The browser could not open the local mixer socket'); return false; }
    socket = current;
    const active = () => generation === token && socket === current;
    const failSend = () => stop('error', 'Connection send failed — received state cleared');
    const touch = () => {
      timers.clearTimeout(idle);
      idle = timers.setTimeout(() => { if (active()) stop('timeout', 'Mixer socket became silent — reconnect explicitly'); }, idleMs);
    };
    deadline = timers.setTimeout(() => { if (active()) stop('timeout', 'No verified Ui24 AUX level received in time — reconnect explicitly'); }, timeoutMs);
    current.onopen = () => {
      if (!active()) return;
      if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
      phase = 'connected'; detail = 'Socket connected — waiting for received Ui24 model and AUX state'; emit();
      if (!active() || current.readyState !== 1) return;
      try { current.send('3:::INIT'); } catch { failSend(); return; }
      if (!active()) return;
      touch();
      keepalive = timers.setInterval(() => {
        if (!active()) return;
        if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
        try { current.send('3:::ALIVE'); } catch { failSend(); }
      }, 1000);
    };
    current.onmessage = ({ data }) => {
      if (!active()) return;
      if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
      if (typeof data !== 'string') return;
      touch();
      if (data === '2::') {
        try { current.send('2::'); } catch { failSend(); }
        return;
      }
      if (!provider.receive(data)) return;
      const model = provider.model();
      if (model !== undefined && model !== 'ui24') { stop('unsupported', `Unsupported mixer model ${model} — Ui24 state is required`); return; }
      if (provider.hasAuxLevel()) {
        timers.clearTimeout(deadline);
        phase = 'live'; detail = 'Received Ui24 AUX state · read-only';
      } else {
        phase = 'partial'; detail = model === 'ui24' ? 'Ui24 model received — partial AUX state; unknown fields remain unavailable' : 'Received observations — mixer model not verified';
      }
      emit();
    };
    current.onerror = () => { if (active()) stop('error', 'Mixer connection failed — reconnect explicitly'); };
    current.onclose = () => { if (active()) stop('closed', 'Mixer connection closed — received state cleared'); };
    return true;
  }
  return Object.freeze({
    connect,
    disconnect: () => stop(),
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}
