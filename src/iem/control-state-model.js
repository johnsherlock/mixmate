// F09-S02 pure proposal only. NOT a transport capability or production dependency.
// Owned-adapter integration and remaining gates: docs/adr/0008-control-state-model.md.
import { resolveAuxLevelTargets } from './aux-level-protocol.js';
import { resolveAuxPanTargets, normalizeAuxPanPosition } from './aux-pan-protocol.js';
import { resolveAuxEqTargets, eqArray, eqDataFields } from './aux-eq-protocol.js';
import { resolveRelativeGroup, relativeGroupChange } from './relative-groups.js';

export const OBSERVATION_WINDOW_MS = 2500;
const scopes = new WeakSet();
const requireScope = scope => { if (!scopes.has(scope)) throw Error('Use a validated typed pure scope.'); };
const uint = x => Number.isSafeInteger(x) && x >= 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const unit = x => finite(x) && x >= 0 && x <= 1;
const freeze = x => {
  if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
};
const data = (input, keys) => eqDataFields(input, keys);
const stamp = input => {
  const t = data(input, ['mono', 'wall']);
  if (!finite(t.mono) || !finite(t.wall) || t.mono < 0 || t.wall < 0) throw Error('Invalid explicit clock.');
  return t;
};

// Fake/pure construction boundary. A future adapter must obtain these inputs
// privately from its current socket journal and canonical settings, not callers.
export function createControlScope(input) {
  const { kind, received, receipts, target, group } = data(input, ['kind', 'received', 'receipts', 'target', 'group']);
  if (!(received instanceof Map) || !(receipts instanceof Map)) throw Error('Owned complete journals required.');
  let resolved, closures;
  if (kind === 'level') {
    const field = Object.getOwnPropertyDescriptor(target ?? {}, 'kind');
    if (!field || !Object.hasOwn(field, 'value')) throw Error('Data-only typed target required.');
    data(target, field.value === 'send' ? ['kind', 'sourceId', 'auxIndex'] : ['kind', 'auxIndex']);
    resolved = resolveAuxLevelTargets(received, target);
  }
  else if (kind === 'pan') resolved = resolveAuxPanTargets(received, target);
  else if (kind === 'geq') resolved = resolveAuxEqTargets(received, target);
  else if (kind === 'group') {
    data(group, ['id', 'members']); eqArray(group.members, 1, 128);
    const { auxIndex } = data(target, ['auxIndex']);
    resolved = resolveRelativeGroup(received, group, auxIndex);
    closures = group.members.map(sourceId => resolveAuxLevelTargets(received, { kind: 'send', sourceId, auxIndex }).members.map(x => x.path));
  } else throw Error('Unsupported control scope.');
  const members = resolved.members.map(x => {
    if (!uint(receipts.get(x.path)) || receipts.get(x.path) === 0) throw Error('Actual per-path receipts required.');
    return { path: x.path, target: { ...x.target }, value: x.value, receipt: receipts.get(x.path), ...(kind === 'group' ? { db: x.db } : {}) };
  });
  if (!members.length || members.length > 128 || new Set(members.map(x => x.path)).size !== members.length) throw Error('Bounded deduplicated scope required.');
  closures ??= kind === 'geq' ? members.slice(0, 31).map((x, i) => members.length === 62 ? [x.path, members[i + 31].path] : [x.path]) : [members.map(x => x.path)];
  const scope = freeze({ kind, members, closures, identity: kind === 'group' ? JSON.stringify([resolved.groupId, resolved.membership]) : JSON.stringify([kind, target]) });
  scopes.add(scope); return scope;
}

