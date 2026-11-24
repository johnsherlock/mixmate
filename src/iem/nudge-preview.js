import { NUDGE_DOWN_DB, NUDGE_UP_DB } from './nudge-config.js';
import { positionDbText } from './fader-scale.js';

function receivedLevel({ sides, position }) {
  const describe = level => level === '—' ? 'Level unavailable' : level;
  if (sides?.length === 2) {
    const [left, right] = sides;
    const leftLevel = positionDbText(left.position);
    const rightLevel = positionDbText(right.position);
    if (leftLevel !== '—' && left.position === right.position) {
      return { text: leftLevel, description: leftLevel, split: false };
    }
    const amounts = [leftLevel, rightLevel].map(level => level.replace(/ dB$/, ''));
    const unit = leftLevel === '—' && rightLevel === '—' ? '' : ' dB';
    return {
      text: amounts.join('/') + unit,
      description: `AUX ${left.auxIndex + 1}: ${describe(leftLevel)} / AUX ${right.auxIndex + 1}: ${describe(rightLevel)}`,
      split: true,
    };
  }
  const text = positionDbText(position);
  return { text, description: describe(text), split: false };
}

export function mountNudgeView(content, unavailable = () => 'Level controls unavailable.') {
  const document = content.ownerDocument;
  function element(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  const panel = element('section', 'mm-nudge-preview');
  panel.id = 'mm-nudge-preview';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'mm-nudge-preview-title');
  const head = element('div', 'mm-nudge-preview-head');
  const back = element('button', '', '← Faders');
  back.type = 'button';
  const title = element('h2', '', 'Nudge');
  title.id = 'mm-nudge-preview-title';
  head.append(back, title);
  const body = element('div', 'mm-nudge-preview-body');
  const list = element('ul', 'mm-nudge-preview-list');
  list.setAttribute('role', 'list');
  body.append(list);
  panel.append(head, body);
  content.before(panel);
  const rows = new Map(), steps = new WeakMap();
  let statusId = 0;

  function sync(models) {
    const key = ({ kind, model }) => `${kind}:${model.id}`;
    const ids = new Set(models.map(key));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { steps.delete(row.minus); steps.delete(row.plus); row.item.remove(); rows.delete(id); }
    }
    for (const [index, entry] of models.entries()) {
      const { kind, model, target } = entry;
      const id = key(entry);
      let row = rows.get(id);
      if (!row) {
        const item = element('li', 'mm-nudge-preview-row');
        item.dataset.kind = kind;
        const readout = element('div', 'mm-nudge-preview-readout');
        const name = element('strong', 'mm-nudge-preview-name');
        const value = element('span', 'mm-nudge-preview-value');
        value.setAttribute('aria-hidden', 'true');
        const description = element('span', 'mm-sr-only');
        const status = element('span', 'mm-nudge-reason');
        status.id = `mm-nudge-reason-${++statusId}`;
        const minus = element('button', 'mm-nudge-preview-step', '−');
        const plus = element('button', 'mm-nudge-preview-step', '+');
        for (const [button, direction] of [[minus, 'down'], [plus, 'up']]) {
          button.type = 'button';
          button.dataset.nudge = direction;
          button.setAttribute('aria-describedby', status.id);
        }
        readout.append(name, value, description);
        item.append(minus, readout, status, plus);
        row = { item, name, value, description, status, minus, plus };
        rows.set(id, row);
      }
      if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] || null);
      if (row.name.textContent !== model.name) {
        row.name.textContent = model.name;
        row.name.title = model.name;
        row.minus.setAttribute('aria-label', `Lower ${model.name} by ${NUDGE_DOWN_DB} dB`);
        row.plus.setAttribute('aria-label', `Raise ${model.name} by ${NUDGE_UP_DB} dB`);
      }
      const reason = model.unresolved ? 'No received send state.' : unavailable(target);
      if (row.status.textContent !== reason) {
        row.status.textContent = reason;
        row.status.title = reason;
        row.minus.title = row.plus.title = reason;
      }
      const disabled = Boolean(reason);
      if (row.minus.disabled !== disabled) row.minus.disabled = row.plus.disabled = disabled;
      steps.set(row.minus, target);
      steps.set(row.plus, target);
      const { text, description, split } = receivedLevel(model);
      if (row.value.textContent !== text) row.value.textContent = text;
      if (row.description.textContent !== description) {
        row.value.title = description;
        row.description.textContent = description;
      }
      const splitState = String(split);
      if (row.value.dataset.split !== splitState) row.value.dataset.split = splitState;
    }
  }
  return {
    panel,
    back,
    target: button => steps.get(button),
    render(model) {
      const auxIndex = model.selectedAux;
      const { groups: groupModels, expanded } = model.nudgePreview;
      sync([
        { kind: 'aux', model: model.selectedMix, target: { kind: 'master', auxIndex } },
        ...groupModels.map(group => ({ kind: 'group', model: group, target: { kind: 'group', auxIndex, groupId: group.id } })),
        ...(expanded?.channels || []).map(channel => ({ kind: 'channel', model: channel, target: { kind: 'send', auxIndex, sourceId: channel.sourceId } })),
      ]);
    },
    reset() {
      sync([]);
      body.scrollTop = 0;
    },
  };
}
