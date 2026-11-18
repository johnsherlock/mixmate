// Layout only: never reorder local membership or infer links from names/parity.
export function landscapeColumns(width) {
  return Math.max(2, Math.floor((width + 7) / 100 / 2) * 2);
}
export function channelSlots(models, columns) {
  let slot = 0;
  return models.map((model, index) => {
    const next = models[index + 1];
    const paired = model.sourceId && next?.sourceId && model.levelPeerIds?.length === 2 && next.levelPeerIds?.length === 2
      && model.levelPeerIds.includes(next.sourceId) && next.levelPeerIds.includes(model.sourceId);
    if (paired && slot % columns === columns - 1) slot++;
    return ++slot;
  });
}