export function createControlState({ scope, generation, revision, now }) {
  requireScope(scope);
  if (!uint(generation) || !uint(revision)) throw Error('Invalid owned context.');
  return freeze({ scope, scopeCurrent: true, generation, revision, now: stamp(now), actual: scope.members.map(x => ({ path: x.path, value: x.value, receipt: x.receipt })),
    lastReceipt: Math.max(...scope.members.map(x => x.receipt)), barriers: [], armed: false, chain: null, gesture: null, operation: null, retired: [], nextId: 1, status: 'idle' });
}
const row = (s, path) => s.actual.find(x => x.path === path);
const owns = (s, op) => op && op.generation === s.generation && op.revision === s.revision && op.scope === s.scope;
const active = s => owns(s, s.operation) && ['dispatching', 'pending'].includes(s.operation.status);
function retire(s) {
  if (!s.operation) return;
  if (s.retired.length >= 128) {
    const settled = s.retired.findIndex(x => x.flight === null);
    if (settled < 0) throw Error('Bounded diagnostic capacity exhausted.');
    s.retired.splice(settled, 1);
  }
  s.retired.push(s.operation); s.operation = null;
}
function barrier(s) {
  if (!s.chain?.touched && !(active(s) && s.operation.authorized)) return;
  for (const member of s.scope.members) {
    const old = s.barriers.find(x => x.path === member.path);
    if (old) { old.floor = old.generation === s.generation ? Math.max(old.floor, s.lastReceipt) : s.lastReceipt; old.generation = s.generation; }
    else s.barriers.push({ path: member.path, floor: s.lastReceipt, generation: s.generation });
  }
}
function stop(s, status) {
  barrier(s);
  if (active(s)) s.operation.status = status;
  s.status = status; s.armed = false; s.chain = null; s.gesture = null;
}
function eligible(s) {
  if (!s.scopeCurrent || s.scope.members.some(x => !unit(row(s, x.path)?.value))) return false;
  if (s.scope.closures.some(paths => paths.some(path => row(s, path).value !== row(s, paths[0]).value))) return false;
  return !s.scope.members.some(x => s.barriers.some(b => b.path === x.path && b.generation === s.generation && row(s, x.path).receipt <= b.floor));
}
function establish(s) {
  if (!eligible(s) || s.operation?.flight !== null && s.operation?.flight !== undefined) throw Error('Fresh complete recovery and equal linked actuals required.');
  // Anchor only actual received values. Intent never becomes a new baseline.
  const members = s.scope.members.map(x => ({ ...x, value: row(s, x.path).value }));
  if (s.scope.kind === 'group' && !s.chain) {
    // Reuse continuous conversion/finite-window checks via a zero-delta baseline
    // reconstructed by the scope builder; recovery requires a freshly built scope.
    if (members.some(x => x.value !== s.scope.members.find(m => m.path === x.path).value)) throw Error('Rebuild group scope from fresh actual journal before rearming.');
  }
  s.chain ??= { anchor: members, delta: 0, requested: members.map(x => ({ path: x.path, target: x.target, value: x.value })), touched: false };
}
function complete(s) {
  const op = s.operation;
  if (op?.status === 'pending' && op.expected.every(x => x.matched)) { op.status = 'observed-match'; s.status = 'observed-match'; }
}
function copy(s) {
  return { ...s, actual: s.actual.map(x => ({ ...x })), barriers: s.barriers.map(x => ({ ...x })),
    chain: s.chain && { ...s.chain }, gesture: s.gesture && { ...s.gesture },
    operation: s.operation && { ...s.operation, expected: s.operation.expected.map(x => ({ ...x })) },
    retired: s.retired.map(op => ({ ...op, expected: op.expected.map(x => ({ ...x })) })) };
}

