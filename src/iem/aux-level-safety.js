import { encodeAuxLevelCommand, resolveAuxLevelTargets, resolveAuxLevelTopology } from './aux-level-protocol.js';
const counter = value => Number.isSafeInteger(value) && value >= 0;
const sameEpoch = (a, b) => a.generation === b.generation && a.revision === b.revision;

// The future private control session owns readContext, socket and receive journal.
// This module has no sender, timers, subscription or public replacement context.
export function createAuxLevelGuard({ readContext }) {
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
  function validLease() {
    if (!lease) throw Error('Explicit arming is required.');
    try {
      const context = current(), closure = resolveAuxLevelTargets(context.observations, lease.target);
      if (!sameEpoch(context, lease) || context.levelRevision !== lease.levelRevision ||
          JSON.stringify(closure) !== lease.signature || closure.members.some((item, index) => !counter(context.receipts.get(item.path)) || context.receipts.get(item.path) < lease.receipts[index])) throw Error('AUX context or authoritative baseline changed; re-arm explicitly.');
      return context;
    } catch (error) { disarm(); throw error; }
  }
  return Object.freeze({
    arm(target) {
      disarm();
      const context = current(), closure = resolveAuxLevelTargets(context.observations, target);
      if (closure.members.some(item => !counter(context.receipts.get(item.path)))) throw Error('Received target receipt evidence is required.');
      lease = { generation: context.generation, revision: context.revision, levelRevision: context.levelRevision, target: closure.target, signature: JSON.stringify(closure), receipts: closure.members.map(item => context.receipts.get(item.path)) };
      return Object.freeze({ armed: true, target: closure.target, count: closure.members.length });
    },
    disarm,
    prepare(value) {
      const context = validLease(), closure = resolveAuxLevelTargets(context.observations, lease.target);
      const commands = closure.members.map(item => Object.freeze({ ...item.target, value }));
      commands.forEach(encodeAuxLevelCommand); // Reject invalid numbers before granting any ordinal.
      const receipts = closure.members.map(item => context.receipts.get(item.path));
      if (receipts.some(value => !counter(value))) { disarm(); throw Error('Received target receipt evidence is required.'); }
      epoch++; // A newer user intent supersedes every earlier unconsumed plan.
      const plan = Object.freeze({ count: commands.length });
      plans.set(plan, { epoch, generation: context.generation, revision: context.revision, commands, members: closure.members, receipts, next: 0 });
      return plan;
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
        const topology = resolveAuxLevelTopology(context.observations, lease.target);
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
