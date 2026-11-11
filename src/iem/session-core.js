import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from './protocol.js';
import { createAuxPanGuard } from './aux-pan-safety.js';
import { auxPanPath, resolveAuxPanTargets } from './aux-pan-protocol.js';
import { createAuxLevelGuard } from './aux-level-safety.js';
import { resolveRelativeGroup } from './relative-groups.js';
import { validateSettings } from '../settings.js';
import { resolveAuxLevelTargets, auxLevelPath } from './aux-level-protocol.js';

// Private ownership: no socket, generic sender or queue escapes. The literal
// read-only factory cannot acquire the typed level capability through options.
function createSession(controlEnabled, { WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000, meterTtlMs = 2000, meterCadenceMs = 100,
  now = () => globalThis.performance?.now() ?? Date.now(), wallNow = () => Date.now(), clockGraceMs = 1000, confirmationMs = 2500, settingsRepository } = {}, panEnabled = false) {
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
  let sequence = 0, revision = 0, levelRevision = 0, panRevision = 0, selected = null, armed = false, gesture = null, pending = null, confirmation;
  let controlStatus = 'Select a level; controls are off.', lastOperation = null, groupProfileId = null, selectedGroupSignature = null;
  const readGroup = groupId => {
    const settings = validateSettings(settingsRepository?.snapshot()?.settings);
    const profile = settings.profiles.find(profile => profile.id === groupProfileId);
    const group = profile?.groups.find(group => group.id === groupId);
    if (!group) throw Error('Current bound local group is unavailable.');
    return group;
  };
  const guard = createAuxLevelGuard({ readGroup, readContext: () => ({ generation, revision, levelRevision, observations: observed, receipts,
    open: socket?.readyState === 1, visible: globalThis.document?.hidden !== true }) });
  const panTarget = () => ({ sourceId: selected.sourceId, auxIndex: selected.auxIndex });
  const panGuard = createAuxPanGuard({ readContext: () => ({ generation, revision, panRevision, observations: observed, receipts, open: socket?.readyState === 1, visible: globalThis.document?.hidden !== true }) });
  function cancelControl(message = 'Controls off; enable explicitly.') {
    revision++; guard.disarm(); panGuard.disarm(); armed = false; gesture = pending = null;
    timers.clearTimeout(confirmation); controlStatus = message;
  }
  function inspectConfirmation() {
    if (!pending || pending.dispatching || !pending.completed) return;
    const age = elapsed(pending.completed);
    if (invalidClock(age) || Math.max(age.mono, age.wall) >= confirmationMs) cancelControl(`${pending.kind === 'pan' ? 'Pan' : 'Level'} readback unconfirmed; controls off. No retry.`);
  }
  function syncGroupSelection() {
    if (selected?.kind !== 'group') return;
    try {
      if (JSON.stringify([groupProfileId, readGroup(selected.groupId)]) === selectedGroupSignature) return;
    } catch { /* Missing or invalid canonical definition invalidates authority too. */ }
    cancelControl('Local group definition changed; select and enable again.'); selected = null; selectedGroupSignature = null;
  }
  function controlSnapshot() {
    syncGroupSelection(); inspectConfirmation();
    let eligible = false, groupName, reason = 'Select an observed master or source send.';
    if (selected) {
      try { if (selected.kind === 'pan') resolveAuxPanTargets(observed, panTarget()); else if (selected.kind === 'group') { const group = readGroup(selected.groupId); groupName = group.name; resolveRelativeGroup(observed, group, selected.auxIndex); } else resolveAuxLevelTargets(observed, selected); eligible = socket?.readyState === 1; reason = eligible ? '' : 'Socket is not open.'; }
      catch (error) { reason = error.message; }
    }
    return { ...(panEnabled ? { panCapable: true, operation: selected?.kind === 'pan' ? 'pan' : 'level', previewPan: gesture?.panValue, expectedPan: lastOperation?.kind === 'pan' ? lastOperation.panValue : null } : {}), ...(groupName ? { groupName } : {}), selected: selected ? { ...selected } : null, eligible, reason, armed, gestureActive: Boolean(gesture), pending: Boolean(pending), status: controlStatus, previewDelta: gesture?.delta ?? 0, lastDelta: lastOperation?.delta ?? null, dispatched: lastOperation?.dispatched || 0, authorized: lastOperation?.authorized || 0 };
  }
  function finishReadback() {
    inspectConfirmation();
    if (!pending || pending.dispatching) return;
    const result = pending.guard.readback(pending.plan);
    if (result === 'unconfirmed') return;
    timers.clearTimeout(confirmation);
    if (result === 'observed-match') { const delta = pending.delta, kind = pending.kind; pending = null; controlStatus = kind === 'pan' ? 'Observed matching pan positions; no correlated acknowledgement.' : delta === undefined ? 'Observed matching level readback; no correlated acknowledgement.' : `Last relative Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} dB observed; next gesture starts at Δ 0.`; }
    else { const label = pending.kind === 'pan' ? 'Pan' : 'Level'; cancelControl(result === 'conflict' ? `Conflicting ${label.toLowerCase()} readback; controls off.` : `${label} operation invalidated; controls off.`); }
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
      if (existed && actual && (field === 'level' || panEnabled && field === 'pan')) {
        changed = true; if (field === 'level') levelRevision++; else panRevision++;
        if (!pending || pending.dispatching || !pending.expected.has(path) || pending.expected.get(path) !== value) unexpected = true;
      }
    }
    if ((armed || gesture || pending) && (topology || unexpected || (changed && !pending))) cancelControl(panEnabled ? 'Received context or native control changed; controls off.' : 'Received context or native level changed; controls off.');
    else finishReadback();
  }
  function canAct() { if (socket) inspectCurrent(); syncGroupSelection(); inspectConfirmation(); return controlEnabled && socket?.readyState === 1 && globalThis.document?.hidden !== true; }
  const armSelected = () => selected.kind === 'group' ? guard.armGroup(selected.groupId, selected.auxIndex) : guard.arm(selected);
  function dispatchPlan(plan, kind, planGuard) {
      gesture = null;
      if (plan.delta === 0) { lastOperation = null; controlStatus = 'Relative Δ 0 dB; no commands sent.'; emit('controls'); return false; }
      const operation = { plan, kind, guard: planGuard, panValue: kind === 'pan' ? plan.value : undefined, dispatching: true, expected: new Map(), delta: plan.delta, dispatched: 0, authorized: 0 }, current = socket, tokenGeneration = generation;
      pending = lastOperation = operation;
      try {
        for (let ordinal = 0; ordinal < plan.count; ordinal++) {
          if (!canAct() || socket !== current || generation !== tokenGeneration || pending !== operation || !armed) throw Error('Dispatch interrupted.');
          const grant = planGuard.authorizeNext(plan, ordinal); operation.authorized++;
          const { value: ignored, ...target } = grant.command;
          operation.expected.set(kind === 'pan' ? auxPanPath(target) : auxLevelPath(target), grant.command.value);
          current.send(grant.message);
          // A send may synchronously trigger a fake/native callback. Never continue its old operation.
          operation.dispatched++;
          if (pending !== operation || socket !== current || generation !== tokenGeneration || !armed) {
            if (generation === tokenGeneration) emit('controls');
            return false;
          }
        }
      } catch {
        if (socket === current && generation === tokenGeneration) stop('error', kind === 'pan' ? 'Pan adjustment interrupted; some pan positions may have changed. Reconnect explicitly.' : 'Level adjustment interrupted; some levels may have changed. Reconnect explicitly.');
        return false;
      }
      operation.dispatching = false; operation.completed = stamp(); controlStatus = kind === 'pan' ? 'Waiting for fresh pan readback; positions are not confirmed.' : plan.delta === undefined ? 'Waiting for fresh level readback; delivery is not confirmed.' : `Relative Δ ${plan.delta >= 0 ? '+' : ''}${plan.delta.toFixed(2)} dB pending fresh member readback.`;
      confirmation = timers.setTimeout(() => {
        if (pending === operation && generation === tokenGeneration) { cancelControl(`${pending.kind === 'pan' ? 'Pan' : 'Level'} readback unconfirmed; controls off. No retry.`); emit('controls'); }
      }, confirmationMs);
      finishReadback(); emit('controls'); return true;
  }
  const controlAPI = {
    bindGroupProfile(profileId) {
      if (profileId === groupProfileId) return;
      cancelControl(); selected = null; groupProfileId = typeof profileId === 'string' ? profileId : null;
    },
    selectGroupTarget(groupId, auxIndex) {
      cancelControl(); selected = null;
      try {
        const group = readGroup(groupId);
        selected = Object.freeze({ kind: 'group', groupId: group.id, auxIndex }); selectedGroupSignature = JSON.stringify([groupProfileId, group]);
        resolveRelativeGroup(observed, group, auxIndex); controlStatus = 'Relative group selected; enable explicitly.';
      } catch (error) { controlStatus = error.message; }
      emit('controls'); return Boolean(selected && controlSnapshot().eligible);
    },
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
      if (!canAct() || !selected || selected.kind === 'pan' || pending || gesture) return false;
      try { armSelected(); armed = true; controlStatus = 'Level enabled; drag the cap and release to apply.'; emit('controls'); return armed; }
      catch (error) { cancelControl(error.message); emit('controls'); return false; }
    },
    disarmLevel() { cancelControl(); emit('controls'); },
    invalidateLevelContext() { cancelControl(); selected = null; },
    beginLevelGesture() {
      if (!canAct() || !armed || pending || gesture || !selected || selected.kind === 'pan') return null;
      try { armSelected(); } catch (error) { cancelControl(error.message); emit('controls'); return null; }
      const token = Object.freeze({}); gesture = { token, delta: 0 }; controlStatus = 'Preview only; release to apply. Readout remains received.'; emit('controls'); return gesture?.token === token && armed ? token : null;
    },
    previewLevelGesture(token, value) {
      if (!canAct() || !gesture || gesture.token !== token || !armed || pending || selected?.kind === 'pan') return null;
      if (selected.kind !== 'group') return value;
      try { gesture.delta = guard.previewRelative(value); gesture.previewed = true; return gesture.delta; }
      catch (error) { cancelControl(error.message); emit('controls'); return null; }
    },
    cancelLevelGesture() { if (gesture && selected?.kind !== 'pan') { cancelControl('Adjustment cancelled; controls off.'); emit('controls'); } },
    commitLevelGesture(token, value) {
      if (!canAct() || !armed || !gesture || gesture.token !== token || pending || selected?.kind === 'pan') return false;
      if (typeof value !== 'number' || !Number.isFinite(value) || (selected.kind === 'group' && !gesture.previewed)) return false;
      let plan;
      try { plan = selected.kind === 'group' ? guard.prepareRelative(gesture.delta) : guard.prepare(value); } catch (error) { cancelControl(error.message); emit('controls'); return false; }
      return dispatchPlan(plan, 'level', guard);
    },
  };
  const panAPI = {
    selectPanTarget(target) {
      cancelControl(); selected = null;
      try {
        const path = auxPanPath(target), match = /^(.*)\.aux\.([0-9])\.pan$/.exec(path);
        selected = Object.freeze({ kind: 'pan', sourceId: match[1], auxIndex: Number(match[2]) });
        resolveAuxPanTargets(observed, panTarget()); controlStatus = 'Pan selected; enable explicitly. Positions are normalized numbers.';
      } catch (error) { controlStatus = error.message; }
      emit('controls'); return Boolean(selected && controlSnapshot().eligible);
    },
    armPan() {
      if (!canAct() || selected?.kind !== 'pan' || pending || gesture) return false;
      try { panGuard.arm(panTarget()); armed = true; controlStatus = 'Pan enabled; preview then release to apply.'; emit('controls'); return armed; }
      catch (error) { cancelControl(error.message); emit('controls'); return false; }
    },
    disarmPan() { if (selected?.kind === 'pan') { cancelControl('Pan controls off.'); emit('controls'); } },
    closePan() { if (selected?.kind === 'pan') { cancelControl(); selected = null; emit('controls'); } },
    beginPanGesture() {
      if (!canAct() || !armed || pending || gesture || selected?.kind !== 'pan') return null;
      try { panGuard.arm(panTarget()); } catch (error) { cancelControl(error.message); emit('controls'); return null; }
      const token = Object.freeze({}); gesture = { token, panValue: observed.get(auxPanPath(panTarget())) };
      controlStatus = 'Pan preview only; release to apply. Received positions remain unchanged.'; emit('controls');
      return gesture?.token === token && armed ? token : null;
    },
    previewPanGesture(token, value) {
      if (!canAct() || !armed || pending || !gesture || gesture.token !== token || selected?.kind !== 'pan') return null;
      try { const plan = panGuard.prepare(value); gesture.panValue = plan.value; gesture.previewed = true; return plan.value; }
      catch (error) { cancelControl(error.message); emit('controls'); return null; }
    },
    commitPanGesture(token) {
      if (!canAct() || !armed || pending || !gesture || gesture.token !== token || !gesture.previewed || selected?.kind !== 'pan') return false;
      let plan;
      try { plan = panGuard.prepare(gesture.panValue); } catch (error) { cancelControl(error.message); emit('controls'); return false; }
      return dispatchPlan(plan, 'pan', panGuard);
    },
    cancelPanGesture() { if (selected?.kind === 'pan' && gesture) { cancelControl('Pan adjustment cancelled; controls off.'); emit('controls'); } },
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
    ...(panEnabled ? panAPI : {}),
    connect,
    disconnect: () => stop(),
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}


// These literal factories cannot be upgraded by caller options or snapshots.
export function createReadOnlySession(options) { return createSession(false, options); }
export function createAuxLevelSession(options) { return createSession(true, options); }

export function createAuxControlSession(options) { return createSession(true, options, true); }
