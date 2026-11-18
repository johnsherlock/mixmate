import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from './protocol.js';
import { createControlScope, createPeerControlState, transitionControl, OBSERVATION_WINDOW_MS } from './control-state-model.js';
import { auxPanPath, encodeAuxPanCommand } from './aux-pan-protocol.js';
import { validateSettings, validateDefinitionOwner, definitionOwner } from '../settings.js';
import { auxLevelPath, encodeAuxLevelCommand } from './aux-level-protocol.js';
import { AUX_EQ_DISPLAY_CENTRES, auxEqPath, auxEqPositionToDb, encodeAuxEqCommand, eqArray, eqDataFields, parseAuxEqStateFrame, parseAuxProcessingFrame } from './aux-eq-protocol.js';
import { mapRequestedAuxEqCurve } from './aux-eq-curve.js';

// Private ownership: no socket, generic sender or queue escapes. The literal
// read-only factory cannot acquire the typed level capability through options.
// `auxControl` is fixed by the literal createAuxControlSession factory only; it
// adds the typed pan and AUX GEQ band forms, never caller-selected wire paths.
const PROCESSING_CAPACITY = 4096;
const kindOf = target => ['group', 'pan', 'geq'].includes(target?.kind) ? target.kind : 'level';
const apiKind = target => target?.kind === 'pan' ? 'pan' : target?.kind === 'geq' ? 'geq' : 'level';
function createSession(controlEnabled, { WebSocketClass = globalThis.WebSocket, timers = globalThis, timeoutMs = 15000, idleMs = 30000, meterTtlMs = 2000, meterCadenceMs = 100,
  now = () => globalThis.performance?.now() ?? Date.now(), wallNow = () => Date.now(), clockGraceMs = 1000, settingsRepository } = {}, auxControl = false) {
  const provider = createLiveProvider(), listeners = new Set();
  let socket = null, receiver = null, generation = 0, deadline, keepalive, idle, receiverDeadline, receiverIdle, meterExpiry, meterFlush;
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
  const observed = new Map(), receipts = new Map(), eqObserved = new Map(), processingRaw = new Map();
  let dispatchWatch = null;
  let sequence = 0, revision = 0, selected = null, confirmation, model = null;
  let controlStatus = 'Select a received control to edit.', groupOwner = null, selectedGroupSignature = null;
  // Only this owner constructs scopes and reducer events from its socket journal.
  // Neither pure scopes nor public snapshots are accepted as transport authority.
  const modelTime = () => { const t = stamp(); return { mono: Math.max(0, t.mono), wall: Math.max(0, t.wall) }; };
  const step = event => { model = transitionControl(model, { ...event, now: modelTime() }); };
  function bindGroupOwner(value) {
    let next = null;
    try { next = validateDefinitionOwner(value); } catch { /* Invalid owners detach, never grant caller authority. */ }
    if (JSON.stringify(next) !== JSON.stringify(groupOwner)) {
      cancelControl('Definition owner changed; obsolete adjustment cancelled.', 'profile');
      selected = null; groupOwner = next;
    }
  }
  const readGroup = groupId => {
    const settings = validateSettings(settingsRepository?.snapshot()?.settings);
    const profile = definitionOwner(settings, groupOwner);
    const group = profile?.groups.find(group => group.id === groupId);
    if (!group) throw Error('Current bound local group is unavailable.');
    return group;
  };
  function scope(target = selected) {
    if (!target) throw Error('Select an observed master or source send.');
    const kind = kindOf(target);
    if (kind === 'geq' && !auxControl) throw Error('AUX GEQ is unavailable in this session.');
    const group = kind === 'group' ? readGroup(target.groupId) : null;
    return createControlScope({ kind, received: observed, receipts,
      target: kind === 'pan' ? { sourceId: target.sourceId, auxIndex: target.auxIndex } : kind === 'group' || kind === 'geq' ? { auxIndex: target.auxIndex } : target,
      group: group ? { id: group.id, members: [...group.members] } : null });
  }
  function installScope() {
    const current = scope();
    if (!model) model = createPeerControlState({ scope: current, generation, revision: ++revision, now: modelTime() });
    else if (model.generation !== generation) step({ type: 'new-generation', scope: current, generation, revision: ++revision });
    else step({ type: 'select', scope: current, revision: ++revision });
  }
  function cancelControl(message = 'Adjustment cancelled; use a new gesture.', reason = 'cancel') {
    revision++;
    if (model) step({ type: 'invalidate', reason, revision });
    timers.clearTimeout(confirmation); controlStatus = message;
  }
  function inspectConfirmation() { if (model) step({ type: 'tick' }); }
  // Current owned GEQ outputs, from the private model scope only.
  const eqOutputs = () => selected?.kind === 'geq' && model?.generation === generation && model.scope.kind === 'geq' ? [...new Set(model.scope.members.map(x => x.target.auxIndex))] : [];
  const eqValues = rows => rows.slice(0, AUX_EQ_DISPLAY_CENTRES.length).map(x => x.value);
  // Groups always, and GEQ whenever it would re-arm from received state (no
  // retained same-scope chain), wait for every overlapping prior local write's
  // paths to be received after their preauthorization cutpoints.
  function basisBlocks(kind, members, identity) {
    if (model?.generation !== generation || !['group', 'geq'].includes(kind)) return false;
    if (kind === 'geq' && model.armed && model.chain && model.scopeCurrent && model.scope.kind === 'geq' && model.scope.identity === identity) return false;
    return model.basis.some(b => b.members.some(m => members.some(x => x.path === m.path)) && b.members.some(m => (receipts.get(m.path) ?? 0) <= m.floor));
  }
  function syncGroupSelection() {
    if (selected?.kind !== 'group') return;
    try { if (JSON.stringify([groupOwner, readGroup(selected.groupId)]) === selectedGroupSignature) return; }
    catch { /* Missing canonical definitions revoke permission too. */ }
    cancelControl('Local group definition changed; select the current group.', 'membership'); selected = null; selectedGroupSignature = null;
  }
  const activeOperation = () => model?.generation === generation || ['error', 'closed', 'timeout'].includes(phase) ? model?.operation : null;
  function statusText(ready = false) {
    const op = activeOperation();
    if (model?.status === 'pending') return 'Waiting for fresh observations; application unverified.';
    if (model?.status === 'sent-unverified') return 'Sent; application unverified. Requested coordinate retained; no retry. Some values may have changed.';
    if (model?.status === 'observed-match') return `${selected?.kind === 'group' ? `Last requested gesture Δ ${model.chain?.delta.toFixed(2)} dB; ` : ''}Observed matching values; no correlated acknowledgement.`;
    if (model?.status === 'no-op') return 'Unchanged requested coordinate; no commands sent.';
    if (model && !model.armed) {
      if (ready) return `Ready to edit current received state. ${op?.authorized ? `Previous adjustment returned ${op.returned}/${op.authorized} authorized${op.authorized < op.expected.length ? ` of ${op.expected.length} planned` : ''}${op.unknownDelivery ? '; throwing send delivery unknown' : ''}; application unverified.` : 'Obsolete preview cancelled.'}`;
      const reasons = {
        'precision-or-native-conflict': 'Received value differs from the request; precision or native change is unknown.',
        'native-invalidated': 'Received control value changed; the next gesture uses current state.',
        'reentrant-invalidated': 'Received state during dispatch interrupted the adjustment; obsolete adjustment cancelled.',
        'clock-invalidated': 'Clock changed; obsolete adjustment cancelled.',
        'dispatch-expired': 'Dispatch deadline elapsed; obsolete adjustment cancelled.',
        'interrupted': 'Adjustment interrupted; obsolete adjustment cancelled.',
      };
      const reason = reasons[model.status] ?? controlStatus;
      if (op?.authorized) return `${reason} Returned ${op.returned}/${op.authorized} authorized${op.authorized < op.expected.length ? ` of ${op.expected.length} planned` : ''}${op.unknownDelivery ? '; throwing send delivery unknown' : ''}; some values may have changed. Waiting for complete current received state; no replay.`;
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
        const basisBlocked = basisBlocks(kindOf(selected), currentScope.members, currentScope.identity);
        eligible = socket?.readyState === 1 && receiver?.readyState === 1 && !blocked && !basisBlocked;
        reason = blocked ? 'Waiting for complete post-interruption received state.' : basisBlocked ? selected.kind === 'geq' ? 'Waiting for the desk to report the last EQ change before editing from received bands; reconnect to refresh.' : 'Waiting for complete received group basis.' : eligible ? '' : 'Both owned connections must be open.';
      } catch (error) { reason = error.message; }
    }
    const owned = model?.generation === generation, op = activeOperation(), chain = owned ? model.chain : null, preview = owned ? model.gesture?.preview : null;
    const eqSelected = selected?.kind === 'geq' && owned && model.scope.kind === 'geq';
    return { ...(auxControl ? { panCapable: true, eqCapable: true, operation: apiKind(selected), previewPan: selected?.kind === 'geq' ? undefined : preview?.expected[0]?.value, expectedPan: selected?.kind === 'pan' ? chain?.requested[0]?.value ?? null : null } : {}),
      ...(selected?.kind === 'geq' ? { eqRequested: eqSelected && preview ? eqValues(preview.expected) : eqSelected && chain?.touched ? eqValues(chain.requested) : null, eqCoordinate: eqSelected && chain ? eqValues(chain.requested) : null } : {}),
      ...(groupName ? { groupName } : {}), selected: selected ? { ...selected } : null, eligible, reason,
      armed: Boolean(owned && model.armed), gestureActive: Boolean(owned && model.gesture), pending: Boolean(owned && ['pending', 'dispatching'].includes(op?.status)), dispatching: Boolean(owned && op?.status === 'dispatching'),
      requestedDiagnostic: op?.expected.map(({ path, value }) => ({ path, value })) ?? [], status: statusText(eligible), outcome: owned ? model.status : 'idle', previewDelta: preview?.gestureDelta ?? 0, lastDelta: chain?.delta ?? op?.delta ?? null,
      requestedValue: chain && !['group', 'geq'].includes(selected?.kind) ? preview?.expected[0]?.value ?? chain.requested[0]?.value : null,
      dispatched: op?.returned ?? 0, authorized: op?.authorized ?? 0, unknownDelivery: op?.unknownDelivery ?? false };
  }
  function journal(frame) {
    if (!controlEnabled) return;
    inspectConfirmation();
    let controlsChanged = false;
    const updates = parseIemStateFrame(frame);
    // Separate bounded GEQ parser: 31 bands plus read-only bypass per output.
    if (auxControl) for (const update of parseAuxEqStateFrame(frame)) updates.push({ path: update.path, value: update.value, auxIndex: update.auxIndex, field: update.field === 'bypass' ? 'eqBypass' : 'eqBand' });
    for (const { path, value, field, auxIndex } of updates) {
      const actual = !observed.has(path) || observed.get(path) !== value;
      observed.set(path, value); receipts.set(path, ++sequence);
      if (dispatchWatch?.paths.has(path)) dispatchWatch.hit = true;
      if (field === 'eqBand' || field === 'eqBypass') { eqObserved.set(path, value); controlsChanged = true; }
      if (actual && field === 'eqBypass' && eqOutputs().includes(auxIndex)) cancelControl('Received GEQ bypass changed; obsolete EQ adjustment cancelled.', 'processing');
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(field)) cancelControl('Received topology changed; obsolete adjustment cancelled.', 'topology');
      if (actual && ['mute', 'post', 'postproc'].includes(field) && model?.generation === generation && model.scope.members.some(({ target }) =>
        path.startsWith(`a.${target.auxIndex}.`) || target.sourceId && (path === `${target.sourceId}.mute` || path.startsWith(`${target.sourceId}.aux.${target.auxIndex}.`)))) {
        cancelControl('Received processing context changed; obsolete adjustment cancelled.', 'processing');
      }
      if (model?.generation === generation && (field === 'level' || field === 'pan' || field === 'eqBand')) { step({ type: 'receive', generation, path, value, receipt: sequence }); controlsChanged = true; }
    }
    // Unmodelled selected-output processing (filters, dynamics, presets, unknown
    // fields) is opaque: any new or changed raw value cancels obsolete GEQ intent.
    if (auxControl) for (const { path, auxIndex, raw } of parseAuxProcessingFrame(frame)) {
      const changed = raw === null || processingRaw.get(path) !== raw;
      if (raw !== null && (processingRaw.has(path) || processingRaw.size < PROCESSING_CAPACITY)) processingRaw.set(path, raw);
      if (eqOutputs().includes(auxIndex)) {
        if (dispatchWatch) dispatchWatch.hit = true;
        if (changed) cancelControl('Received output processing changed; obsolete EQ adjustment cancelled.', 'processing');
      }
    }
    return controlsChanged;
  }
  function canAct() { if (socket) inspectCurrent(); syncGroupSelection(); inspectConfirmation(); return controlEnabled && socket?.readyState === 1 && receiver?.readyState === 1 && globalThis.document?.hidden !== true; }
  function revalidate() {
    if (!canAct() || !selected || !model?.armed || model.generation !== generation || !model.scopeCurrent) throw Error('Current owner revoked.');
    const current = scope();
    if (current.identity !== model.scope.identity || JSON.stringify(current.members.map(x => [x.path, x.target])) !== JSON.stringify(model.scope.members.map(x => [x.path, x.target]))) throw Error('Current typed closure changed.');
  }
  // Deliberate narrow typed allowlist: the private scope kind chooses exactly one
  // existing serializer; each validates its own strict path/type/range. GEQ is
  // only band peaks of the resolved selected output closure, full precision.
  function serialize(op, ordinal) {
    const item = op.expected[ordinal], command = { ...item.target, value: item.value }, kind = op.scope.kind;
    if (kind !== kindOf(selected)) throw Error('Typed closure kind changed.');
    if (kind === 'geq') {
      if (!auxControl || auxEqPath(item.target) !== item.path) throw Error('Unqualified GEQ form.');
      return encodeAuxEqCommand(command);
    }
    if (kind === 'pan') { if (!auxControl) throw Error('Unqualified pan form.'); return encodeAuxPanCommand(command); }
    return encodeAuxLevelCommand(command);
  }
  function dispatch() {
    const op = model.operation;
    if (op?.status !== 'dispatching') { emit('controls'); return false; }
    // Any synchronous reentrant receipt for the closure (including an exact or
    // unchanged value, bypass or processing) stops the remaining ordinals.
    const outputs = [...new Set(op.scope.members.map(x => x.target.auxIndex))];
    dispatchWatch = { paths: new Set([...op.expected.map(x => x.path), ...(op.scope.kind === 'geq' ? outputs.map(index => `a.${index}.eq.bypass`) : [])]), hit: false };
    try { return dispatchOrdinals(op); } finally { dispatchWatch = null; }
  }
  function dispatchOrdinals(op) {
    const current = socket, currentReceiver = receiver, ownerGeneration = generation;
    for (let ordinal = 0; ordinal < op.expected.length; ordinal++) {
      try {
        revalidate();
        if (socket !== current || generation !== ownerGeneration || model.operation?.id !== op.id) throw Error('Dispatch interrupted.');
        if (dispatchWatch.hit) throw Error('Reentrant receipt.');
        const message = serialize(op, ordinal);
        step({ type: 'authorize', id: op.id, ordinal });
        const authorized = model.operation;
        if (socket !== current || receiver !== currentReceiver || currentReceiver?.readyState !== 1 || current.readyState !== 1 || globalThis.document?.hidden === true || generation !== ownerGeneration ||
            model.generation !== ownerGeneration || model.revision !== op.revision || !model.scopeCurrent || !model.armed ||
            model.scope !== op.scope || authorized?.id !== op.id || authorized.status !== 'dispatching' ||
            authorized.flight !== ordinal || authorized.authorized !== ordinal + 1 || authorized.returned !== ordinal) throw Error('Exact owned authorization was revoked.');
        // No callback or await between owned authorization and exact typed send.
        try { current.send(message); }
        catch {
          step({ type: 'threw', id: op.id, ordinal });
          if (socket === current && generation === ownerGeneration && model.operation?.id === op.id) stop('error', op.scope.kind === 'geq' ? 'Adjustment interrupted; some EQ bands may have changed. Reconnect explicitly.' : 'Adjustment interrupted; some levels or pan positions may have changed. Reconnect explicitly.');
          return false;
        }
        // Settle the exact outstanding ID even after a synchronous replacement.
        step({ type: 'returned', id: op.id, ordinal });
        if (socket !== current || generation !== ownerGeneration || model.operation?.id !== op.id || !model.armed || !['dispatching', 'pending', 'observed-match'].includes(model.operation.status)) { emit('controls'); return false; }
        if (dispatchWatch.hit && ordinal + 1 < op.expected.length) throw Error('Reentrant receipt.');
      } catch (error) {
        if (socket === current && generation === ownerGeneration && model.operation?.id === op.id && model.armed) cancelControl(error.message === 'Reentrant receipt.' ? 'Received state during dispatch interrupted the adjustment; obsolete adjustment cancelled.' : 'Dispatch interrupted; some values may have changed.');
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
  // Compatibility arm aliases select no additional product permission. Only a
  // deliberate begin creates an opaque gesture; incoming receipts never send.
  function arm(pan) {
    return Boolean(canAct() && selected && (selected.kind === 'pan') === pan && selected.kind !== 'geq' && controlSnapshot().eligible);
  }
  function begin(kind) {
    if (!canAct() || !selected || apiKind(selected) !== kind || model?.gesture || activeOperation()?.status === 'dispatching') return null;
    try {
      if (!controlSnapshot().eligible) return null;
      if (selected.kind === 'group' || !model?.armed || !model.scopeCurrent || model.generation !== generation) {
        installScope(); step({ type: 'arm' });
      }
      revalidate(); step({ type: 'begin' }); const token = model.gesture.token;
      controlStatus = kind === 'geq' ? 'Preview requested GEQ curve; release to apply all bands. Received band values remain distinct.' : 'Preview requested coordinate; release to apply. Last received values remain distinct.';
      emit('controls'); return model.gesture?.token === token && model.armed ? token : null;
    } catch (error) { cancelControl(error.message); emit('controls'); return null; }
  }
  function preview(token, value, kind) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || apiKind(selected) !== kind) return null;
    try {
      revalidate(); step({ type: 'preview', token, value });
      return selected.kind === 'group' ? model.gesture.preview.gestureDelta : kind === 'geq' ? eqValues(model.gesture.preview.expected) : model.gesture.preview.expected[0].value;
    } catch (error) { cancelControl(error.message); emit('controls'); return null; }
  }
  // Runtime GEQ authority accepts a requested-curve intent (points/draw samples),
  // never caller paths or raw band arrays. It is copied once, then mapped to the
  // 31 display centres; the private scope supplies every target path.
  function previewEq(token, intent) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || selected?.kind !== 'geq' || model.scope.kind !== 'geq') return null;
    let request, values;
    try {
      const fields = eqDataFields(intent, ['mode', 'samples']);
      request = { mode: fields.mode, samples: eqArray(fields.samples, 2, 257).map(sample => Object.freeze(eqDataFields(sample, ['frequencyHz', 'gainDb']))) };
      values = [...mapRequestedAuxEqCurve(request).values];
    } catch {
      controlStatus = 'Requested curve rejected (outside ±15 dB or invalid); not clipped. The last valid preview is kept; release applies only that.';
      emit('controls'); return null;
    }
    // A drawn or relative-point band identical to the session-provided coordinate
    // keeps that exact coordinate instead of a dB round trip, so unedited bands
    // stay unchanged and an all-zero adjustment is a no-op.
    if (request.samples.length === AUX_EQ_DISPLAY_CENTRES.length && request.samples.every((sample, index) => sample.frequencyHz === AUX_EQ_DISPLAY_CENTRES[index])) {
      const seed = eqValues(model.chain.requested);
      request.samples.forEach((sample, index) => { if (sample.gainDb === auxEqPositionToDb(seed[index])) values[index] = seed[index]; });
    }
    return preview(token, values, 'geq');
  }
  function commit(token, value, kind) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || apiKind(selected) !== kind) return false;
    if (typeof value !== 'number' && kind === 'level' && selected.kind !== 'group') return false;
    try {
      revalidate();
      if (kind === 'level' && selected.kind !== 'group') { if (preview(token, value, 'level') === null) return false; }
      if (!model.gesture?.preview) return false;
      step({ type: 'commit', token }); return dispatch();
    } catch (error) { cancelControl(error.message); emit('controls'); return false; }
  }
  function canEditTarget(target) {
    try {
      if (!canAct()) return false;
      const descriptors = Object.getOwnPropertyDescriptors(target ?? {});
      if (!descriptors.kind || !Object.hasOwn(descriptors.kind, 'value')) return false;
      if (descriptors.kind.value === 'group') {
        if (Reflect.ownKeys(descriptors).sort().join(',') !== 'auxIndex,groupId,kind' || Object.values(descriptors).some(d => !Object.hasOwn(d, 'value')) || typeof descriptors.groupId.value !== 'string') return false;
        target = { kind: 'group', groupId: descriptors.groupId.value, auxIndex: descriptors.auxIndex.value };
      } else if (descriptors.kind.value === 'geq') {
        if (!auxControl || Reflect.ownKeys(descriptors).sort().join(',') !== 'auxIndex,kind' || !Object.hasOwn(descriptors.auxIndex, 'value')) return false;
        auxEqPath({ auxIndex: descriptors.auxIndex.value, bandIndex: 0 });
        target = { kind: 'geq', auxIndex: descriptors.auxIndex.value };
      } else auxLevelPath(target);
      const candidate = scope(target);
      if (model?.generation !== generation) return true;
      if (model.barriers.some(b => b.generation === generation && b.closure.some(path => candidate.members.some(m => m.path === path)) && (receipts.get(b.path) ?? 0) <= b.floor)) return false;
      if (basisBlocks(target.kind === 'group' ? 'group' : target.kind === 'geq' ? 'geq' : 'level', candidate.members, candidate.identity)) return false;
      return activeOperation()?.status !== 'dispatching';
    } catch { return false; }
  }
  const controlAPI = {
    canEditLevelTarget: target => canEditTarget(target),
    bindGroupProfile(profileId) { bindGroupOwner(typeof profileId === 'string' ? { kind: 'profile', id: profileId } : null); },
    bindGroupOwner,
    selectGroupTarget(groupId, auxIndex) {
      let target = null;
      try { const group = readGroup(groupId); target = Object.freeze({ kind: 'group', groupId: group.id, auxIndex }); selectedGroupSignature = JSON.stringify([groupOwner, group]); }
      catch { /* No group authority from caller data. */ }
      return select(target, 'Relative group selected; gesture uses current received members. Requested offsets do not prove hardware balance.');
    },
    selectLevelTarget(target) {
      let descriptor = null;
      try { auxLevelPath(target); descriptor = Object.freeze({ ...target }); } catch { /* Strict narrow descriptor only. */ }
      return select(descriptor, 'Level selected; drag or use keys to edit.');
    },
    armLevel: () => arm(false),
    disarmLevel() { cancelControl(); emit('controls'); },
    invalidateLevelContext() { cancelControl(); selected = null; },
    beginLevelGesture: () => begin('level'),
    previewLevelGesture: (token, value) => preview(token, value, 'level'),
    cancelLevelGesture() { if (model?.gesture && apiKind(selected) === 'level') { cancelControl('Adjustment cancelled; use a new gesture.'); emit('controls'); } },
    commitLevelGesture: (token, value) => commit(token, value, 'level'),
  };
  const panAPI = {
    selectPanTarget(target) {
      let descriptor = null;
      try { const path = auxPanPath(target), match = /^(.*)\.aux\.([0-9])\.pan$/.exec(path); descriptor = Object.freeze({ kind: 'pan', sourceId: match[1], auxIndex: Number(match[2]) }); } catch { /* Narrow pan only. */ }
      return select(descriptor, 'Pan selected; drag or use keys to edit. Positions are normalized numbers.');
    },
    armPan: () => arm(true),
    disarmPan() { if (selected?.kind === 'pan') { cancelControl('Pan adjustment cancelled; use a new gesture.'); emit('controls'); } },
    closePan() { if (selected?.kind === 'pan') { cancelControl(); selected = null; emit('controls'); } },
    beginPanGesture: () => begin('pan'),
    previewPanGesture: (token, value) => preview(token, value, 'pan'),
    commitPanGesture: token => commit(token, undefined, 'pan'),
    cancelPanGesture() { if (selected?.kind === 'pan' && model?.gesture) { cancelControl('Pan adjustment cancelled; use a new gesture.'); emit('controls'); } },
  };
  // AUX GEQ: only the selected output's 31 band peaks (62 for a verified equal
  // stereo pair). No bypass/filter/shelf/AFS/preset/main/input EQ capability.
  const eqAPI = {
    canEditEqTarget: auxIndex => canEditTarget({ kind: 'geq', auxIndex }),
    selectEqTarget(auxIndex) {
      let descriptor = null;
      try { auxEqPath({ auxIndex, bandIndex: 0 }); descriptor = Object.freeze({ kind: 'geq', auxIndex }); } catch { /* Narrow output index only. */ }
      return select(descriptor, 'AUX GEQ selected; drag a point or slider, or draw. Release applies every band of the selected output(s).');
    },
    closeEq() { if (selected?.kind === 'geq') { cancelControl(); selected = null; emit('controls'); } },
    beginEqGesture: () => begin('geq'),
    previewEqGesture: (token, intent) => previewEq(token, intent),
    commitEqGesture: token => commit(token, undefined, 'geq'),
    cancelEqGesture() { if (selected?.kind === 'geq' && model?.gesture) { cancelControl('EQ adjustment cancelled; use a new gesture.'); emit('controls'); } },
    // Scoped explicit reset: selected GEQ band peaks to .5 only, never native
    // resetGraphEQ (which also changes bypass, presets and filters).
    resetEqBands() {
      const token = begin('geq');
      if (!token || preview(token, Array(AUX_EQ_DISPLAY_CENTRES.length).fill(0.5), 'geq') === null) return false;
      return commit(token, undefined, 'geq');
    },
  };
  const snapshot = () => {
    if (socket) inspectCurrent(); // A read after sleep cannot resurrect old state before timers run.
    return { phase, detail, observations: provider.snapshot(), ...(auxControl ? { eq: new Map(eqObserved) } : {}), meterState: meterState(), meters: new Map(meters), meterRevision, ...(controlEnabled ? { control: controlSnapshot() } : {}) };
  };
  const emit = (kind = 'state') => { for (const listener of listeners) listener(snapshot(), kind); };
  const clearTimers = () => { timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearTimeout(receiverDeadline); timers.clearTimeout(receiverIdle); timers.clearInterval(keepalive); timers.clearTimeout(meterExpiry); timers.clearTimeout(meterFlush); meterFlush = undefined; };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    cancelControl('Received state cleared; connect explicitly.', 'disconnect'); selected = null; observed.clear(); receipts.clear(); eqObserved.clear(); processingRaw.clear(); sequence = 0;
    clearTimers();
    const old = socket, oldReceiver = receiver;
    socket = receiver = null;
    provider.clear(); meters = new Map(); meterStamp = null; meterRevision = 0;
    phase = next; detail = message;
    for (const connection of [old, oldReceiver]) if (connection) {
      connection.onopen = connection.onmessage = connection.onerror = connection.onclose = null;
      try { connection.close(); } catch { /* Already invalidated; never retry close or writes. */ }
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
    if (generation !== token) { try { current.close(); } catch { /* Retired constructor result. */ } return false; }
    socket = current;
    const active = () => generation === token && socket === current;
    const started = stamp();
    let lastActivity = started, receiverActivity = started, qualified = false, writerOpened = false;
    function responsive() {
      if (!active()) return false;
      if (controlEnabled && globalThis.document?.hidden === true) { stop('disconnected', 'App hidden — received state cleared; reconnect explicitly'); return false; }
      if (current.readyState > 1 || writerOpened && current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return false; }
      if (controlEnabled && receiver && receiver.readyState > 1) { stop('closed', 'Received-state connection closed; reconnect explicitly'); return false; }
      const currentTime = stamp(), age = elapsed(lastActivity, currentTime), receiverAge = elapsed(receiverActivity, currentTime), initial = elapsed(started, currentTime);
      if (controlEnabled && receiver && (invalidClock(receiverAge) || receiverAge.mono >= idleMs || receiverAge.wall > idleMs + clockGraceMs) || invalidClock(age) || age.mono >= idleMs || age.wall > idleMs + clockGraceMs ||
          ((!qualified || controlEnabled && !writerOpened) && (invalidClock(initial) || initial.mono >= timeoutMs || initial.wall > timeoutMs + clockGraceMs))) {
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
      writerOpened = true; if (qualified) timers.clearTimeout(deadline); phase = qualified ? 'live' : 'connected'; detail = qualified ? 'Received Ui24 AUX state · peer editing' : 'Socket connected — waiting for received Ui24 model and AUX state'; emit();
      if (!active() || current.readyState !== 1) return;
      try { current.send('3:::INIT'); } catch { failSend(); return; }
      if (!active()) return;
      touch();
      keepalive = timers.setInterval(() => {
        if (!responsive()) return;
        if (current.readyState !== 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
        try { current.send('3:::ALIVE'); if (receiver?.readyState === 1) receiver.send('3:::ALIVE'); } catch { failSend(); }
      }, 1000);
    };
    function receiveState(data) {
      if (!responsive()) return;
      if (current.readyState > 1) { stop('closed', 'Mixer socket is not open — received state cleared'); return; }
      if (typeof data !== 'string') return;
      const stateChanged = provider.receive(data);
      const controlsChanged = journal(data);
      const model = provider.model();
      if (model !== undefined && model !== 'ui24') { stop('unsupported', `Unsupported mixer model ${model} — Ui24 state is required`); return; }
      if (stateChanged) {
        if (provider.hasAuxLevel()) {
          qualified = true; if (!controlEnabled || writerOpened) timers.clearTimeout(deadline);
          phase = 'live'; detail = controlEnabled ? 'Received Ui24 AUX state · peer editing' : 'Received Ui24 AUX state · read-only';
        } else {
          phase = 'partial'; detail = model === 'ui24' ? 'Ui24 model received — partial AUX state; unknown fields remain unavailable' : 'Received observations — mixer model not verified';
        }
        emit();
        if (!active()) return;
      }
      if (!stateChanged && controlsChanged) { emit('controls'); if (!active()) return; }
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
    }
    current.onmessage = ({ data }) => {
      if (!responsive() || typeof data !== 'string') return;
      touch();
      if (data === '2::') { try { current.send('2::'); } catch { failSend(); } return; }
      // Control writers never populate actual state: their INIT may arrive late
      // and sender echoes are absent on observed firmware. One receiver owns it.
      if (!controlEnabled) receiveState(data);
    };
    current.onerror = () => { if (active()) stop('error', 'Mixer connection failed — reconnect explicitly'); };
    current.onclose = () => { if (active()) stop('closed', 'Mixer connection closed — received state cleared'); };
    if (controlEnabled) {
      let observer;
      try { observer = new WebSocketClass(url); }
      catch { stop('blocked', 'The browser could not open the received-state connection'); return false; }
      if (!active()) { try { observer.close(); } catch { /* Retired constructor result. */ } return false; }
      receiver = observer;
      const receiverActive = () => active() && receiver === observer;
      const touchReceiver = () => {
        receiverActivity = stamp(); timers.clearTimeout(receiverIdle);
        receiverIdle = timers.setTimeout(() => { if (receiverActive()) stop('timeout', 'Received-state connection became silent; reconnect explicitly'); }, idleMs);
      };
      receiverDeadline = timers.setTimeout(() => { if (receiverActive() && !qualified) stop('timeout', 'Received-state connection did not qualify; reconnect explicitly'); }, timeoutMs);
      observer.onopen = () => {
        if (!receiverActive() || !responsive()) return;
        try { observer.send('3:::INIT'); } catch { failSend(); return; }
        touchReceiver();
      };
      observer.onmessage = ({ data }) => {
        if (!receiverActive() || !responsive() || observer.readyState !== 1 || typeof data !== 'string') return;
        touchReceiver();
        if (data === '2::') { try { observer.send('2::'); } catch { failSend(); } return; }
        receiveState(data);
        if (qualified) timers.clearTimeout(receiverDeadline);
      };
      observer.onerror = () => { if (receiverActive()) stop('error', 'Received-state connection failed; reconnect explicitly'); };
      observer.onclose = () => { if (receiverActive()) stop('closed', 'Received-state connection closed; reconnect explicitly'); };
    }
    return true;
  }
  return Object.freeze({
    ...(controlEnabled ? controlAPI : {}),
    ...(auxControl ? panAPI : {}),
    ...(auxControl ? eqAPI : {}),
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
