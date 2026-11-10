import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from './protocol.js';
import { createAuxLevelGuard } from './aux-level-safety.js';
import { resolveAuxLevelTargets, auxLevelPath } from './aux-level-protocol.js';

// Private ownership: no socket, generic sender or queue escapes. The literal
// read-only factory cannot acquire the typed level capability through options.
function createSession(controlEnabled, { WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000, meterTtlMs = 2000, meterCadenceMs = 100,
  now = () => globalThis.performance?.now() ?? Date.now(), wallNow = () => Date.now(), clockGraceMs = 1000, confirmationMs = 2500 } = {}) {
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
  const observed = new Map(), receipts = new Map();
  let sequence = 0, revision = 0, levelRevision = 0, selected = null, armed = false, gesture = null, pending = null, confirmation;
  let controlStatus = 'Select a level; controls are off.', lastOperation = null;
  const guard = createAuxLevelGuard({ readContext: () => ({ generation, revision, levelRevision, observations: observed, receipts,
    open: socket?.readyState === 1, visible: globalThis.document?.hidden !== true }) });
  function cancelControl(message = 'Controls off; enable explicitly.') {
    revision++; guard.disarm(); armed = false; gesture = pending = null;
    timers.clearTimeout(confirmation); controlStatus = message;
  }
  function inspectConfirmation() {
    if (!pending || pending.dispatching || !pending.completed) return;
    const age = elapsed(pending.completed);
    if (invalidClock(age) || Math.max(age.mono, age.wall) >= confirmationMs) cancelControl('Level readback unconfirmed; controls off. No retry.');
  }
  function controlSnapshot() {
    inspectConfirmation();
    let eligible = false, reason = 'Select an observed master or source send.';
    if (selected) {
      try { resolveAuxLevelTargets(observed, selected); eligible = socket?.readyState === 1; reason = eligible ? '' : 'Socket is not open.'; }
      catch (error) { reason = error.message; }
    }
    return { selected: selected ? { ...selected } : null, eligible, reason, armed, gestureActive: Boolean(gesture), pending: Boolean(pending), status: controlStatus, dispatched: lastOperation?.dispatched || 0, authorized: lastOperation?.authorized || 0 };
  }
  function finishReadback() {
    inspectConfirmation();
    if (!pending || pending.dispatching) return;
    const result = guard.readback(pending.plan);
    if (result === 'unconfirmed') return;
    timers.clearTimeout(confirmation);
    if (result === 'observed-match') { pending = null; controlStatus = 'Observed matching level readback; no correlated acknowledgement.'; }
    else cancelControl(result === 'conflict' ? 'Conflicting level readback; controls off.' : 'Level operation invalidated; controls off.');
  }
  function journal(frame) {
    if (!controlEnabled) return;
    inspectConfirmation();
    const updates = parseIemStateFrame(frame);
    let topology = false, changed = false, unexpected = false;
    for (const update of updates) {
      const { path, value, field } = update, existed = observed.has(path), previous = observed.get(path);
      const actual = !existed || previous !== value;
      observed.set(path, value); receipts.set(path, ++sequence);
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(field)) { topology = true; revision++; }
      if (existed && actual && field === 'level') {
        changed = true; levelRevision++;
        if (!pending || pending.dispatching || !pending.expected.has(path) || pending.expected.get(path) !== value) unexpected = true;
      }
    }
    if ((armed || gesture || pending) && (topology || unexpected || (changed && !pending))) cancelControl('Received context or native level changed; controls off.');
    else finishReadback();
  }
  function canAct() { if (socket) inspectCurrent(); inspectConfirmation(); return controlEnabled && socket?.readyState === 1 && globalThis.document?.hidden !== true; }
  const controlAPI = {
    selectLevelTarget(target) {
      cancelControl(); selected = null;
      try { selected = resolveAuxLevelTargets(observed, target).target; controlStatus = 'Level selected; enable explicitly.'; }
      catch (error) {
        // Keep only a valid narrow descriptor for an honest unavailable selection.
        try { auxLevelPath(target); selected = Object.freeze({ ...target }); } catch { /* No caller path can become authority. */ }
        controlStatus = error.message;
      }
      emit('controls'); return Boolean(selected && controlSnapshot().eligible);
    },
    armLevel() {
      if (!canAct() || !selected || pending || gesture) return false;
      try { guard.arm(selected); armed = true; controlStatus = 'Level enabled; drag the cap and release to apply.'; emit('controls'); return armed; }
      catch (error) { cancelControl(error.message); emit('controls'); return false; }
    },
    disarmLevel() { cancelControl(); emit('controls'); },
    invalidateLevelContext() { cancelControl(); selected = null; },
    beginLevelGesture() {
      if (!canAct() || !armed || pending || gesture || !selected) return null;
      try { guard.arm(selected); } catch (error) { cancelControl(error.message); emit('controls'); return null; }
      const token = Object.freeze({}); gesture = { token }; controlStatus = 'Preview only; release to apply. Readout remains received.'; emit('controls'); return gesture?.token === token && armed ? token : null;
    },
    cancelLevelGesture() { if (gesture) { cancelControl('Adjustment cancelled; controls off.'); emit('controls'); } },
    commitLevelGesture(token, value) {
      if (!canAct() || !armed || !gesture || gesture.token !== token || pending) return false;
      let plan;
      try { plan = guard.prepare(value); } catch (error) { cancelControl(error.message); emit('controls'); return false; }
      gesture = null;
      const operation = { plan, dispatching: true, expected: new Map(), dispatched: 0, authorized: 0 }, current = socket, tokenGeneration = generation;
      pending = lastOperation = operation;
      try {
        for (let ordinal = 0; ordinal < plan.count; ordinal++) {
          if (!canAct() || socket !== current || generation !== tokenGeneration || pending !== operation || !armed) throw Error('Dispatch interrupted.');
          const grant = guard.authorizeNext(plan, ordinal); operation.authorized++;
          const { value: ignored, ...target } = grant.command;
          operation.expected.set(auxLevelPath(target), value);
          current.send(grant.message);
          // A send may synchronously trigger a fake/native callback. Never continue its old operation.
          operation.dispatched++;
          if (pending !== operation || socket !== current || generation !== tokenGeneration || !armed) {
            if (generation === tokenGeneration) emit('controls');
            return false;
          }
        }
      } catch {
        if (socket === current && generation === tokenGeneration) stop('error', 'Level dispatch interrupted; delivery may be partial/unknown. Reconnect explicitly.');
        return false;
      }
      operation.dispatching = false; operation.completed = stamp(); controlStatus = 'Waiting for fresh level readback; delivery is not confirmed.';
      confirmation = timers.setTimeout(() => {
        if (pending === operation && generation === tokenGeneration) { cancelControl('Level readback unconfirmed; controls off. No retry.'); emit('controls'); }
      }, confirmationMs);
      finishReadback(); emit('controls'); return true;
    },
  };
  const snapshot = () => {
    if (socket) inspectCurrent(); // A read after sleep cannot resurrect old state before timers run.
    return { phase, detail, observations: provider.snapshot(), meterState: meterState(), meters: new Map(meters), meterRevision, ...(controlEnabled ? { control: controlSnapshot() } : {}) };
  };
  const emit = (kind = 'state') => { for (const listener of listeners) listener(snapshot(), kind); };
  const clearTimers = () => { timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearInterval(keepalive); timers.clearTimeout(meterExpiry); timers.clearTimeout(meterFlush); meterFlush = undefined; };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    cancelControl('Controls off; received state cleared.'); if (next !== 'error') lastOperation = null; selected = null; observed.clear(); receipts.clear(); sequence = 0;
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
      if (controlEnabled && globalThis.document?.hidden === true) { stop('disconnected', 'App hidden — received state cleared; reconnect explicitly'); return false; }
      if (phase !== 'connecting' && current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return false; }
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
      journal(data);
      const model = provider.model();
      if (model !== undefined && model !== 'ui24') { stop('unsupported', `Unsupported mixer model ${model} — Ui24 state is required`); return; }
      if (stateChanged) {
        if (provider.hasAuxLevel()) {
          qualified = true; timers.clearTimeout(deadline);
          phase = 'live'; detail = controlEnabled ? 'Received Ui24 AUX state · levels start off' : 'Received Ui24 AUX state · read-only';
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
    ...(controlEnabled ? controlAPI : {}),
    connect,
    disconnect: () => stop(),
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}


// These literal factories cannot be upgraded by caller options or snapshots.
export function createReadOnlySession(options) { return createSession(false, options); }
export function createAuxLevelSession(options) { return createSession(true, options); }
