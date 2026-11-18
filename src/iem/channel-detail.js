import { restoreDialogFocus } from './dialog-owner.js';

// Text-only presentation; opening cancels obsolete control intent via its owner.
export function channelDetail(model) {
  if (model.kind === 'group') return [model.detail, model.requestedDetail || model.stateText, 'Relative requested gesture delta; no aggregate actual level, group VU or proof of hardware balance.'].filter(Boolean).join('\n\n');
  const sides = model.sides || [model];
  return [model.detail, model.requestedDetail, ...sides.map(side => [side.auxIndex === undefined ? '' : `Output ${side.auxIndex + 1}`,
    `Received level: ${side.levelText ?? 'not received'}${typeof side.position === 'number' ? ` (raw ${side.position})` : ''}`,
    `Received pan: ${typeof side.panPosition === 'number' ? side.panPosition : side.panText ?? 'not received'}`,
    side.stateText].filter(Boolean).join(' · ')), model.meter ? `${model.meter.label}: ${model.meter.status} ${(model.meter.values || []).map(value => value.floor ? '−80 dB floor' : `${value.db.toFixed(1)} dB`).join(' / ')}. ${model.meter.provenance || 'Meter scale provenance unavailable'}. Encoded zero is the meter floor, not proof of physical silence.` : '',
    model.sourceId ? 'Source VU is post-fader, not AUX-send contribution. Unknown mute and processing fields remain unknown.' : 'Output VU is post-fader. Unknown mute fields remain unknown.'].filter(Boolean).join('\n\n');
}
export function mountChannelDetail({ root, dialogOwner, onOpen = () => {} }) {
  const $ = s => root.querySelector(s), doc = root.ownerDocument;
  const layer = $('.mm-layer'), dialog = $('.mm-dialog'), body = $('.mm-dialog-body'), closeButton = $('.mm-dialog-head button');
  const text = doc.createElement('p'); text.className = 'mm-channel-detail-text';
  let lease = null, activeId = null, focusBefore, clean = () => {};
  function close(token, reason = {}) {
    if (lease !== token) return;
    lease = null; clean(); dialogOwner.release(token);
    if (!dialogOwner.active()) layer.hidden = true;
    if (!reason.replaced && !dialogOwner.active()) restoreDialogFocus(focusBefore);
  }
  return {
    update(models) {
      if (!lease) return;
      const model = models.find(item => item.id === activeId);
      if (!model) { close(lease); return; }
      text.textContent = channelDetail(model); $('#mm-dialog-title').textContent = `${model.name} · Details`;
    },
    open(model) {
      model = onOpen(model) || model;
      const token = dialogOwner.claim('channel-detail', reason => close(token, reason));
      if (!token) return;
      lease = token; activeId = model.id; focusBefore = doc.activeElement;
      dialog.classList.remove('mm-group-dialog', 'mm-pan-dialog');
      $('#mm-dialog-title').textContent = `${model.name} · Details`;
      text.textContent = channelDetail(model); body.replaceChildren(text); layer.hidden = false;
      const click = event => { if (dialogOwner.owns(token)) { event.stopImmediatePropagation?.(); close(token); } };
      const key = event => { if (dialogOwner.owns(token) && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation?.(); close(token); } };
      // Per-opening closures cannot close a replacement owner.
      clean = () => { closeButton.removeEventListener('click', click); root.removeEventListener('keydown', key); };
      closeButton.addEventListener('click', click); root.addEventListener('keydown', key);
      closeButton.focus();
    },
  };
}
