import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from './protocol.js';
import { createControlScope, createControlState, transitionControl, OBSERVATION_WINDOW_MS } from './control-state-model.js';
import { auxPanPath, encodeAuxPanCommand } from './aux-pan-protocol.js';
import { validateSettings } from '../settings.js';
import { auxLevelPath, encodeAuxLevelCommand } from './aux-level-protocol.js';

// Private ownership: no socket, generic sender or queue escapes. The literal
// read-only factory cannot acquire the typed level capability through options.
function createSession(controlEnabled, { WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000, meterTtlMs = 2000, meterCadenceMs = 100,
  now = () => globalThis.performance?.now() ?? Date.now(), wallNow = () => Date.now(), clockGraceMs = 1000, settingsRepository } = {}, panEnabled = false) {
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
  let sequence = 0, revision = 0, selected = null, confirmation, model = null;
  let controlStatus = 'Select a level; controls are off.', groupProfileId = null, selectedGroupSignature = null;
  // Only this owner constructs scopes and reducer events from its socket journal.
  // Neither pure scopes nor public snapshots are accepted as transport authority.
  const modelTime = () => { const t = stamp(); return { mono: Math.max(0, t.mono), wall: Math.max(0, t.wall) }; };
  const step = event => { model = transitionControl(model, { ...event, now: modelTime() }); };
  const readGroup = groupId => {
    const settings = validateSettings(settingsRepository?.snapshot()?.settings);
    const profile = settings.profiles.find(profile => profile.id === groupProfileId);
    const group = profile?.groups.find(group => group.id === groupId);
    if (!group) throw Error('Current bound local group is unavailable.');
    return group;
  };
  const panTarget = () => ({ sourceId: selected.sourceId, auxIndex: selected.auxIndex });
  function scope() {
    if (!selected) throw Error('Select an observed master or source send.');
    const kind = selected.kind === 'group' ? 'group' : selected.kind === 'pan' ? 'pan' : 'level';
    const group = kind === 'group' ? readGroup(selected.groupId) : null;
    return createControlScope({ kind, received: observed, receipts,
      target: kind === 'pan' ? panTarget() : kind === 'group' ? { auxIndex: selected.auxIndex } : selected,
      group: group ? { id: group.id, members: [...group.members] } : null });
  }
  function installScope() {
    const current = scope();
    if (!model) model = createControlState({ scope: current, generation, revision: ++revision, now: modelTime() });
    else if (model.generation !== generation) step({ type: 'new-generation', scope: current, generation, revision: ++revision });
    else step({ type: 'select', scope: current, revision: ++revision });
  }
  function cancelControl(message = 'Controls off; enable explicitly.', reason = 'cancel') {
    revision++;
    if (model) step({ type: 'invalidate', reason, revision });
    timers.clearTimeout(confirmation); controlStatus = message;
  }
  function inspectConfirmation() { if (model) step({ type: 'tick' }); }
  function syncGroupSelection() {
    if (selected?.kind !== 'group') return;
    try { if (JSON.stringify([groupProfileId, readGroup(selected.groupId)]) === selectedGroupSignature) return; }
    catch { /* Missing canonical definitions revoke permission too. */ }
    cancelControl('Local group definition changed; select and enable again.', 'membership'); selected = null; selectedGroupSignature = null;
  }
  const activeOperation = () => model?.generation === generation || phase === 'error' ? model?.operation : null;
  function statusText() {
    const op = activeOperation();
    if (model?.status === 'pending') return 'Waiting for fresh observations; application unverified.';
    if (model?.status === 'sent-unverified') return 'Sent; application unverified. Requested coordinate retained; no retry. Some values may have changed.';
    if (model?.status === 'observed-match') return `${selected?.kind === 'group' ? `Requested cumulative Δ ${model.chain?.delta.toFixed(2)} dB; ` : ''}Observed matching values; no correlated acknowledgement.`;
    if (model?.status === 'no-op') return 'Unchanged requested coordinate; no commands sent.';
    if (model && !model.armed) {
      const reasons = {
        'precision-or-native-conflict': 'Received value differs from the request; precision or native change is unknown.',
        'native-invalidated': 'Received control value changed; controls off.',
        'reentrant-invalidated': 'Received state during dispatch interrupted the adjustment; controls off.',
        'clock-invalidated': 'Clock changed; controls off.',
        'dispatch-expired': 'Dispatch deadline elapsed; controls off.',
        'interrupted': 'Adjustment interrupted; controls off.',
      };
      const reason = reasons[model.status] ?? controlStatus;
      if (op?.authorized) return `${reason} Returned ${op.returned}/${op.authorized} authorized${op.unknownDelivery ? '; throwing send delivery unknown' : ''}; some values may have changed. Fresh complete received recovery and explicit enable required.`;
      return reason;
    }
    return controlStatus;
  }
  function controlSnapshot() {
    syncGroupSelection(); inspectConfirmation();
    let eligible = false, groupName, reason = 'Select an observed master or source send.';
    if (selected) {
      try {
        const currentScope = scope(); if (selected.kind === 'group') groupName = readGroup(selected.groupId).name;
        const blocked = model?.generation === generation && model.barriers.some(b => b.generation === generation && b.closure.some(path => currentScope.members.some(m => m.path === path)) && (receipts.get(b.path) ?? 0) <= b.floor);
        eligible = socket?.readyState === 1 && !blocked;
        reason = blocked ? 'Fresh complete received recovery required before enabling.' : eligible ? '' : 'Socket is not open.';
      } catch (error) { reason = error.message; }
    }
    const owned = model?.generation === generation, op = activeOperation(), chain = owned ? model.chain : null, preview = owned ? model.gesture?.preview : null;
    return { ...(panEnabled ? { panCapable: true, operation: selected?.kind === 'pan' ? 'pan' : 'level', previewPan: preview?.expected[0]?.value, expectedPan: selected?.kind === 'pan' ? chain?.requested[0]?.value ?? null : null } : {}),
      ...(groupName ? { groupName } : {}), selected: selected ? { ...selected } : null, eligible, reason,
      armed: Boolean(owned && model.armed), gestureActive: Boolean(owned && model.gesture), pending: Boolean(owned && ['pending', 'dispatching'].includes(op?.status)),
      requestedDiagnostic: op?.expected.map(({ path, value }) => ({ path, value })) ?? [], status: statusText(), outcome: owned ? model.status : 'idle', previewDelta: preview?.gestureDelta ?? 0, lastDelta: chain?.delta ?? op?.delta ?? null,
      requestedValue: chain && selected?.kind !== 'group' ? preview?.expected[0]?.value ?? chain.requested[0]?.value : null,
      dispatched: op?.returned ?? 0, authorized: op?.authorized ?? 0, unknownDelivery: op?.unknownDelivery ?? false };
  }
  function journal(frame) {
    if (!controlEnabled) return;
    inspectConfirmation();
    for (const { path, value, field } of parseIemStateFrame(frame)) {
      const actual = !observed.has(path) || observed.get(path) !== value;
      observed.set(path, value); receipts.set(path, ++sequence);
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(field)) cancelControl('Received topology changed; controls off.', 'topology');
      if (actual && ['mute', 'post', 'postproc'].includes(field) && model?.generation === generation && model.scope.members.some(({ target }) =>
        path.startsWith(`a.${target.auxIndex}.`) || target.sourceId && (path === `${target.sourceId}.mute` || path.startsWith(`${target.sourceId}.aux.${target.auxIndex}.`)))) {
        cancelControl('Received processing context changed; controls off.', 'processing');
      }
      if (model?.generation === generation && (field === 'level' || field === 'pan')) step({ type: 'receive', generation, path, value, receipt: sequence });
    }
  }
  function canAct() { if (socket) inspectCurrent(); syncGroupSelection(); inspectConfirmation(); return controlEnabled && socket?.readyState === 1 && globalThis.document?.hidden !== true; }
  function revalidate() {
    if (!canAct() || !selected || !model?.armed || model.generation !== generation || !model.scopeCurrent) throw Error('Current owner revoked.');
    const current = scope();
    if (current.identity !== model.scope.identity || JSON.stringify(current.members.map(x => [x.path, x.target])) !== JSON.stringify(model.scope.members.map(x => [x.path, x.target]))) throw Error('Current typed closure changed.');
  }
  function dispatch() {
    const op = model.operation, current = socket, ownerGeneration = generation;
    if (op?.status !== 'dispatching') { emit('controls'); return false; }
    for (let ordinal = 0; ordinal < op.expected.length; ordinal++) {
      try {
        revalidate();
        if (socket !== current || generation !== ownerGeneration || model.operation?.id !== op.id) throw Error('Dispatch interrupted.');
        step({ type: 'authorize', id: op.id, ordinal });
        const authorized = model.operation;
        if (socket !== current || current.readyState !== 1 || globalThis.document?.hidden === true || generation !== ownerGeneration ||
            model.generation !== ownerGeneration || model.revision !== op.revision || !model.scopeCurrent || !model.armed ||
            model.scope !== op.scope || authorized?.id !== op.id || authorized.status !== 'dispatching' ||
            authorized.flight !== ordinal || authorized.authorized !== ordinal + 1 || authorized.returned !== ordinal) throw Error('Exact owned authorization was revoked.');
        // No callback or await between owned authorization and exact typed send.
        const command = { ...op.expected[ordinal].target, value: op.expected[ordinal].value };
        const message = selected.kind === 'pan' ? encodeAuxPanCommand(command) : encodeAuxLevelCommand(command);
        try { current.send(message); }
        catch {
          step({ type: 'threw', id: op.id, ordinal });
          if (socket === current && generation === ownerGeneration && model.operation?.id === op.id) stop('error', 'Adjustment interrupted; some levels or pan positions may have changed. Reconnect explicitly.');
          return false;
        }
        // Settle the exact outstanding ID even after a synchronous replacement.
        step({ type: 'returned', id: op.id, ordinal });
        if (socket !== current || generation !== ownerGeneration || model.operation?.id !== op.id || !model.armed || !['dispatching', 'pending', 'observed-match'].includes(model.operation.status)) { emit('controls'); return false; }
      } catch {
        if (socket === current && generation === ownerGeneration && model.operation?.id === op.id && model.armed) cancelControl('Dispatch interrupted; some values may have changed.');
        emit('controls'); return false;
      }
    }
    timers.clearTimeout(confirmation);
    confirmation = timers.setTimeout(() => { if (model?.operation?.id === op.id && generation === ownerGeneration) { inspectConfirmation(); emit('controls'); } }, OBSERVATION_WINDOW_MS);
    emit('controls'); return true;
  }
  function select(target, message) {
    cancelControl(); selected = target;
    try { installScope(); controlStatus = message; } catch (error) { controlStatus = error.message; }
    emit('controls'); return Boolean(selected && controlSnapshot().eligible);
  }
  function arm(pan) {
    if (!canAct() || !selected || (selected.kind === 'pan') !== pan || model?.gesture || ['pending', 'dispatching'].includes(activeOperation()?.status)) return false;
    try { if (model?.armed) { revalidate(); emit('controls'); return Boolean(model?.armed); } installScope(); step({ type: 'arm' }); controlStatus = 'Enabled; requested coordinate is separate from last received values. Release to apply.'; emit('controls'); return Boolean(model?.armed); }
    catch (error) { cancelControl(error.message); emit('controls'); return false; }
  }
  function begin(pan) {
    if (!canAct() || !selected || (selected.kind === 'pan') !== pan || !model?.armed || model.gesture || ['pending', 'dispatching'].includes(activeOperation()?.status)) return null;
    try { revalidate(); step({ type: 'begin' }); const token = model.gesture.token; controlStatus = 'Preview requested coordinate; release to apply. Last received values unchanged.'; emit('controls'); return model.gesture?.token === token && model.armed ? token : null; }
    catch (error) { cancelControl(error.message); emit('controls'); return null; }
  }
  function preview(token, value, pan) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || (selected?.kind === 'pan') !== pan) return null;
    try { revalidate(); step({ type: 'preview', token, value }); return selected.kind === 'group' ? model.gesture.preview.gestureDelta : model.gesture.preview.expected[0].value; }
    catch (error) { cancelControl(error.message); emit('controls'); return null; }
  }
  function commit(token, value, pan) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || (selected?.kind === 'pan') !== pan) return false;
    if (typeof value !== 'number' && !pan && selected.kind !== 'group') return false;
    try {
      revalidate();
      if (!pan && selected.kind !== 'group') { if (preview(token, value, false) === null) return false; }
      if (!model.gesture?.preview) return false;
      step({ type: 'commit', token }); return dispatch();
    } catch (error) { cancelControl(error.message); emit('controls'); return false; }
  }
  const controlAPI = {
    bindGroupProfile(profileId) { if (profileId !== groupProfileId) { cancelControl('Profile changed; controls off.', 'profile'); selected = null; groupProfileId = typeof profileId === 'string' ? profileId : null; } },
    selectGroupTarget(groupId, auxIndex) {
      let target = null;
      try { const group = readGroup(groupId); target = Object.freeze({ kind: 'group', groupId: group.id, auxIndex }); selectedGroupSignature = JSON.stringify([groupProfileId, group]); }
      catch { /* No group authority from caller data. */ }
      return select(target, 'Relative group selected; enable explicitly. Requested offsets do not prove hardware balance.');
    },
    selectLevelTarget(target) {
      let descriptor = null;
      try { auxLevelPath(target); descriptor = Object.freeze({ ...target }); } catch { /* Strict narrow descriptor only. */ }
      return select(descriptor, 'Level selected; enable explicitly.');
    },
    armLevel: () => arm(false),
    disarmLevel() { cancelControl(); emit('controls'); },
    invalidateLevelContext() { cancelControl(); selected = null; },
    beginLevelGesture: () => begin(false),
    previewLevelGesture: (token, value) => preview(token, value, false),
    cancelLevelGesture() { if (model?.gesture && selected?.kind !== 'pan') { cancelControl('Adjustment cancelled; controls off.'); emit('controls'); } },
    commitLevelGesture: (token, value) => commit(token, value, false),
  };
  const panAPI = {
    selectPanTarget(target) {
      let descriptor = null;
      try { const path = auxPanPath(target), match = /^(.*)\.aux\.([0-9])\.pan$/.exec(path); descriptor = Object.freeze({ kind: 'pan', sourceId: match[1], auxIndex: Number(match[2]) }); } catch { /* Narrow pan only. */ }
      return select(descriptor, 'Pan selected; enable explicitly. Positions are normalized numbers.');
    },
    armPan: () => arm(true),
    disarmPan() { if (selected?.kind === 'pan') { cancelControl('Pan controls off.'); emit('controls'); } },
    closePan() { if (selected?.kind === 'pan') { cancelControl(); selected = null; emit('controls'); } },
    beginPanGesture: () => begin(true),
    previewPanGesture: (token, value) => preview(token, value, true),
    commitPanGesture: token => commit(token, undefined, true),
    cancelPanGesture() { if (selected?.kind === 'pan' && model?.gesture) { cancelControl('Pan adjustment cancelled; controls off.'); emit('controls'); } },
  };
  const snapshot = () => {
    if (socket) inspectCurrent(); // A read after sleep cannot resurrect old state before timers run.
    return { phase, detail, observations: provider.snapshot(), meterState: meterState(), meters: new Map(meters), meterRevision, ...(controlEnabled ? { control: controlSnapshot() } : {}) };
  };
  const emit = (kind = 'state') => { for (const listener of listeners) listener(snapshot(), kind); };
  const clearTimers = () => { timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearInterval(keepalive); timers.clearTimeout(meterExpiry); timers.clearTimeout(meterFlush); meterFlush = undefined; };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    cancelControl('Controls off; received state cleared.', 'disconnect'); selected = null; observed.clear(); receipts.clear(); sequence = 0;
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
