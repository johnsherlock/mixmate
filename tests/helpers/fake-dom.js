// Minimal event-bubbling DOM for control ownership/race tests; no browser/network.
export class Node {
  children = []; dataset = {}; attributes = {}; handlers = new Map(); value = ''; disabled = false; hidden = false; className = ''; tag = 'div';
  style = { setProperty() {} };
  constructor(document) { this.ownerDocument = document; }
  get textContent() { return this._text || this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = value; this.replaceChildren(); }
  get isConnected() { let node = this; while (node.parentElement) node = node.parentElement; return node === this.ownerDocument?.root; }
  classList = { contains: name => (this.className || '').split(' ').includes(name), add: (...names) => { this.className = [...new Set([...(this.className || '').split(' '), ...names])].filter(Boolean).join(' '); }, remove: (...names) => { this.className = (this.className || '').split(' ').filter(name => !names.includes(name)).join(' '); }, toggle: (name, value) => { if (value ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); } };
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  before(node) { this.parentElement.insertBefore(node, this); }
  insertBefore(node, reference) { node.remove(); node.parentElement = this; this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, node); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; } }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  matches(selector) {
    if (selector === '*') return true;
    if (selector === '[hidden]') return this.hidden;
    const tag = /^\w+/.exec(selector)?.[0]; if (tag && tag !== this.tag) return false;
    const id = /#([\w-]+)/.exec(selector)?.[1]; if (id && id !== this.id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
    for (const [, key, value] of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
      const actual = key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.attributes[key];
      if (actual === undefined || value !== undefined && String(actual) !== value) return false;
    }
    return true;
  }
  closest(selector) { if (selector.split(',').some(part => this.matches(part.trim()))) return this; return this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    const all = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
    return all.filter(node => selector.split(',').some(choice => {
      const pieces = choice.trim().split(/\s+/), last = pieces.pop();
      if (!node.matches(last)) return false;
      let parent = node.parentElement;
      for (const piece of pieces.reverse()) { while (parent && !parent.matches(piece)) parent = parent.parentElement; if (!parent) return false; parent = parent.parentElement; }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { this.handlers.set(type, [...this.handlers.get(type) || [], callback]); }
  removeEventListener(type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter(fn => fn !== callback)); }
  emit(type, event = {}) {
    const delivered = { target: this, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...event };
    for (let node = this; node; node = node.parentElement) {
      for (const fn of [...node.handlers.get(type) || []]) { fn(delivered); if (delivered.stopped) return; }
      if (event.bubbles === false) break;
    }
  }
  dispatchEvent(event) { this.emit(event.type, { target: this }); return true; }
  focus() { this.ownerDocument.activeElement = this; this.onFocus?.(); }
  getBoundingClientRect() { return { width: this.classList.contains('mm-pan-large') ? 400 : 42, height: 200, top: 0, bottom: 200, left: 0 }; }
  setPointerCapture(id) { this.capture = id; }
  releasePointerCapture(id) { this.capture = null; this.emit('lostpointercapture', { pointerId: id }); }
  setCustomValidity() {} reportValidity() {}
}
export function domFixture() {
  const document = { hidden: false, activeElement: null, createElement(tag) { return Object.assign(new Node(this), { tag }); } };
  const documentEvents = new Node(document); document.addEventListener = documentEvents.addEventListener.bind(documentEvents); document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
  const root = document.createElement('div'); document.root = root;
  for (const name of ['mm-content', 'mm-clock', 'mm-navigation', 'mm-group-switches', 'mm-local-tabs', 'mm-snapshot-name', 'mm-desk', 'mm-feedback', 'mm-dirty', 'mm-rec-state', 'mm-mode-label', 'mm-app', 'mm-preview']) { const node = document.createElement('div'); node.className = name; root.append(node); }
  const edit = document.createElement('button'); edit.dataset.action = 'edit-groups'; root.querySelector('.mm-local-tabs').append(edit);
  const brand = document.createElement('button'); brand.className = 'mm-brand'; root.append(brand);
  const layer = document.createElement('div'); layer.className = 'mm-layer'; layer.hidden = true;
  const dialog = document.createElement('div'); dialog.className = 'mm-dialog';
  const head = document.createElement('div'); head.className = 'mm-dialog-head';
  const title = document.createElement('h3'); title.id = 'mm-dialog-title'; const close = document.createElement('button');
  const body = document.createElement('div'); body.className = 'mm-dialog-body'; head.append(title, close); dialog.append(head, body); layer.append(dialog); root.append(layer);
  return { document, root, head, close, body, layer, title };
}