// All time, socket receipts and send outcomes are explicit data. This reducer
// performs no dispatch, listener installation, timers, persistence or networking.
const eventKeys = Object.freeze({ tick: [], arm: [], begin: [], preview: ['token', 'value'], commit: ['token'], authorize: ['id', 'ordinal'], returned: ['id', 'ordinal'], threw: ['id', 'ordinal'], receive: ['generation', 'path', 'value', 'receipt'], invalidate: ['reason', 'revision'], select: ['scope', 'revision'], 'new-generation': ['generation', 'revision', 'scope'] });
const invalidations = ['selection', 'profile', 'topology', 'membership', 'native', 'processing', 'hide', 'navigation', 'disconnect', 'sleep', 'cancel', 'missing'];
function validatedEvent(input, state) {
  const descriptor = input && Object.getOwnPropertyDescriptor(input, 'type');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !Object.hasOwn(eventKeys, descriptor.value)) throw Error('Unknown data-only model event.');
  const event = data(input, ['type', 'now', ...eventKeys[descriptor.value]]);
  if (['authorize', 'returned', 'threw'].includes(event.type) && (!uint(event.id) || !uint(event.ordinal))) throw Error('Invalid operation indices.');
  if (event.type === 'receive' && (!uint(event.generation) || !uint(event.receipt) || !unit(event.value) || typeof event.path !== 'string' || event.path.length > 64 || event.generation > state.generation)) throw Error('Invalid receipt event.');
  if (event.type === 'invalidate' && (!invalidations.includes(event.reason) || !uint(event.revision))) throw Error('Invalid context event.');
  if (['select', 'new-generation'].includes(event.type)) {
    requireScope(event.scope);
    if (!uint(event.revision) || event.type === 'new-generation' && !uint(event.generation)) throw Error('Invalid context event.');
  }
  if (event.type === 'preview') {
    if (state.scope.kind === 'geq') { if (!eqArray(event.value, 31).every(unit)) throw Error('Invalid GEQ projection.'); }
    else if (state.scope.kind === 'group' ? !finite(event.value) : !unit(event.value)) throw Error('Invalid typed intent.');
  }
  return event;
}
function outstandingOutcome(s, event) {
  const op = s.operation?.id === event.id ? s.operation : s.retired.find(x => x.id === event.id);
  if (!op || op.flight !== event.ordinal || event.ordinal !== op.returned) throw Error('Outcome must belong to exact outstanding send.');
  return op;
}
function settleOutcome(s, event, now, allowProgress) {
  const op = outstandingOutcome(s, event);
  op.flight = null;
  if (event.type === 'threw') {
    op.unknownDelivery = true;
    if (allowProgress) {
      if (op === s.operation && owns(s, op)) stop(s, 'interrupted'); else op.status = 'interrupted';
    }
  } else {
    op.returned++;
    if (allowProgress && op === s.operation && owns(s, op) && op.status === 'dispatching' && op.returned === op.expected.length) {
      op.status = 'pending'; op.completed = now; s.status = 'pending';
      s.chain = { ...s.chain, delta: op.delta, requested: op.expected.map(({ path, target, value }) => ({ path, target, value })), touched: true };
      complete(s);
    }
  }
}
const elapsed = (now, start) => Math.max(now.mono - start.mono, now.wall - start.wall);
export function transitionControl(state, input) {
  const event = validatedEvent(input, state), now = stamp(event.now);
  if (event.type === 'receive' && event.generation < state.generation) return state;
  const s = copy(state), outcome = ['returned', 'threw'].includes(event.type);
  if (outcome) outstandingOutcome(s, event); // Validate identity before any clock transition.
  const origin = active(s) ? (s.operation.completed ?? s.operation.started) : s.now;
  if (now.mono < s.now.mono || now.wall < s.now.wall || Math.abs((now.mono - origin.mono) - (now.wall - origin.wall)) > 1000) {
    stop(s, 'clock-invalidated'); s.scopeCurrent = false; s.now = now;
    if (outcome) settleOutcome(s, event, now, false);
    return freeze(s);
  }
  s.now = now;
  if (owns(s, s.operation) && s.operation.status === 'dispatching' && elapsed(now, s.operation.started) >= OBSERVATION_WINDOW_MS) stop(s, 'dispatch-expired');
  if (owns(s, s.operation) && s.operation.status === 'pending' && elapsed(now, s.operation.completed) >= OBSERVATION_WINDOW_MS) {
    s.operation.status = 'sent-unverified'; s.status = 'sent-unverified';
    // All sends returned: established same-scope permission/coordinate survives.
  }
  const fields = () => event;
  switch (event.type) {
    case 'tick': fields([]); break;
    case 'arm':
      fields([]); if (active(s) || s.gesture) throw Error('Operation already active.');
      establish(s); s.armed = true; s.status = 'armed'; break;
    case 'begin':
      fields([]); if (!s.armed || active(s) || s.gesture || !eligible(s)) throw Error('Explicit armed eligible gesture required.');
      s.gesture = { token: freeze({ id: s.nextId++ }), preview: null }; s.status = 'gesture'; break;
    case 'preview': {
      const { token, value } = fields(['token', 'value']);
      if (token !== s.gesture?.token || !s.armed) throw Error('Foreign gesture.');
      let expected, delta = s.chain.delta;
      if (s.scope.kind === 'group') {
        if (!finite(value) || !finite(delta + value)) throw Error('Finite relative intent required.');
        const change = relativeGroupChange({ members: s.chain.anchor }, delta + value);
        delta = change.delta; expected = change.commands.map((command, i) => ({ path: s.scope.members[i].path, target: s.scope.members[i].target, value: command.value }));
      } else if (s.scope.kind === 'geq') {
        const values = eqArray(value, 31); if (!values.every(unit)) throw Error('Invalid GEQ projection.');
        expected = s.scope.members.map((x, i) => ({ path: x.path, target: x.target, value: values[i % 31] }));
      } else {
        if (!unit(value)) throw Error('Strict finite normalized intent required.');
        const normalized = s.scope.kind === 'pan' ? normalizeAuxPanPosition(value) : value;
        expected = s.scope.members.map(x => ({ path: x.path, target: x.target, value: normalized }));
      }
      s.gesture.preview = { expected, delta, gestureDelta: delta - s.chain.delta }; break;
    }
    case 'commit': {
      const { token } = fields(['token']);
      if (token !== s.gesture?.token || !s.gesture.preview || !s.armed || !eligible(s)) throw Error('Owned cached preview required.');
      const preview = s.gesture.preview; s.gesture = null;
      if (preview.expected.every((x, i) => x.value === s.chain.requested[i].value)) { s.status = 'no-op'; break; }
      retire(s);
      s.operation = { id: s.nextId++, generation: s.generation, revision: s.revision, scope: s.scope, status: 'dispatching', expected: preview.expected.map(x => ({ ...x, cutpoint: null, matched: false })),
        delta: preview.delta, started: now, authorized: 0, returned: 0, flight: null, unknownDelivery: false, completed: null };
      s.status = 'dispatching'; break;
    }
    case 'authorize': {
      const { id, ordinal } = fields(['id', 'ordinal']), op = s.operation;
      if (id !== op?.id || op.status !== 'dispatching' || !s.armed || !uint(ordinal) || ordinal !== op.authorized || ordinal !== op.returned || ordinal >= op.expected.length || op.flight !== null) throw Error('Ordered single authorization required.');
      op.expected[ordinal].cutpoint = row(s, op.expected[ordinal].path).receipt;
      op.flight = ordinal; op.authorized++; s.chain.touched = true; break;
    }
    case 'returned':
    case 'threw':
      settleOutcome(s, event, now, true); break;
    case 'receive': {
      const { generation, path, value, receipt } = fields(['generation', 'path', 'value', 'receipt']);
      if (!uint(generation) || !uint(receipt) || !unit(value) || typeof path !== 'string' || path.length > 64) throw Error('Invalid receipt event.');
      if (generation !== s.generation) break; // old socket events have no authority
      if (receipt <= s.lastReceipt) throw Error('Receipt sequence must increase.');
      s.lastReceipt = receipt;
      const actual = row(s, path); if (!actual) break; // unrelated path cannot match
      const previous = actual.value; actual.value = value; actual.receipt = receipt;
      if (!s.scope.members.some(member => member.path === path)) break; // Historical disjoint actual data grants no current invalidation authority.
      const op = owns(s, s.operation) ? s.operation : null, expectation = op?.expected.find(x => x.path === path);
      if (active(s) && expectation?.cutpoint !== null && receipt > expectation?.cutpoint) {
        if (op.status === 'dispatching') stop(s, 'reentrant-invalidated');
        else if (value !== expectation.value) stop(s, 'precision-or-native-conflict');
        else { expectation.matched = true; complete(s); }
      } else if (previous !== value && !(s.chain && expectation?.value === value && ['sent-unverified', 'observed-match'].includes(op?.status))) stop(s, 'native-invalidated');
      break;
    }
    case 'invalidate': {
      const { reason, revision } = fields(['reason', 'revision']);
      if (!invalidations.includes(reason) || !uint(revision) || revision <= s.revision) throw Error('Owned advancing context required.');
      stop(s, reason + '-invalidated'); s.revision = revision; s.scopeCurrent = false;
      if (['disconnect', 'hide', 'sleep'].includes(reason)) s.actual = [];
      break;
    }
    case 'select': {
      const { scope, revision } = fields(['scope', 'revision']); requireScope(scope);
      if (!uint(revision) || revision <= s.revision) throw Error('Select requires owned advancing context.');
      stop(s, 'selection-invalidated'); retire(s); s.scope = scope; s.scopeCurrent = true; s.revision = revision;
      for (const x of scope.members) {
        const actual = row(s, x.path);
        if (!actual) s.actual.push({ path: x.path, value: x.value, receipt: x.receipt });
        else if (x.receipt > actual.receipt) Object.assign(actual, { value: x.value, receipt: x.receipt });
        s.lastReceipt = Math.max(s.lastReceipt, x.receipt);
      }
      break;
    }
    case 'new-generation': {
      const { generation, revision, scope } = fields(['generation', 'revision', 'scope']); requireScope(scope);
      if (!uint(generation) || generation <= s.generation || !uint(revision) || revision <= s.revision) throw Error('Explicit new owned generation required.');
      stop(s, 'generation-invalidated'); retire(s); s.barriers = []; s.generation = generation; s.revision = revision; s.scope = scope; s.scopeCurrent = true;
      s.actual = scope.members.map(x => ({ path: x.path, value: x.value, receipt: x.receipt })); s.lastReceipt = Math.max(...scope.members.map(x => x.receipt));
      break;
    }
    default: throw Error('Unknown model event.');
  }
  return freeze(s);
}
