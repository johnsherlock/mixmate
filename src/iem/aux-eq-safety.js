import { encodeAuxEqCommand, auxEqPosition, eqArray, resolveAuxEqTargets } from './aux-eq-protocol.js';
const counter = value => Number.isSafeInteger(value) && value >= 0;
const sameEpoch = (a, b) => ['generation', 'revision', 'eqRevision', 'processingRevision', 'selectedAuxIndex'].every(key => a[key] === b[key]);
const epochOf = context => Object.fromEntries(['generation', 'revision', 'eqRevision', 'processingRevision', 'selectedAuxIndex'].map(key => [key, context[key]]));
const topology = closure => JSON.stringify({ target: closure.target, outputs: closure.outputs, paths: closure.members.map(member => member.path) });

// Pure future-owner lease. A public/caller-created Map is never runtime authority.
// S04 must close readContext over its own journal/socket/revisions/receipts and
// classify native processing changes even for unsupported readonly fields.
export function createAuxEqGuard({ readContext }) {
  if (typeof readContext !== 'function') throw Error('An owned EQ context reader is required.');
  let lease = null, epoch = 0;
  const plans = new WeakMap();
  const disarm = () => { lease = null; epoch++; };
  function current() {
    const context = readContext();
    if (!context || context.open !== true || context.visible !== true || !['generation', 'revision', 'eqRevision', 'processingRevision'].every(key => counter(context[key])) ||
        !Number.isInteger(context.selectedAuxIndex) || context.selectedAuxIndex < 0 || context.selectedAuxIndex > 9 || !(context.observations instanceof Map) || !(context.receipts instanceof Map)) throw Error('Current open visible selected AUX EQ context is required.');
    return context;
  }
  function validLease() {
    if (!lease) throw Error('Explicit EQ arming is required.');
    try {
      const context = current(), closure = resolveAuxEqTargets(context.observations, lease.target);
      if (!sameEpoch(context, lease) || JSON.stringify(closure) !== lease.signature || lease.baselineReceipts.some(([path, receipt]) => !counter(context.receipts.get(path)) || context.receipts.get(path) < receipt)) throw Error('EQ baseline/context changed; re-arm explicitly.');
      return { context, closure };
    } catch (error) { disarm(); throw error; }
  }
  function prepare(values, intent) {
    epoch++; // Every new explicit attempt supersedes older intent, even if invalid.
    const { context, closure } = validLease();
    const requested = eqArray(values, 31);
    if (!requested.every(auxEqPosition)) throw Error('Every requested EQ band must be finite from zero to one.');
    const commands = closure.members.map(member => Object.freeze({ ...member.target, value: requested[member.target.bandIndex] }));
    const plan = Object.freeze({ count: commands.length, intent, values: Object.freeze(requested) });
    plans.set(plan, { epoch, ...epochOf(context), commands, members: closure.members, topology: topology(closure), receipts: closure.members.map(member => context.receipts.get(member.path)), next: 0 });
    return plan;
  }
  return Object.freeze({
    arm(target) {
      disarm();
      const context = current(), closure = resolveAuxEqTargets(context.observations, target);
      if (closure.target.auxIndex !== context.selectedAuxIndex) throw Error('Only the current selected AUX EQ can be armed.');
      const paths = [...closure.members.map(member => member.path), ...closure.outputs.map(output => `a.${output.auxIndex}.eq.bypass`)];
      const baselineReceipts = paths.map(path => [path, context.receipts.get(path)]);
      if (baselineReceipts.some(([, receipt]) => !counter(receipt))) throw Error('Received EQ band/bypass receipt evidence is required.');
      lease = { ...epochOf(context), target: closure.target, signature: JSON.stringify(closure), baselineReceipts };
      return Object.freeze({ armed: true, target: closure.target, count: closure.members.length });
    },
    disarm,
    prepareCurve(values) { return prepare(values, 'curve'); },
    prepareReset() { return prepare(Array(31).fill(0.5), 'reset-bands'); },
    authorizeNext(plan, ordinal) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch || ordinal !== item.next || item.next >= item.commands.length) { disarm(); throw Error('Foreign, reordered, consumed or invalidated EQ plan.'); }
      const { context } = validLease(), index = item.next, receipt = context.receipts.get(item.members[index].path);
      if (!counter(receipt) || receipt < item.receipts[index]) { disarm(); throw Error('EQ receipt sequence regressed.'); }
      item.receipts[index] = receipt; // Immediate preauthorization cutpoint, never prepare time.
      const command = item.commands[item.next++];
      return Object.freeze({ command, message: encodeAuxEqCommand(command) });
    },
    readback(plan) {
      const item = plans.get(plan);
      if (!item || item.epoch !== epoch) return 'invalidated';
      if (item.next !== item.commands.length) { disarm(); return 'invalidated'; }
      let context;
      try { context = current(); } catch { disarm(); return 'invalidated'; }
      if (!sameEpoch(context, item) || lease.baselineReceipts.some(([path, receipt]) => !counter(context.receipts.get(path)) || context.receipts.get(path) < receipt)) { disarm(); return 'invalidated'; }
      try {
        // Partial echoes may temporarily make stereo sides unequal. Keep full
        // presence/topology/bypass checks, but equality belongs to arming only.
        const closure = resolveAuxEqTargets(context.observations, lease.target, { allowUnequal: true });
        if (topology(closure) !== item.topology) throw Error('EQ topology/bypass changed.');
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
