import { positionDbText } from './fader-scale.js';

function receivedLevel({ sides, position }) {
  if (sides?.length > 1 && (sides[0].position === undefined || sides.some(side => side.position !== sides[0].position))) {
    return sides.map(side => `AUX ${side.auxIndex + 1} · ${positionDbText(side.position)}`).join(' / ');
  }
  return positionDbText(position);
}

export function mountNudgePreview(content) {
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
  const note = element('p', 'mm-nudge-preview-note', 'Design preview · taps leave levels unchanged');
  note.id = 'mm-nudge-preview-note';
  head.append(back, title, note);
  const body = element('div', 'mm-nudge-preview-body');
  const list = element('ul', 'mm-nudge-preview-list');
  list.setAttribute('role', 'list');
  body.append(list);
  panel.append(head, body);
  content.before(panel);
  const rows = new Map();

  function sync(models) {
    const key = ({ kind, model }) => `${kind}:${model.id}`;
    const ids = new Set(models.map(key));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.item.remove(); rows.delete(id); }
    }
    for (const [index, entry] of models.entries()) {
      const { kind, category, model } = entry;
      const id = key(entry);
      let row = rows.get(id);
      if (!row) {
        const item = element('li', 'mm-nudge-preview-row');
        item.dataset.kind = kind;
        const readout = element('div', 'mm-nudge-preview-readout');
        const name = element('strong', 'mm-nudge-preview-name');
        const value = element('span', 'mm-nudge-preview-value');
        const minus = element('button', 'mm-nudge-preview-step', '−');
        const plus = element('button', 'mm-nudge-preview-step', '+');
        for (const button of [minus, plus]) {
          button.type = 'button';
          button.setAttribute('aria-describedby', note.id);
        }
        // Preview buttons have only native press feedback. Their identities
        // are separate from the live fader gesture and nudge handlers.
        readout.append(name, value);
        item.append(minus, readout, plus);
        row = { item, name, value, minus, plus };
        rows.set(id, row);
      }
      if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] || null);
      if (row.name.textContent !== model.name) {
        row.name.textContent = model.name;
        row.name.title = model.name;
        row.minus.setAttribute('aria-label', `Preview lowering ${category} ${model.name}`);
        row.plus.setAttribute('aria-label', `Preview raising ${category} ${model.name}`);
      }
      const level = receivedLevel(model);
      if (row.value.textContent !== level) {
        row.value.textContent = level;
        row.value.title = level;
        row.value.setAttribute('aria-label', level === '—' ? 'Level unavailable' : level);
      }
    }
  }
  return {
    panel,
    back,
    render(model) {
      const { groups: groupModels, expanded } = model.nudgePreview;
      sync([
        { kind: 'aux', category: 'AUX master', model: model.selectedMix },
        ...groupModels.map(group => ({ kind: 'group', category: 'group master', model: group })),
        ...(expanded?.channels || []).map(channel => ({ kind: 'channel', category: 'channel', model: channel })),
      ]);
    },
    reset() {
      sync([]);
      body.scrollTop = 0;
    },
  };
}
