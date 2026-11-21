import { mixerURL } from '../mixer-address.js';
import { createLiveProvider } from './live-provider.js';
import { decodeVu2Frame } from './meters.js';
import { IEM_RECEIVE_LIMITS, parseIemStateFrame } from './protocol.js';
import { createControlScope, createPeerControlState, transitionControl, OBSERVATION_WINDOW_MS, LIVE_STREAM_INTERVAL_MS, LIVE_SETD_BUDGET_PER_S, LIVE_BACKPRESSURE_BYTES } from './control-state-model.js';
import { auxPanPath, encodeAuxPanCommand, resolveAuxPanTopology } from './aux-pan-protocol.js';
import { validateSettings, validateDefinitionOwner, definitionOwner } from '../settings.js';
import { auxLevelPath, encodeAuxLevelCommand, resolveAuxLevelTopology } from './aux-level-protocol.js';
import { AUX_EQ_DISPLAY_CENTRES, AUX_EQ_FILTERS, auxEqFilterPath, auxEqPath, auxEqPositionToDb, encodeAuxEqCommand, encodeAuxEqFilterCommand, eqArray, eqDataFields, parseAuxEqStateFrame, parseAuxProcessingFrame, resolveAuxEqTopology } from './aux-eq-protocol.js';
import { mapRequestedAuxEqFilter } from './aux-eq-filter.js';
import { resolveGroupTopology, groupReferenceDelta, groupReferencePosition } from './relative-groups.js';
import { mapRequestedAuxEqCurve } from './aux-eq-curve.js';
import { checkShowName, checkSnapshotName, encodeSnapshotListCommand, encodeSnapshotRecallCommand, encodeSnapshotSaveCommand, isSnapshotInitEntry, parseSnapshotCompanionFrame, parseSnapshotWriterFrame } from './snapshot-protocol.js';
import { encodeRecordingToggleCommand, parseRecordingCompanionFrame, parseRecordingWriterFrame, recordingRefusalText } from './recording-protocol.js';

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
  // F02-S05: true only once the current writer socket has opened; with a
  // qualified companion this is full readiness (`qualified` in snapshots).
  let writerReady = false;
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
  let sequence = 0, revision = 0, selected = null, confirmation, model = null, stream = null;
  let controlStatus = 'Select a received control to edit.', groupOwner = null, selectedGroupSignature = null;
  // Only this owner constructs scopes and reducer events from its socket journal.
  // Neither pure scopes nor public snapshots are accepted as transport authority.
  const modelTime = () => { const t = stamp(); return { mono: Math.max(0, t.mono), wall: Math.max(0, t.wall) }; };
  let basisTimer, basisTimerAt = null;
  // F09-S11 review: `attention` marks an outcome that stopped a user's actual
  // intent (an active gesture or a pending/dispatching own send) or refused a
  // deliberate action. Classified by state transition, never by wording; routine
  // sent-unverified, selection changes and cancellations that stopped nothing
  // never set it. Cleared by the next gesture, selection, connection or restart.
  let attentionFlag = false;
  const STOPPED = new Set(['interrupted', 'native-invalidated', 'precision-or-native-conflict', 'reentrant-invalidated', 'clock-invalidated', 'dispatch-expired', 'topology-invalidated', 'membership-invalidated', 'profile-invalidated', 'processing-invalidated', 'cancel-invalidated', 'missing-invalidated']);
  const intentActive = m => Boolean(m && m.generation === generation && (m.gesture || m.operation && ['pending', 'dispatching'].includes(m.operation.status)));
  const step = event => {
    const intent = intentActive(model);
    model = transitionControl(model, { ...event, now: modelTime() }); scheduleBasisExpiry();
    if (intent && model && !model.gesture && !model.armed && STOPPED.has(model.status)) attentionFlag = true;
    else if (model?.gesture || ['select', 'new-generation'].includes(event.type)) attentionFlag = false;
  };
  // Re-render when the earliest bounded received-basis or own-echo wait ends,
  // so a missing desk echo never leaves controls blocked until another event.
  function scheduleBasisExpiry() {
    const starts = model?.peer ? [...model.basis.map(b => b.at.mono), ...model.echoes.map(e => e.values[0].at.mono)] : [];
    const at = starts.length ? Math.min(...starts) + OBSERVATION_WINDOW_MS : null;
    if (at === basisTimerAt) return;
    timers.clearTimeout(basisTimer); basisTimer = undefined; basisTimerAt = at;
    if (at === null) return;
    const owner = generation;
    basisTimer = timers.setTimeout(() => {
      basisTimer = undefined; basisTimerAt = null;
      if (generation !== owner || !model) return;
      inspectConfirmation(); emit('controls');
    }, Math.max(0, at - Math.max(0, now())));
  }
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
  const hasFilterMembers = scope => scope.members.some(x => x.target.filter !== undefined);
  function scope(target = selected) {
    if (!target) throw Error('Select an observed master or source send.');
    const kind = kindOf(target);
    if (kind === 'geq' && !auxControl) throw Error('AUX GEQ is unavailable in this session.');
    const group = kind === 'group' ? readGroup(target.groupId) : null;
    return createControlScope({ kind, received: observed, receipts,
      target: kind === 'pan' ? { sourceId: target.sourceId, auxIndex: target.auxIndex } : kind === 'group' || kind === 'geq' ? { auxIndex: target.auxIndex } : target,
      group: group ? { id: group.id, members: [...group.members] } : null });
  }
  // Topology-only closure check for an already-begun gesture: same identity,
  // paths, targets, model/mode/stereo metadata and canonical membership, without
  // requiring momentary received-value equality. Own live echoes of a linked
  // pair arrive as separate receipts; native value changes stop the gesture in
  // the reducer instead. Begin and non-live dispatch keep the full scope check.
  function topology(target = selected) {
    if (!target) throw Error('Select an observed master or source send.');
    const kind = kindOf(target);
    if (kind === 'geq' && !auxControl) throw Error('AUX GEQ is unavailable in this session.');
    if (kind === 'group') {
      const group = readGroup(target.groupId), resolved = resolveGroupTopology(observed, { id: group.id, members: [...group.members] }, target.auxIndex);
      return { identity: JSON.stringify([resolved.groupId, resolved.membership]), members: resolved.members };
    }
    if (kind === 'pan') { const pan = { sourceId: target.sourceId, auxIndex: target.auxIndex }; return { identity: JSON.stringify([kind, pan]), members: resolveAuxPanTopology(observed, pan).members }; }
    if (kind === 'geq') {
      // Topology only: link/mode/bypass metadata via the strict resolver; band
      // paths follow deterministically (31 per output) without per-band values.
      // F06-S05: the filter members follow the owned model scope (it decides
      // inclusion from received equality); a candidate without an owned scope
      // includes them whenever every filter path has been received.
      const eq = { auxIndex: target.auxIndex }, outputs = resolveAuxEqTopology(observed, eq).outputs, identity = JSON.stringify([kind, eq]);
      const bands = outputs.flatMap(({ auxIndex }) => AUX_EQ_DISPLAY_CENTRES.map((_, bandIndex) => ({ path: `a.${auxIndex}.eq.peak.${bandIndex}`, target: { auxIndex, bandIndex } })));
      const owned = model?.generation === generation && model.scope.kind === 'geq' && model.scope.identity === identity;
      const filters = AUX_EQ_FILTERS.flatMap(filter => outputs.map(({ auxIndex }) => ({ path: `a.${auxIndex}.eq.${filter}`, target: { auxIndex, filter } })));
      return { identity, members: owned ? hasFilterMembers(model.scope) ? [...bands, ...filters] : bands : filters.every(x => observed.has(x.path)) ? [...bands, ...filters] : bands };
    }
    return { identity: JSON.stringify([kind, target]), members: resolveAuxLevelTopology(observed, target).members };
  }
  const closureKey = members => JSON.stringify(members.map(x => [x.path, x.target])), scopeKeys = new WeakMap();
  const scopeKey = scope => { if (!scopeKeys.has(scope)) scopeKeys.set(scope, closureKey(scope.members)); return scopeKeys.get(scope); };
  const sameClosure = (current, scope) => current.identity === scope.identity && current.members.length === scope.members.length && closureKey(current.members) === scopeKey(scope);
  const gestureOwned = () => Boolean(model?.gesture && model.generation === generation && model.armed && model.scopeCurrent);
  function cancelStream() { if (stream?.timer !== undefined) timers.clearTimeout(stream.timer); stream = null; }
  function installScope() {
    const current = scope();
    if (!model) model = createPeerControlState({ scope: current, generation, revision: ++revision, now: modelTime() });
    else if (model.generation !== generation) step({ type: 'new-generation', scope: current, generation, revision: ++revision });
    else step({ type: 'select', scope: current, revision: ++revision });
  }
  function cancelControl(message = 'Adjustment cancelled; use a new gesture.', reason = 'cancel', refused = false) {
    revision++; cancelStream();
    if (model) step({ type: 'invalidate', reason, revision });
    timers.clearTimeout(confirmation); controlStatus = message;
    if (refused) attentionFlag = true; // A deliberate action was refused: say why.
  }
  function inspectConfirmation() { if (model) step({ type: 'tick' }); }
  // Current owned GEQ outputs, from the private model scope only.
  const eqOutputs = () => selected?.kind === 'geq' && model?.generation === generation && model.scope.kind === 'geq' ? [...new Set(model.scope.members.map(x => x.target.auxIndex))] : [];
  const eqValues = rows => rows.slice(0, AUX_EQ_DISPLAY_CENTRES.length).map(x => x.value);
  // F06-S05 filter rows (hpf, lpf of the first output; pairs are equal by scope).
  const eqFilterValues = rows => { const hpf = rows.find(x => x.target.filter === 'hpf'), lpf = rows.find(x => x.target.filter === 'lpf'); return hpf && lpf ? [hpf.value, lpf.value] : null; };
  // Groups always, and GEQ whenever it would re-arm from received state (no
  // retained same-scope chain), wait for every overlapping prior local write's
  // paths to be received after their preauthorization cutpoints.
  function basisBlocks(kind, members, identity) {
    if (model?.generation !== generation || !['group', 'geq'].includes(kind)) return false;
    if (kind === 'geq' && model.armed && model.chain && model.scopeCurrent && model.scope.kind === 'geq' && model.scope.identity === identity) return false;
    // F09-S05: a group never re-anchors while own live echoes are outstanding.
    if (kind === 'group' && model.echoes.some(e => members.some(x => x.path === e.path))) return true;
    return model.basis.some(b => b.members.some(m => members.some(x => x.path === m.path)) && b.members.some(m => (receipts.get(m.path) ?? 0) <= m.floor));
  }
  function syncGroupSelection() {
    if (selected?.kind !== 'group') return;
    try { if (JSON.stringify([groupOwner, readGroup(selected.groupId)]) === selectedGroupSignature) return; }
    catch { /* Missing canonical definitions revoke permission too. */ }
    cancelControl('Local group definition changed; select the current group.', 'membership'); selected = null; selectedGroupSignature = null;
  }
  const activeOperation = () => model?.generation === generation || ['error', 'closed', 'timeout'].includes(phase) ? model?.operation : null;
  // F09-S06: a bounded received-basis wait expired without the desk reporting
  // the last written value(s); its reported values are used as actual.
  const UNCONFIRMED_NOTE = 'The desk did not report the last change within 2.5 s; MixMate is using the desk\u2019s reported values. ';
  function statusText(ready = false) {
    const op = activeOperation();
    if (gestureOwned()) return controlStatus;
    const note = model?.generation === generation && model.unconfirmed ? UNCONFIRMED_NOTE : '';
    if (model?.status === 'pending') return 'Waiting for fresh observations; application unverified.';
    if (model?.status === 'sent-unverified') return `${note}Sent; application unverified. Requested coordinate retained; no retry. Some values may have changed.`;
    if (model?.status === 'observed-match') return `${selected?.kind === 'group' ? `Last requested gesture Δ ${model.chain?.delta.toFixed(2)} dB; ` : ''}Observed matching values${op?.rounded ? ' (desk-rounded to 10 significant digits)' : ''}; no correlated acknowledgement.`;
    if (model?.status === 'no-op') return 'Unchanged requested coordinate; no commands sent.';
    if (model && !model.armed) {
      if (ready) return `${note}Ready to edit current received state. ${op?.authorized ? `Previous adjustment returned ${op.returned}/${op.authorized} authorized${op.authorized < op.expected.length ? ` of ${op.expected.length} planned` : ''}${op.unknownDelivery ? '; throwing send delivery unknown' : ''}; application unverified.${op.live ? ' Values already sent live while dragging stay applied; no rollback.' : ''}` : 'Obsolete preview cancelled.'}`;
      const reasons = {
        'precision-or-native-conflict': 'Received value differs from the request; precision or native change is unknown.',
        'native-invalidated': 'Received control value changed; the next gesture uses current state.',
        'reentrant-invalidated': 'Received state during dispatch interrupted the adjustment; obsolete adjustment cancelled.',
        'clock-invalidated': 'Clock changed; obsolete adjustment cancelled.',
        'dispatch-expired': 'Dispatch deadline elapsed; obsolete adjustment cancelled.',
        'interrupted': 'Adjustment interrupted; obsolete adjustment cancelled.',
      };
      // Cancel/Escape/pointercancel/focus loss after live steps no longer means
      // nothing was sent: say the streamed values stay applied.
      const reason = `${reasons[model.status] ?? controlStatus}${op?.live ? ' Values already sent live while dragging stay applied; no rollback.' : ''}`;
      if (op?.authorized) return `${reason} Returned ${op.returned}/${op.authorized} authorized${op.authorized < op.expected.length ? ` of ${op.expected.length} planned` : ''}${op.unknownDelivery ? '; throwing send delivery unknown' : ''}; some values may have changed. Waiting for complete current received state; no replay.`;
      return reason;
    }
    return controlStatus;
  }
  function controlSnapshot() {
    syncGroupSelection(); inspectConfirmation();
    let eligible = false, groupName, reason = 'Select an observed master or source send.';
    if (selected && gestureOwned()) {
      // The active gesture's own target stays editable while its live echoes
      // arrive; native/context changes end the gesture instead.
      try {
        topology(); if (selected.kind === 'group') groupName = readGroup(selected.groupId).name;
        eligible = socket?.readyState === 1 && receiver?.readyState === 1; reason = eligible ? '' : 'Both owned connections must be open.';
      } catch (error) { reason = error.message; }
    } else if (selected) {
      try {
        const currentScope = scope(); if (selected.kind === 'group') groupName = readGroup(selected.groupId).name;
        const blocked = model?.generation === generation && model.barriers.some(b => b.generation === generation && b.closure.some(path => currentScope.members.some(m => m.path === path)) && (receipts.get(b.path) ?? 0) <= b.floor);
        const basisBlocked = basisBlocks(kindOf(selected), currentScope.members, currentScope.identity);
        eligible = socket?.readyState === 1 && receiver?.readyState === 1 && !blocked && !basisBlocked;
        reason = blocked ? 'Waiting for complete post-interruption received state.' : basisBlocked ? selected.kind === 'geq' ? 'Waiting up to 2.5 s for the desk to report the last EQ change before editing from received bands.' : 'Waiting up to 2.5 s for the desk to report the last group change.' : eligible ? '' : 'Both owned connections must be open.';
      } catch (error) { reason = error.message; }
    }
    const owned = model?.generation === generation, op = activeOperation(), chain = owned ? model.chain : null, preview = owned ? model.gesture?.preview : null;
    const eqSelected = selected?.kind === 'geq' && owned && model.scope.kind === 'geq';
    // Group live preview: requested common-delta member values (distinct from
    // received actual) and the requested loudest-member reference position.
    const groupLive = selected?.kind === 'group' && owned && model.scope.kind === 'group' && chain?.anchor && (model.gesture || ['pending', 'dispatching'].includes(op?.status));
    return { ...(auxControl ? { panCapable: true, eqCapable: true, operation: apiKind(selected), previewPan: selected?.kind === 'geq' ? undefined : preview?.expected[0]?.value, expectedPan: selected?.kind === 'pan' ? chain?.requested[0]?.value ?? null : null } : {}),
      ...(selected?.kind === 'geq' ? { eqRequested: eqSelected && preview ? eqValues(preview.expected) : eqSelected && chain?.touched ? eqValues(chain.requested) : null, eqCoordinate: eqSelected && chain ? eqValues(chain.requested) : null,
        // F06-S05: requested/retained filter positions [hpf, lpf]; null when the owned scope has no filters (unreceived/unequal: read-only).
        eqFilters: eqSelected && hasFilterMembers(model.scope) ? { requested: eqFilterValues(preview ? preview.expected : chain?.requested ?? []) , coordinate: chain ? eqFilterValues(chain.requested) : null } : null } : {}),
      ...(groupName ? { groupName } : {}), selected: selected ? { ...selected } : null, eligible, reason,
      armed: Boolean(owned && model.armed), gestureActive: Boolean(owned && model.gesture), pending: Boolean(owned && ['pending', 'dispatching'].includes(op?.status)), dispatching: Boolean(owned && op?.status === 'dispatching'),
      requestedDiagnostic: op?.expected.map(({ path, value }) => ({ path, value })) ?? [], status: statusText(eligible), attention: attentionFlag ? statusText(eligible) : '', outcome: owned ? model.status : 'idle', previewDelta: preview?.gestureDelta ?? 0, lastDelta: chain?.delta ?? op?.delta ?? null,
      requestedValue: chain && !['group', 'geq'].includes(selected?.kind) ? preview?.expected[0]?.value ?? chain.requested[0]?.value : null,
      groupReference: groupLive ? groupReferencePosition({ members: chain.anchor }, preview?.delta ?? chain.delta) : null,
      groupRequested: groupLive ? (preview?.expected ?? chain.requested).map(x => ({ sourceId: x.target.sourceId, auxIndex: x.target.auxIndex, value: x.value })) : null,
      live: Boolean(owned && model.gesture?.streamed),
      dispatched: op?.returned ?? 0, authorized: op?.authorized ?? 0, unknownDelivery: op?.unknownDelivery ?? false };
  }
  function journal(frame) {
    if (!controlEnabled) return;
    inspectConfirmation();
    let controlsChanged = false;
    if (auxControl) { const snapshotsChanged = noteSnapshotCompanion(frame), recordingChanged = noteRecordingCompanion(frame); controlsChanged = snapshotsChanged || recordingChanged; }
    const updates = parseIemStateFrame(frame);
    // Separate bounded GEQ parser: 31 bands plus read-only bypass per output.
    if (auxControl) for (const update of parseAuxEqStateFrame(frame)) updates.push({ path: update.path, value: update.value, auxIndex: update.auxIndex, field: update.field === 'bypass' ? 'eqBypass' : update.field === 'filter' ? 'eqFilter' : 'eqBand' });
    for (const { path, value, field, auxIndex } of updates) {
      const actual = !observed.has(path) || observed.get(path) !== value;
      // F02-S05: a desk snapshot recall changes the rig context; the socket stays.
      if (actual && field === 'currentSnapshot' && observed.has(path)) { cancelControl('Desk snapshot changed; obsolete adjustment cancelled.', 'profile'); selected = null; }
      observed.set(path, value); receipts.set(path, ++sequence);
      if (field === 'currentSnapshot' && auxControl && snapshotRecallSeen(value)) controlsChanged = true;
      if (dispatchWatch?.paths.has(path)) dispatchWatch.hit = true;
      if (field === 'eqBand' || field === 'eqBypass' || field === 'eqFilter') { eqObserved.set(path, value); controlsChanged = true; }
      // F06-S05: a changed filter outside the owned scope (unreceived/unequal
      // pair) cannot be classified by the reducer; it cancels obsolete intent so
      // the next gesture rebuilds its scope. Inside the scope the reducer decides
      // (own echo vs native change).
      if (actual && field === 'eqFilter' && eqOutputs().includes(auxIndex) && !model.scope.members.some(member => member.path === path)) cancelControl('Received EQ filter changed; obsolete EQ adjustment cancelled.', 'processing');
      if (actual && field === 'eqBypass' && eqOutputs().includes(auxIndex)) cancelControl('Received GEQ bypass changed; obsolete EQ adjustment cancelled.', 'processing');
      if (actual && ['model', 'matrix', 'stereoIndex'].includes(field)) cancelControl('Received topology changed; obsolete adjustment cancelled.', 'topology');
      if (actual && ['mute', 'post', 'postproc'].includes(field) && model?.generation === generation && model.scope.members.some(({ target }) =>
        path.startsWith(`a.${target.auxIndex}.`) || target.sourceId && (path === `${target.sourceId}.mute` || path.startsWith(`${target.sourceId}.aux.${target.auxIndex}.`)))) {
        cancelControl('Received processing context changed; obsolete adjustment cancelled.', 'processing');
      }
      if (model?.generation === generation && (field === 'level' || field === 'pan' || field === 'eqBand' || field === 'eqFilter')) { step({ type: 'receive', generation, path, value, receipt: sequence }); controlsChanged = true; }
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
  function revalidate(values = true) {
    if (!canAct() || !selected || !model?.armed || model.generation !== generation || !model.scopeCurrent) throw Error('Current owner revoked.');
    if (!sameClosure(values ? scope() : topology(), model.scope)) throw Error('Current typed closure changed.');
  }
  // Deliberate narrow typed allowlist: the private scope kind chooses exactly one
  // existing serializer; each validates its own strict path/type/range. GEQ is
  // only band peaks of the resolved selected output closure, full precision.
  function serialize(op, ordinal) {
    const item = op.expected[ordinal], command = { ...item.target, value: item.value }, kind = op.scope.kind;
    if (kind !== kindOf(selected)) throw Error('Typed closure kind changed.');
    if (kind === 'geq') {
      if (!auxControl) throw Error('Unqualified GEQ form.');
      if (item.target.filter !== undefined) { if (auxEqFilterPath(item.target) !== item.path) throw Error('Unqualified EQ filter form.'); return encodeAuxEqFilterCommand(command); }
      if (auxEqPath(item.target) !== item.path) throw Error('Unqualified GEQ form.');
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
    dispatchWatch = { paths: new Set([...op.expected.map(x => x.path), ...(op.scope.kind === 'geq' ? outputs.flatMap(index => [`a.${index}.eq.bypass`, ...AUX_EQ_FILTERS.map(filter => `a.${index}.eq.${filter}`)]) : [])]), hit: false };
    try { return dispatchOrdinals(op); } finally { dispatchWatch = null; }
  }
  function dispatchOrdinals(op) {
    const current = socket, currentReceiver = receiver, ownerGeneration = generation;
    for (let ordinal = 0; ordinal < op.expected.length; ordinal++) {
      try {
        revalidate(!op.live);
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
    cancelStream();
    try {
      if (!controlSnapshot().eligible) return null;
      if (selected.kind === 'group' || !model?.armed || !model.scopeCurrent || model.generation !== generation) {
        installScope(); step({ type: 'arm' });
      }
      revalidate(); step({ type: 'begin' }); const token = model.gesture.token;
      controlStatus = kind === 'geq' ? 'Live: changed GEQ bands are sent while you drag (throttled); release sends the final curve. Received band values remain distinct.'
        : 'Live: changes are sent while you drag (throttled); release sends the final value. Last received values remain distinct.';
      emit('controls'); return model.gesture?.token === token && model.armed ? token : null;
    } catch (error) { cancelControl(error.message, 'cancel', true); emit('controls'); return null; }
  }
  // Throttled live streaming (F09-S05): leading step immediately, then at most
  // one step per interval carrying the LATEST cached preview (no queue). Each
  // step goes through the same private reducer authorization and per-ordinal
  // dispatch guard as a release commit. Only an owned deliberate gesture's
  // preview schedules a step; receipts, scroll and selection never do.
  // SETD budget (P2): the next step waits at least the kind's interval AND the
  // time the previous step's path count spends at the kind's SETD/s budget.
  const streamGap = () => { const kind = kindOf(selected); return Math.max(LIVE_STREAM_INTERVAL_MS[kind], stream.lastPaths * 1000 / LIVE_SETD_BUDGET_PER_S[kind]); };
  function scheduleStream(token) {
    if (stream?.token !== token) { cancelStream(); stream = { token, timer: undefined, lastAt: -Infinity, lastPaths: 0 }; }
    if (stream.timer !== undefined) return;
    const gap = streamGap(), wait = Math.min(gap, stream.lastAt + gap - now());
    if (!(wait > 0)) { streamStep(token); return; }
    deferStream(token, wait);
  }
  function deferStream(token, wait) {
    const current = stream;
    current.timer = timers.setTimeout(() => { if (stream !== current) return; current.timer = undefined; streamStep(token); }, wait);
  }
  function streamStep(token) {
    if (stream?.token !== token || !canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || !model.gesture.preview || activeOperation()?.status === 'dispatching') return;
    // Backpressure: while the writer still buffers unsent data, defer the step
    // (the latest preview is kept; release still sends the final value).
    if ((Number(socket.bufferedAmount) || 0) > LIVE_BACKPRESSURE_BYTES) { deferStream(token, streamGap()); return; }
    const before = model.operation?.id;
    try { revalidate(false); step({ type: 'stream', token }); }
    catch (error) { cancelControl(error.message, 'cancel', true); emit('controls'); return; }
    if (model.operation?.id === before || model.operation?.status !== 'dispatching') return; // Unchanged preview: nothing to send.
    stream.lastAt = now(); stream.lastPaths = model.operation.expected.length;
    dispatch();
  }
  function preview(token, value, kind, live = true) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || apiKind(selected) !== kind) return null;
    try {
      revalidate(false);
      const group = selected.kind === 'group';
      // Group intent is the loudest member's requested fader position; the
      // owner converts it to one common clamped delta against the frozen anchor.
      step({ type: 'preview', token, value: group ? groupReferenceDelta({ members: model.chain.anchor }, value) - model.gesture.baseDelta : value });
      const result = group ? groupReferencePosition({ members: model.chain.anchor }, model.gesture.preview.delta) : kind === 'geq' ? eqValues(model.gesture.preview.expected) : model.gesture.preview.expected[0].value;
      if (live) scheduleStream(token);
      return model?.gesture?.token === token ? result : null;
    } catch (error) { cancelControl(error.message, 'cancel', true); emit('controls'); return null; }
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
      controlStatus = 'Requested curve rejected (outside ±15 dB or invalid); not clipped. The last valid preview is kept and stays live.';
      emit('controls'); return null;
    }
    // A drawn or relative-point band identical to the gesture-start coordinate
    // keeps that exact coordinate instead of a dB round trip, so unedited bands
    // stay unchanged and an all-zero adjustment is a no-op.
    if (request.samples.length === AUX_EQ_DISPLAY_CENTRES.length && request.samples.every((sample, index) => sample.frequencyHz === AUX_EQ_DISPLAY_CENTRES[index])) {
      const seed = eqValues(model.gesture.origin);
      request.samples.forEach((sample, index) => { if (sample.gainDb === auxEqPositionToDb(seed[index])) values[index] = seed[index]; });
    }
    // F06-S05: a band intent keeps the gesture-start filter positions.
    if (hasFilterMembers(model.scope)) values.push(...eqFilterValues(model.gesture.origin));
    return preview(token, values, 'geq');
  }
  // F06-S05 filter intent: exactly { filter: 'hpf'|'lpf', enabled, value }. The
  // private owner clamps it (never off while enabled, hpf < lpf by a gap), keeps
  // every band at the gesture-start coordinate and sends only changed filter
  // paths through the same per-ordinal guard. Never caller paths or raw arrays.
  function previewEqFilter(token, intent, live = true) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || selected?.kind !== 'geq' || model.scope.kind !== 'geq') return null;
    if (!hasFilterMembers(model.scope)) { controlStatus = 'EQ filters are read-only: not received or the two sides differ.'; emit('controls'); return null; }
    let mapped;
    const [hpf, lpf] = eqFilterValues(model.gesture.origin);
    try { mapped = mapRequestedAuxEqFilter(intent, { hpf, lpf }); }
    catch (error) { controlStatus = `EQ filter request rejected: ${error.message}`; emit('controls'); return null; }
    const filters = mapped.filter === 'hpf' ? [mapped.value, lpf] : [hpf, mapped.value];
    if (preview(token, [...eqValues(model.gesture.origin), ...filters], 'geq', live) === null) return null;
    return mapped;
  }
  function commit(token, value, kind) {
    if (!canAct() || !model?.gesture || model.gesture.token !== token || !model.armed || apiKind(selected) !== kind) return false;
    if (typeof value !== 'number' && kind === 'level' && selected.kind !== 'group') return false;
    cancelStream(); // The release carries the latest preview itself.
    try {
      revalidate(false);
      if (kind === 'level' && selected.kind !== 'group') { if (preview(token, value, 'level', false) === null) return false; }
      if (!model.gesture?.preview) return false;
      const streamed = model.gesture.streamed;
      const before = model.operation?.id;
      step({ type: 'commit', token });
      // The final release write's own outcome; an unchanged streamed release
      // needs no write and reports true (its live steps already returned).
      if (model.operation?.id !== before && model.operation?.status === 'dispatching') return dispatch();
      emit('controls'); return streamed;
    } catch (error) { cancelControl(error.message, 'cancel', true); emit('controls'); return false; }
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
      // The active gesture's own target stays editable while its live echoes land.
      if (gestureOwned() && sameClosure(topology(target), model.scope)) return activeOperation()?.status !== 'dispatching';
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
  // AUX GEQ: the selected output's 31 band peaks plus (F06-S05) its hpf/lpf
  // filter positions (both sides of a verified equal pair; 62 / 4 paths). No
  // bypass/slope/shelf/AFS/preset/main-mix (m.*)/input EQ capability.
  const eqAPI = {
    canEditEqTarget: auxIndex => canEditTarget({ kind: 'geq', auxIndex }),
    selectEqTarget(auxIndex) {
      let descriptor = null;
      try { auxEqPath({ auxIndex, bandIndex: 0 }); descriptor = Object.freeze({ kind: 'geq', auxIndex }); } catch { /* Narrow output index only. */ }
      return select(descriptor, 'AUX GEQ selected; drag a point or slider, or draw. Changed bands of the selected output(s) are sent live while you drag.');
    },
    closeEq() { if (selected?.kind === 'geq') { cancelControl(); selected = null; emit('controls'); } },
    beginEqGesture: () => begin('geq'),
    previewEqGesture: (token, intent) => previewEq(token, intent),
    commitEqGesture: token => commit(token, undefined, 'geq'),
    cancelEqGesture() { if (selected?.kind === 'geq' && model?.gesture) { cancelControl('EQ adjustment cancelled; use a new gesture.'); emit('controls'); } },
    // Scoped explicit reset: selected GEQ band peaks to .5 only, never native
    // resetGraphEQ (which also changes bypass, presets and filters).
    // F06-S05 (user decision 2026-11-21, following native resetGraphEQ and the
    // Demo): the same immediate one-shot also turns both cuts off (hpf 0, lpf 1)
    // when the filters are in the owned scope. Still no bypass/preset writes.
    resetEqBands() {
      const token = begin('geq');
      // Confirmed one-shot: never streamed.
      if (!token || preview(token, [...Array(AUX_EQ_DISPLAY_CENTRES.length).fill(0.5), ...(hasFilterMembers(model.scope) ? [0, 1] : [])], 'geq', false) === null) return false;
      return commit(token, undefined, 'geq');
    },
    previewEqFilterGesture: (token, intent) => previewEqFilter(token, intent),
    // Deliberate one-shot toggle/set of one filter (Low cut / High cut button).
    setEqFilter(intent) {
      const token = begin('geq');
      if (!token) return false;
      if (previewEqFilter(token, intent, false) === null) { cancelControl(controlStatus, 'cancel', true); emit('controls'); return false; }
      return commit(token, undefined, 'geq');
    },
  };
  // F07-S01 snapshot owner (createAuxControlSession only; docs/iem-snapshot-contract.md,
  // ADR-0009). Typed list / recall / save-current on the writer socket, never
  // caller strings. List replies and MSG^$SNAPLOAD arrive on the writer socket
  // only and feed this state, never mixer observations; the companion supplies
  // var.currentShow/var.currentSnapshot, lock settings and UPDATE_SHOWS. The
  // lock password value is reduced to "is set" at parse time and never stored.
  const SNAPSHOT_WAIT_MS = Object.freeze({ list: 5000, recall: 5000, save: 3000 });
  const freshSnapshots = () => ({ show: null, passSet: null, loadshows: null, shows: null, list: null, request: null, op: null });
  let sn = freshSnapshots(), snLast = null;
  const snapshotRefusal = (code, reason) => Object.freeze({ ok: false, code, reason });
  function settleSnapshotOp(op, status) {
    if (sn.op !== op || op.status !== 'pending') return false;
    timers.clearTimeout(op.timer); op.timer = undefined; op.status = status; return true;
  }
  function noteSnapshotCompanion(frame) {
    const found = parseSnapshotCompanionFrame(frame);
    let changed = false;
    if (found.show !== undefined && found.show !== sn.show) { sn.show = found.show; sn.list = null; timers.clearTimeout(sn.request?.timer); sn.request = null; changed = true; }
    for (const key of ['passSet', 'loadshows', 'shows']) if (found[key] !== undefined && found[key] !== sn[key]) { sn[key] = found[key]; changed = true; }
    if (found.updateShows) {
      // A show/snapshot change invalidates the list; a reply already in flight
      // may predate the change, so it is stored stale.
      if (sn.list && !sn.list.stale) { sn.list = Object.freeze({ ...sn.list, stale: true }); changed = true; }
      if (sn.request) sn.request.dirty = true;
      if (sn.op?.kind === 'save' && settleSnapshotOp(sn.op, 'reported')) changed = true;
    }
    return changed;
  }
  function snapshotRecallSeen(name) {
    return sn.op?.kind === 'recall' && sn.op.name === name && settleSnapshotOp(sn.op, 'confirmed');
  }
  function receiveWriterSnapshot(data) {
    let changed = false;
    for (const event of parseSnapshotWriterFrame(data)) {
      if (event.type === 'list') {
        if (!sn.request || event.show !== sn.show) continue;
        timers.clearTimeout(sn.request.timer);
        sn.list = Object.freeze({ show: event.show, names: event.names, truncated: event.truncated, stale: Boolean(sn.request.dirty) });
        sn.request = null; changed = true;
      } else if (sn.op?.kind === 'recall' && sn.op.name === event.name && settleSnapshotOp(sn.op, 'confirmed')) changed = true;
    }
    return changed;
  }
  function resetSnapshots() {
    timers.clearTimeout(sn.request?.timer); timers.clearTimeout(sn.op?.timer);
    // Only an outcome that was still outstanding survives a stop, as unknown.
    snLast = sn.op?.status === 'pending' ? Object.freeze({ kind: sn.op.kind, name: sn.op.name, status: 'unknown' }) : null;
    sn = freshSnapshots();
  }
  const lockState = () => {
    const gate = flag => sn.passSet === null ? 'unknown' : !sn.passSet ? 'allowed' : sn[flag] === null ? 'unknown' : sn[flag] ? 'allowed' : 'locked';
    return { recall: gate('loadshows'), save: gate('shows') };
  };
  // Shared preconditions, revalidated immediately before every send. Refuse
  // with a reason; never cancel the user's drag or queue for later.
  function snapshotPreflight(mutating) {
    if (!canAct() || phase !== 'live' || !writerReady) return snapshotRefusal('not-ready', 'Not connected to the desk.');
    if (!checkShowName(sn.show).ok) return snapshotRefusal('no-show', 'The desk’s current show has not been received.');
    const owned = model?.generation === generation;
    if (dispatchWatch || owned && (model.gesture || model.operation?.status === 'dispatching')) return snapshotRefusal('gesture', 'A control adjustment is in progress.');
    if (!mutating) return null;
    if (intentActive(model)) return snapshotRefusal('pending', 'Waiting for the desk to report the last control change; try again shortly.');
    if (sn.op?.status === 'pending') return snapshotRefusal('busy', 'A snapshot operation is already waiting for the desk.');
    if (!sn.list || sn.list.show !== sn.show) return snapshotRefusal('no-list', 'The snapshot list has not been received.');
    if (sn.list.stale) return snapshotRefusal('stale-list', 'The desk changed its shows; refresh the snapshot list first.');
    return null;
  }
  // The one non-parameter send site: only the typed snapshot encoders (F07-S01)
  // and the recording toggle encoder (F07-S03) reach it, never caller text.
  function sendTypedMessage(message) {
    try { socket.send(message); return true; }
    catch { stop('error', 'Connection send failed — received state cleared'); return false; }
  }
  function startSnapshotOp(kind, name, message) {
    const op = { kind, name, status: 'pending', timer: undefined };
    sn.op = op; snLast = null;
    if (!sendTypedMessage(message)) return snapshotRefusal('send-failed', 'Connection send failed; the outcome is unknown. No retry.');
    // A synchronous reply or stop during send already settled or replaced op.
    if (sn.op === op && op.status === 'pending') {
      const owner = generation;
      op.timer = timers.setTimeout(() => { if (generation === owner && settleSnapshotOp(op, 'unconfirmed')) emit('controls'); }, SNAPSHOT_WAIT_MS[kind]);
    }
    emit('controls');
    return Object.freeze({ ok: true, kind, name });
  }
  const lockRefusal = lock => snapshotRefusal(lock === 'locked' ? 'locked' : 'lock-unknown', lock === 'locked' ? 'Locked on the desk.' : 'The desk’s lock settings have not been received.');
  const snapshotAPI = {
    requestSnapshotList() {
      const refused = snapshotPreflight(false);
      if (refused) return refused;
      if (sn.request) return snapshotRefusal('busy', 'A snapshot list request is already waiting for the desk.');
      const message = encodeSnapshotListCommand(sn.show), owner = generation, request = { timer: undefined, dirty: false };
      sn.request = request;
      if (!sendTypedMessage(message)) return snapshotRefusal('send-failed', 'Connection send failed.');
      if (sn.request === request) request.timer = timers.setTimeout(() => { if (generation === owner && sn.request === request) { sn.request = null; emit('controls'); } }, SNAPSHOT_WAIT_MS.list);
      emit('controls');
      return Object.freeze({ ok: true, kind: 'list' });
    },
    recallSnapshot(name) {
      const refused = snapshotPreflight(true);
      if (refused) return refused;
      const shape = checkSnapshotName(name);
      if (!shape.ok) return snapshotRefusal('invalid-name', shape.reason);
      if (isSnapshotInitEntry(name)) return snapshotRefusal('init-entry', 'The desk Init entry cannot be recalled from MixMate.');
      if (!sn.list.names.includes(name)) return snapshotRefusal('not-in-list', 'That snapshot is not in the desk’s list.');
      const lock = lockState().recall;
      if (lock !== 'allowed') return lockRefusal(lock);
      return startSnapshotOp('recall', name, encodeSnapshotRecallCommand(sn.show, name));
    },
    // Updates the desk's received current snapshot only; never a new name.
    saveCurrentSnapshot() {
      const refused = snapshotPreflight(true);
      if (refused) return refused;
      const name = observed.get('var.currentSnapshot');
      if (typeof name !== 'string' || !checkSnapshotName(name).ok) return snapshotRefusal('no-current', 'The desk’s current snapshot name has not been received.');
      if (isSnapshotInitEntry(name)) return snapshotRefusal('init-entry', 'The desk Init entry cannot be saved from MixMate.');
      if (!sn.list.names.includes(name)) return snapshotRefusal('not-in-list', 'The current snapshot is not in the desk’s list.');
      const lock = lockState().save;
      if (lock !== 'allowed') return lockRefusal(lock);
      return startSnapshotOp('save', name, encodeSnapshotSaveCommand(sn.show, name));
    },
  };
  const OUTCOME_TEXT = {
    recall: { pending: 'Recall sent; waiting for the desk to report it.', confirmed: 'The desk reported the snapshot loaded.', unconfirmed: 'Recall sent; the desk did not report it within 5 s. Check the desk before relying on it.', unknown: 'The connection ended while a recall was outstanding; the outcome is unknown. No retry.' },
    save: { pending: 'Save sent; waiting for the desk to report a show change.', reported: 'The desk reported a show change after the save. This does not prove the snapshot contents were written.', unconfirmed: 'Save sent; the desk did not report a show change within 3 s.', unknown: 'The connection ended while a save was outstanding; the outcome is unknown. No retry.' },
  };
  const publicOperation = op => op ? Object.freeze({ kind: op.kind, name: op.name, status: op.status, text: OUTCOME_TEXT[op.kind][op.status] }) : null;
  function snapshotsSnapshot() {
    const pending = Boolean(sn.request), list = sn.list, current = observed.get('var.currentSnapshot');
    return Object.freeze({
      show: checkShowName(sn.show).ok ? sn.show : null,
      current: typeof current === 'string' ? current : null,
      list: Object.freeze({ status: pending ? 'pending' : list ? list.stale ? 'stale' : 'fresh' : 'none', show: list?.show ?? null, truncated: Boolean(list?.truncated),
        names: Object.freeze(list ? list.names.filter(name => !isSnapshotInitEntry(name)) : []) }),
      operation: publicOperation(sn.op ?? snLast),
      lock: Object.freeze(lockState()),
    });
  }
  // F07-S03 multitrack recording owner (createAuxControlSession only;
  // docs/iem-recording-contract.md, ADR-0011). The one permitted form is the
  // toggle encoder in recording-protocol.js. It is a toggle, never sent blind: start only when
  // the received `var.mtk.rec.currentState` is exactly 0, stop only when it is
  // received and non-zero. Companion `var.mtk.*` values and the writer's
  // requester-only `REC_ERR*` refusal feed only this state, never mixer
  // observations. No retry, queue or replay; elapsed time is the desk's own
  // received `var.mtk.rec.time`, shown only while recording.
  const RECORDING_WAIT_MS = 5000;
  const freshRecording = () => ({ present: null, freespace: null, dropouts: null, state: null, time: null, busy: null, session: null, player: null, op: null });
  let rc = freshRecording(), rcLast = null;
  const recordingRefusal = (code, reason) => Object.freeze({ ok: false, code, reason });
  function settleRecordingOp(op, status, code) {
    if (rc.op !== op || op.status !== 'pending') return false;
    timers.clearTimeout(op.timer); op.timer = undefined; op.status = status; if (code) op.code = code; return true;
  }
  function noteRecordingCompanion(frame) {
    const found = parseRecordingCompanionFrame(frame);
    let changed = false;
    for (const key of ['present', 'freespace', 'dropouts', 'state', 'busy', 'session', 'player']) if (found[key] !== undefined && found[key] !== rc[key]) { rc[key] = found[key]; changed = true; }
    // The desk counts rec.time up while stopped: a time-only change matters only while recording.
    if (found.time !== undefined && found.time !== rc.time) { rc.time = found.time; if (rc.state !== null && rc.state !== 0) changed = true; }
    const op = rc.op;
    if (found.state !== undefined && op?.status === 'pending' && (op.kind === 'start' ? rc.state !== 0 : rc.state === 0) && settleRecordingOp(op, 'confirmed')) changed = true;
    return changed;
  }
  function receiveWriterRecording(data) {
    for (const event of parseRecordingWriterFrame(data)) if (rc.op?.status === 'pending' && settleRecordingOp(rc.op, 'refused', event.code)) return true;
    return false;
  }
  function resetRecording() {
    timers.clearTimeout(rc.op?.timer);
    rcLast = rc.op?.status === 'pending' ? Object.freeze({ kind: rc.op.kind, status: 'unknown', text: RECORDING_OUTCOME_TEXT[rc.op.kind].unknown }) : null;
    rc = freshRecording();
  }
  // Desk lock (same model as ADR-0009): `settings.block.pass` empty means no lock; otherwise the player flag must be exactly 1. Unknown refuses.
  const recordingLock = () => sn.passSet === null ? 'unknown' : !sn.passSet ? 'allowed' : rc.player === null ? 'unknown' : rc.player ? 'allowed' : 'locked';
  function recordingPreflight(kind) {
    if (!canAct() || phase !== 'live' || !writerReady) return recordingRefusal('not-ready', 'Not connected to the desk.');
    if (rc.op?.status === 'pending') return recordingRefusal('busy', 'A recording operation is already waiting for the desk.');
    if (rc.state === null) return recordingRefusal('unknown-state', 'The desk has not reported its recording state.');
    if (kind === 'start') {
      if (rc.state !== 0) return recordingRefusal('already-recording', 'The desk is already recording.');
      if (rc.present === null) return recordingRefusal('drive-unknown', 'The desk has not reported its USB drive.');
      if (rc.present < 0.5) return recordingRefusal('no-drive', 'No USB drive in the desk');
    } else if (rc.state === 0) return recordingRefusal('not-recording', 'The desk is not recording.');
    const lock = recordingLock();
    if (lock !== 'allowed') return lockRefusal(lock);
    if (rc.busy === null) return recordingRefusal('recorder-busy-unknown', 'The desk has not reported whether the recorder is busy.');
    if (rc.busy >= 0.5) return recordingRefusal('recorder-busy', 'Recorder busy');
    return null;
  }
  function startRecordingOp(kind) {
    const op = { kind, status: 'pending', code: undefined, timer: undefined };
    rc.op = op; rcLast = null;
    if (!sendTypedMessage(encodeRecordingToggleCommand())) return recordingRefusal('send-failed', 'Connection send failed; the outcome is unknown. No retry.');
    // A synchronous reply or stop during send already settled or replaced op.
    if (rc.op === op && op.status === 'pending') {
      const owner = generation;
      op.timer = timers.setTimeout(() => { if (generation === owner && settleRecordingOp(op, 'unconfirmed')) emit('controls'); }, RECORDING_WAIT_MS);
    }
    emit('controls');
    return Object.freeze({ ok: true, kind });
  }
  const recordingAPI = {
    startRecording() { return recordingPreflight('start') ?? startRecordingOp('start'); },
    stopRecording() { return recordingPreflight('stop') ?? startRecordingOp('stop'); },
  };
  const RECORDING_OUTCOME_TEXT = {
    start: { pending: 'Start sent; waiting for the desk to report recording.', confirmed: 'The desk reported recording started.', unconfirmed: 'Start sent; the desk did not report recording within 5 s. Check the desk before relying on it.', unknown: 'The connection ended while a recording start was outstanding; the outcome is unknown. No retry.' },
    stop: { pending: 'Stop sent; waiting for the desk to report recording stopped.', confirmed: 'The desk reported recording stopped.', unconfirmed: 'Stop sent; the desk did not report recording stopped within 5 s. Check the desk before relying on it.', unknown: 'The connection ended while a recording stop was outstanding; the outcome is unknown. No retry.' },
  };
  const publicRecordingOperation = op => !op ? null : op.text ? op : Object.freeze({ kind: op.kind, status: op.status, ...(op.code ? { code: op.code } : {}),
    text: op.status === 'refused' ? recordingRefusalText(op.code) : RECORDING_OUTCOME_TEXT[op.kind][op.status] });
  function recordingSnapshot() {
    const recording = rc.state === null ? null : rc.state !== 0;
    return Object.freeze({
      present: rc.present === null ? null : rc.present >= 0.5, freespace: rc.freespace, dropouts: rc.dropouts, state: rc.state, recording,
      // The desk counts time up while stopped, so elapsed exists only while the received state says recording.
      elapsed: recording && rc.time !== null && rc.time >= 0 ? Math.floor(rc.time) : null,
      session: rc.session, busy: rc.busy, lock: recordingLock(), operation: publicRecordingOperation(rc.op ?? rcLast),
    });
  }
  const snapshot = () => {
    if (socket) inspectCurrent(); // A read after sleep cannot resurrect old state before timers run.
    // Full readiness: received Ui24 AUX state and, for control sessions, an open writer.
    const qualified = phase === 'live' && (!controlEnabled || writerReady);
    return { phase, qualified, detail, observations: provider.snapshot(), ...(auxControl ? { eq: new Map(eqObserved) } : {}), meterState: meterState(), meters: new Map(meters), meterRevision, ...(controlEnabled ? { control: controlSnapshot() } : {}), ...(auxControl ? { snapshots: snapshotsSnapshot(), recording: recordingSnapshot() } : {}) };
  };
  const emit = (kind = 'state') => { for (const listener of listeners) listener(snapshot(), kind); };
  const clearTimers = () => { timers.clearTimeout(basisTimer); basisTimer = undefined; basisTimerAt = null; timers.clearTimeout(deadline); timers.clearTimeout(idle); timers.clearTimeout(receiverDeadline); timers.clearTimeout(receiverIdle); timers.clearInterval(keepalive); timers.clearTimeout(meterExpiry); timers.clearTimeout(meterFlush); meterFlush = undefined; };
  function stop(next = 'disconnected', message = 'Disconnected — received state cleared') {
    ++generation;
    resetSnapshots(); resetRecording();
    cancelControl('Received state cleared; connect explicitly.', 'disconnect'); selected = null; attentionFlag = false; observed.clear(); receipts.clear(); eqObserved.clear(); processingRaw.clear(); sequence = 0;
    clearTimers();
    const old = socket, oldReceiver = receiver;
    socket = receiver = null;
    provider.clear(); meters = new Map(); meterStamp = null; meterRevision = 0;
    writerReady = false;
    phase = next; detail = message;
    for (const connection of [old, oldReceiver]) if (connection) {
      connection.onopen = connection.onmessage = connection.onerror = connection.onclose = null;
      try { connection.close(); } catch { /* Already invalidated; never retry close or writes. */ }
    }
    emit();
  }
  function connect(address) {
    stop('idle', 'Starting an explicit connection'); snLast = null;
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
      writerOpened = true; writerReady = true; if (qualified) timers.clearTimeout(deadline); phase = qualified ? 'live' : 'connected'; detail = qualified ? 'Received Ui24 AUX state · peer editing' : 'Socket connected — waiting for received Ui24 model and AUX state'; emit();
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
      else if (auxControl) { const snapshotsChanged = receiveWriterSnapshot(data), recordingChanged = receiveWriterRecording(data); if (snapshotsChanged || recordingChanged) emit('controls'); }
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
    ...(auxControl ? snapshotAPI : {}),
    ...(auxControl ? recordingAPI : {}),
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
