import { encodeAuxLevelCommand, resolveAuxLevelTargets, resolveAuxLevelTopology } from './aux-level-protocol.js';
import { resolveRelativeGroup, resolveGroupTopology, relativeGroupChange } from './relative-groups.js';
const counter = value => Number.isSafeInteger(value) && value >= 0;
const sameEpoch = (a, b) => a.generation === b.generation && a.revision === b.revision;

// The future private control session owns readContext, socket and receive journal.
// This module has no sender, timers, subscription or public replacement context.
export function createAuxLevelGuard({ readContext, readGroup }) {
  if (typeof readContext !== 'function') throw Error('An owned current-context reader is required.');
  let lease = null, epoch = 0;
  const plans = new WeakMap();
  function disarm() { lease = null; epoch++; }
  function current() {
    const value = readContext();
    if (!value || value.open !== true || value.visible !== true ||
        !['generation', 'revision', 'levelRevision'].every(key => counter(value[key])) ||
        !(value.observations instanceof Map) || !(value.receipts instanceof Map)) throw Error('Current open visible socket context is required.');
    return value;
  }
  function resolve(context, target, topology = false) {
    if (target.kind !== 'group') return topology ? resolveAuxLevelTopology(context.observations, target) : resolveAuxLevelTargets(context.observations, target);
    if (!readGroup || Reflect.ownKeys(target).length !== 3 || !Object.hasOwn(target, 'groupId') || !Object.hasOwn(target, 'auxIndex')) throw Error('Invalid group selection.');
    const group = readGroup(target.groupId);
    const closure = topology ? resolveGroupTopology(context.observations, group, target.auxIndex) : resolveRelativeGroup(context.observations, group, target.auxIndex);
    return Object.freeze({ ...closure, target: Object.freeze({ kind: 'group', groupId: group.id, auxIndex: target.auxIndex }) });
  }
  function capture(target) {
    disarm();
    const context = current(), closure = resolve(context, target);
    if (closure.members.some(item => !counter(context.receipts.get(item.path)))) throw Error('Received target receipt evidence is required.');
    lease = { generation: context.generation, revision: context.revision, levelRevision: context.levelRevision, target: closure.target, signature: JSON.stringify(closure), baseline: closure, receipts: closure.members.map(item => context.receipts.get(item.path)) };
    return Object.freeze({ armed: true, target: closure.target, count: closure.members.length });
  }
  function planCommands(context, closure, commands, delta) {
    commands.forEach(encodeAuxLevelCommand);
    const receipts = closure.members.map(item => context.receipts.get(item.path));
    if (receipts.some(value => !counter(value))) { disarm(); throw Error('Received target receipt evidence is required.'); }
    epoch++;
    const plan = Object.freeze({ count: commands.length, ...(delta === undefined ? {} : { delta }) });
    plans.set(plan, { epoch, generation: context.generation, revision: context.revision, commands, members: closure.members, receipts, next: 0, membership: closure.membership });
    return plan;
  }
  function validLease() {
    if (!lease) throw Error('Explicit arming is required.');
    try {
      const context = current(), closure = resolve(context, lease.target);
      if (!sameEpoch(context, lease) || context.levelRevision !== lease.levelRevision ||
          JSON.stringify(closure) !== lease.signature || closure.members.some((item, index) => !counter(context.receipts.get(item.path)) || context.receipts.get(item.path) < lease.receipts[index])) throw Error('AUX context or authoritative baseline changed; re-arm explicitly.');
      return context;
    } catch (error) { disarm(); throw error; }
  }
  return Object.freeze({
    arm(target) { if (target?.kind === 'group') throw Error('Use the typed group selection.'); return capture(target); },
    armGroup(groupId, auxIndex) { return capture({ kind: 'group', groupId, auxIndex }); },
    disarm,
    prepare(value) {
      const context = validLease(), closure = resolve(context, lease.target);
      if (lease.target.kind === 'group') throw Error('Group controls require a relative delta.');
      return planCommands(context, closure, closure.members.map(item => Object.freeze({ ...item.target, value })));
    },
    previewRelative(delta) {
      validLease();
      if (lease.target.kind !== 'group') throw Error('Select a group first.');
      return relativeGroupChange(lease.baseline, delta).delta;
    },
    prepareRelative(delta) {
      const context = validLease();
      if (lease.target.kind !== 'group') throw Error('Select a group first.');
      const change = relativeGroupChange(lease.baseline, delta);
      return planCommands(context, lease.baseline, change.commands, change.delta);
    },
    authorizeNext(plan, ordinal) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch || ordinal !== item.next || item.next >= item.commands.length) { disarm(); throw Error('Foreign, reordered, consumed or invalidated AUX plan.'); }
      const context = validLease(), index = item.next;
      // Same-value receipts after prepare are still pre-dispatch observations.
      // Cut each path's confirmation history immediately before its ordinal.
      const receipt = context.receipts.get(item.members[index].path);
      if (receipt < item.receipts[index]) { disarm(); throw Error('Target receipt sequence regressed.'); }
      item.receipts[index] = receipt;
      const command = item.commands[item.next++];
      return Object.freeze({ command, message: encodeAuxLevelCommand(command) });
    },
    readback(plan) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch) return 'invalidated';
      if (item.next !== item.commands.length) { disarm(); return 'invalidated'; }
      let context;
      try { context = current(); } catch { disarm(); return 'invalidated'; }
      if (!sameEpoch(context, item)) { disarm(); return 'invalidated'; }
      // Unlike an authorization, matching readback may change the level baseline.
      // Topology must still be valid; receipt identity is per path, never global.
      try {
        const topology = resolve(context, lease.target, true);
        if (item.membership && JSON.stringify(topology.membership) !== JSON.stringify(item.membership)) throw Error('Group membership changed.');
        if (JSON.stringify(topology.members.map(member => member.path)) !== JSON.stringify(item.members.map(member => member.path))) throw Error('Topology changed.');
      }
      catch { disarm(); return 'conflict'; }
      let pending = false;
      for (const [index, member] of item.members.entries()) {
        const receipt = context.receipts.get(member.path);
        if (!counter(receipt) || receipt < item.receipts[index]) { disarm(); return 'invalidated'; }
        if (receipt === item.receipts[index]) { pending = true; continue; }
        if (context.observations.get(member.path) !== item.commands[index].value) { disarm(); return 'conflict'; }
      }
      return pending ? 'unconfirmed' : 'observed-match';
    },
  });
}
