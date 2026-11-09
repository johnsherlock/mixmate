// Presentation boundary only. F03-S03 owns the explicit receive-only session.
// No profile bounds, mock names, pairs, levels or meters establish availability.
export function createEmptyLiveProvider() {
  const empty = () => ({
    status: "Not connected — no received mixer state",
    mixes: [],
  });
  return { snapshot: empty, clear: empty };
}
