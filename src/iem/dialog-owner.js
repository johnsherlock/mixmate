// UI ownership only: each opening gets a unique lease; stale callbacks cannot
// release a newer dialog even when both have the same kind.
export function createDialogOwner() {
  let current = null, revision = 0;
  const listeners = new Set();
  const owns = lease => Boolean(lease && current?.lease === lease);
  // F02-S05: observers learn when no dialog is open (e.g. to resume deferred
  // automatic connection). Observer errors never affect ownership.
  const notify = () => { for (const listener of [...listeners]) { try { listener(current?.lease || null); } catch { /* UI observer only. */ } } };
  return Object.freeze({
    owns,
    active: () => current?.lease || null,
    claim(kind, onClose) {
      const token = ++revision, previous = current; current = null;
      previous?.onClose({ replaced: true });
      if (revision !== token) return null; // A reentrant newer claim wins.
      const lease = Object.freeze({ kind, token }); current = { lease, onClose }; notify(); return lease;
    },
    release(lease) { if (!owns(lease)) return false; current = null; revision++; notify(); return true; },
    close(lease, reason = {}) {
      if (!owns(lease)) return false;
      const previous = current; current = null; revision++; previous.onClose(reason); notify(); return true;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
export function restoreDialogFocus(node) {
  if (node?.isConnected !== false && !node?.disabled && !node?.closest?.('[hidden]')) node?.focus?.();
}
