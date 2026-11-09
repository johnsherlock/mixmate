import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS } from './protocol.js';

// Private capability: no socket, generic sender, write method or queue escapes.
export function createReadOnlySession({ WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000, meterTtlMs = 2000, meterCadenceMs = 100,
  now = () => globalThis.performance?.now() ?? Date.now(), wallNow = () => Date.now(), clockGraceMs = 1000 } = {}) {
  const provider = createLiveProvider(), listeners = new Set();
  let socket = null, generation = 0, deadline, keepalive, idle, meterExpiry, meterFlush;
  let meters = new Map(), meterStamp = null, meterRevision = 0, inspectCurrent = () => {};
  const stamp = () => ({ mono: now(), wall: wallNow() });
  const elapsed = (before, after = stamp()) => ({ mono: after.mono - before.mono, wall: after.wall - before.wall });
  const invalidClock = age => !Number.isFinite(age.mono) || !Number.isFinite(age.wall) || age.mono < 0 || age.wall < -clockGraceMs;
  function meterState() {
    if (!meterStamp) return 'missing';
    const age = elapsed(meterStamp);
    return invalidClock(age) || Math.max(age.mono, age.wall) >= meterTtlMs ? 'stale' : 'fresh';
  }
  let phase = 'idle', detail = 'Not connected — no received mixer state';
  const snapshot = () => {
    if (socket) inspectCurrent(); // A read after sleep cannot resurrect old state before timers run.
    return { phase, detail, observations: provider.snapshot(), meterState: meterState(), meters: new Map(meters), meterRevision };
  };
  const emit = (kind = 'state') => { for (const listener of listeners) listener(snapshot(), kind); };
  const clearTimers = () => { timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearInterval(keepalive); timers.clearTimeout(meterExpiry); timers.clearTimeout(meterFlush); meterFlush = undefined; };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    clearTimers();
    const old = socket;
    socket = null;
    provider.clear(); meters = new Map(); meterStamp = null; meterRevision = 0;
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
    const started = stamp();
    let lastActivity = started, qualified = false;
    function responsive() {
      if (!active()) return false;
      const currentTime = stamp(), age = elapsed(lastActivity, currentTime), initial = elapsed(started, currentTime);
      if (invalidClock(age) || age.mono >= idleMs || age.wall > idleMs + clockGraceMs ||
          (!qualified && (invalidClock(initial) || initial.mono >= timeoutMs || initial.wall > timeoutMs + clockGraceMs))) {
        stop('timeout', 'Session elapsed or clock changed — state cleared; reconnect explicitly'); return false;
      }
      return true;
    }
    inspectCurrent = responsive;
    function receiveMeters(values) {
      meters = values; meterStamp = stamp(); // Whole packet replacement, including omitted families.
      if (meterFlush === undefined) meterFlush = timers.setTimeout(() => {
        if (!active()) return; // An already-queued old generation cannot lose the new handle.
        meterFlush = undefined;
        if (responsive()) { meterRevision++; emit('meters'); }
      }, meterCadenceMs);
      timers.clearTimeout(meterExpiry);
      const expectedStamp = meterStamp;
      meterExpiry = timers.setTimeout(() => {
        if (meterStamp === expectedStamp && responsive()) emit('meters');
      }, meterTtlMs);
    }
    const failSend = () => stop('error', 'Connection send failed — received state cleared');
    const touch = () => {
      lastActivity = stamp();
      timers.clearTimeout(idle);
      idle = timers.setTimeout(() => { if (active()) stop('timeout', 'Mixer socket became silent — reconnect explicitly'); }, idleMs);
    };
    deadline = timers.setTimeout(() => { if (active()) stop('timeout', 'No verified Ui24 AUX level received in time — reconnect explicitly'); }, timeoutMs);
    current.onopen = () => {
      if (!responsive()) return;
      if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
      phase = 'connected'; detail = 'Socket connected — waiting for received Ui24 model and AUX state'; emit();
      if (!active() || current.readyState !== 1) return;
      try { current.send('3:::INIT'); } catch { failSend(); return; }
      if (!active()) return;
      touch();
      keepalive = timers.setInterval(() => {
        if (!responsive()) return;
        if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
        try { current.send('3:::ALIVE'); } catch { failSend(); }
      }, 1000);
    };
    current.onmessage = ({ data }) => {
      if (!responsive()) return;
      if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
      if (typeof data !== 'string') return;
      touch();
      if (data === '2::') {
        try { current.send('2::'); } catch { failSend(); }
        return;
      }
      const stateChanged = provider.receive(data);
      const model = provider.model();
      if (model !== undefined && model !== 'ui24') { stop('unsupported', `Unsupported mixer model ${model} — Ui24 state is required`); return; }
      if (stateChanged) {
        if (provider.hasAuxLevel()) {
          qualified = true; timers.clearTimeout(deadline);
          phase = 'live'; detail = 'Received Ui24 AUX state · read-only';
        } else {
          phase = 'partial'; detail = model === 'ui24' ? 'Ui24 model received — partial AUX state; unknown fields remain unavailable' : 'Received observations — mixer model not verified';
        }
        emit();
        if (!active()) return;
      }
      if (model !== 'ui24' || !data.startsWith('3:::') || data.length > IEM_RECEIVE_LIMITS.frameBytes || new TextEncoder().encode(data).length > IEM_RECEIVE_LIMITS.frameBytes) return;
      const wholePacket = decodeVu2Frame(data, model);
      if (wholePacket !== null) { receiveMeters(wholePacket); return; }
      const lines = data.slice(4).split('\n');
      // Do not accept the valid-looking first fragment of a malformed wrapped
      // base64 payload. Fallback is only for separately framed protocol records.
      if (lines.length > IEM_RECEIVE_LIMITS.lines || lines.some(line => line && !/^[A-Z][A-Z0-9_]*\^/.test(line))) return;
      for (const line of lines) {
        if (!line.startsWith('VU2^')) continue;
        const values = decodeVu2Frame('3:::' + line, model);
        if (values !== null) receiveMeters(values);
      }
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
