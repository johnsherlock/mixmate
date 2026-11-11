import { encodeAuxPanCommand, normalizeAuxPanPosition, resolveAuxPanTargets, resolveAuxPanTopology } from './aux-pan-protocol.js';
const counter = value => Number.isSafeInteger(value) && value >= 0;
const sameEpoch = (a, b) => a.generation === b.generation && a.revision === b.revision;

// Pure lease only. S02 must close readContext over its privately owned socket,
// validated current journal/receipts and revisions. No transport/timer is here.
export function createAuxPanGuard({ readContext }) {
  if (typeof readContext !== 'function') throw Error('An owned current-context reader is required.');
  let lease = null, epoch = 0;
  const plans = new WeakMap();
  function disarm() { lease = null; epoch++; }
  function current() {
    const context = readContext();
    if (!context || context.open !== true || context.visible !== true ||
        !['generation', 'revision', 'panRevision'].every(key => counter(context[key])) ||
        !(context.observations instanceof Map) || !(context.receipts instanceof Map)) throw Error('Current open visible socket context is required.');
    return context;
  }
  function validLease() {
    if (!lease) throw Error('Explicit pan arming is required.');
    try {
      const context = current(), closure = resolveAuxPanTargets(context.observations, lease.target);
      if (!sameEpoch(context, lease) || context.panRevision !== lease.panRevision || JSON.stringify(closure) !== lease.signature ||
          closure.members.some((member, index) => !counter(context.receipts.get(member.path)) || context.receipts.get(member.path) < lease.receipts[index])) throw Error('Pan baseline or context changed; re-arm explicitly.');
      return context;
    } catch (error) { disarm(); throw error; }
  }
  return Object.freeze({
    arm(target) {
      disarm();
      const context = current(), closure = resolveAuxPanTargets(context.observations, target);
      const receipts = closure.members.map(member => context.receipts.get(member.path));
      if (receipts.some(value => !counter(value))) throw Error('Received target path receipt evidence is required.');
      lease = { generation: context.generation, revision: context.revision, panRevision: context.panRevision, target: closure.target, signature: JSON.stringify(closure), receipts };
      return Object.freeze({ armed: true, target: closure.target, count: closure.members.length });
    },
    disarm,
    prepare(requestedValue) {
      const context = validLease(), value = normalizeAuxPanPosition(requestedValue);
      const closure = resolveAuxPanTargets(context.observations, lease.target);
      const commands = closure.members.map(member => Object.freeze({ ...member.target, value }));
      const receipts = closure.members.map(member => context.receipts.get(member.path));
      epoch++; // The latest explicit intent supersedes every prior plan.
      const plan = Object.freeze({ count: commands.length, value });
      plans.set(plan, { epoch, generation: context.generation, revision: context.revision, commands, members: closure.members, receipts, next: 0 });
      return plan;
    },
    authorizeNext(plan, ordinal) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch || ordinal !== item.next || item.next >= item.commands.length) { disarm(); throw Error('Foreign, reordered, consumed or invalidated pan plan.'); }
      const context = validLease(), index = item.next, receipt = context.receipts.get(item.members[index].path);
      if (receipt < item.receipts[index]) { disarm(); throw Error('Pan receipt sequence regressed.'); }
      item.receipts[index] = receipt; // This path's immediate pre-authorization cutpoint.
      const command = item.commands[item.next++];
      return Object.freeze({ command, message: encodeAuxPanCommand(command) });
    },
    readback(plan) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch) return 'invalidated';
      if (item.next !== item.commands.length) { disarm(); return 'invalidated'; }
      let context;
      try { context = current(); } catch { disarm(); return 'invalidated'; }
      if (!sameEpoch(context, item)) { disarm(); return 'invalidated'; }
      try {
        // Equality is an arming prerequisite, not a partial-echo prerequisite.
        const topology = resolveAuxPanTopology(context.observations, lease.target);
        if (JSON.stringify(topology.members.map(member => member.path)) !== JSON.stringify(item.members.map(member => member.path))) throw Error('Pan topology changed.');
      } catch { disarm(); return 'conflict'; }
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
