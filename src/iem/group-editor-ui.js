import { restoreDialogFocus } from "./dialog-owner.js";
import { sourceLabel } from "./live-provider.js";

export function createGroupEditorUI(root, connectionUI) {
  const document = root.ownerDocument,
    $ = (selector) => root.querySelector(selector);
  const make = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const layer = $(".mm-layer"),
    dialog = $(".mm-dialog"),
    body = $(".mm-dialog-body"),
    head = $(".mm-dialog-head"),
    closeButton = head.querySelector("button");
  const content = make("div", "mm-local-group-editor"),
    rigLabel = make("p", "mm-caption mm-group-rig-label");
  const bar = make("div", "mm-group-editor-bar"),
    picks = make("div", "mm-group-picks"),
    clear = make("button", "", "Clear");
  clear.type = "button";
  bar.append(picks, clear);
  const members = make("div", "mm-member-checks");
  members.setAttribute("aria-label", "Toggle ordered group membership");
  const status = make("p", "mm-caption"),
    message = make(
      "span",
      "mm-editor-feedback",
      "Tap order becomes fader order",
    );
  status.setAttribute("role", "status");
  message.setAttribute("role", "status");
  const actions = make("div", "mm-dialog-actions"),
    cancel = make("button", "", "Cancel"),
    save = make("button", "mm-primary", "Save group");
  cancel.type = save.type = "button";
  actions.append(message, cancel, save);
  content.append(rigLabel, bar, members, status, actions);
  const name = make("input", "mm-group-title-name");
  name.maxLength = 80;
  name.placeholder = "Group name";
  name.setAttribute("aria-label", "Group name");
  let handlers,
    focusBefore,
    active = false,
    busy = false,
    rigName = "", dialogLease = null, replacing = false;
  const nodes = new Map(),
    listeners = [];
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push([target, type, callback]);
  };
  const openButton = $('[data-action="edit-groups"]');
  listen(openButton, "click", () => {
    if (!openButton.disabled) handlers?.open();
  });
  listen(cancel, "click", () => handlers?.close());
  listen(closeButton, "click", (event) => {
    if (active && (!connectionUI.dialogOwner || connectionUI.dialogOwner.owns(dialogLease))) { event.stopImmediatePropagation?.(); handlers?.close(); }
  });
  listen(clear, "click", () => handlers?.clear());
  listen(save, "click", () => handlers?.save());
  listen(root, "keydown", (event) => {
    if (active && (!connectionUI.dialogOwner || connectionUI.dialogOwner.owns(dialogLease)) && event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation?.();
      handlers?.close();
    }
  });
  connectionUI.beforeOpen?.(() => handlers?.close());
  return {
    name,
    cancel,
    save,
    message,
    status,
    busy(value) {
      busy = value;
      name.disabled = clear.disabled = save.disabled = value;
      for (const button of [
        ...picks.querySelectorAll("button"),
        ...members.querySelectorAll("button"),
      ])
        button.disabled = value;
    },
    saved(message) {
      $(".mm-feedback").textContent = message;
    },
    bind(value) {
      handlers = value;
    },
    show(profileName) {
      if (connectionUI.dialogOwner && !connectionUI.dialogOwner.owns(dialogLease)) {
        const next = connectionUI.dialogOwner.claim('groups', reason => {
          replacing = reason?.replaced === true;
          handlers?.close(); replacing = false;
        });
        if (!next) return; dialogLease = next;
      } else if (!connectionUI.dialogOwner) connectionUI.close();
      focusBefore = document.activeElement;
      active = true;
      dialog.classList.remove("mm-pan-dialog"); dialog.classList.add("mm-group-dialog");
      $("#mm-dialog-title").textContent = "Edit groups";
      rigName = profileName;
      rigLabel.textContent = `Local rig: ${profileName}. Definitions only; no mixer changes.`;
      head.append(name);
      body.replaceChildren(content);
      layer.hidden = false;
      name.focus();
    },
    scope(aux) {
      rigLabel.textContent = `Local rig: ${rigName} · ${aux === null || aux === undefined ? "No AUX selected; retained source IDs only" : `Sources observed for AUX ${aux + 1}`} · no mixer changes.`;
    },
    hide() {
      if (!active) return;
      active = false;
      connectionUI.dialogOwner?.release(dialogLease);
      if (!connectionUI.dialogOwner?.active()) layer.hidden = true;
      name.remove();
      dialog.classList.remove("mm-group-dialog");
      if (!replacing && !connectionUI.dialogOwner?.active()) restoreDialogFocus(focusBefore);
    },
    choices(groups, selectedID) {
      picks.replaceChildren();
      for (const group of [...groups, { id: null, name: "+ New" }]) {
        const button = make(
          "button",
          group.id === selectedID ? "mm-active" : "",
          group.name,
        );
        button.type = "button";
        button.disabled = busy;
        button.dataset.groupId = group.id || "";
        button.setAttribute("aria-pressed", String(group.id === selectedID));
        button.addEventListener("click", () => handlers?.selectGroup(group.id));
        picks.append(button);
      }
    },
    members(catalog, selected) {
      const ids = new Set(catalog.map((source) => source.id));
      for (const [id, node] of nodes)
        if (!ids.has(id)) {
          node.button.remove();
          nodes.delete(id);
        }
      for (const [position, source] of catalog.entries()) {
        let node = nodes.get(source.id);
        if (!node) {
          const button = make("button"),
            order = make("b"),
            label = make("span");
          button.type = "button";
          button.dataset.sourceId = source.id;
          button.append(order, label);
          button.addEventListener("click", () => handlers?.toggle(source.id));
          node = { button, order, label };
          nodes.set(source.id, node);
          members.append(button);
        }
        if (members.children[position] !== node.button)
          members.insertBefore(node.button, members.children[position] || null);
        const index = selected.indexOf(source.id),
          human = sourceLabel(source.id);
        const label = `${human}${source.name === human ? "" : ` · ${source.name}`}${source.unresolved ? " · Unresolved — not observed for this AUX" : ""}`;
        node.order.textContent = index < 0 ? "+" : String(index + 1);
        node.label.textContent = label;
        node.button.setAttribute("title", `${source.id} · ${label}`);
        node.button.disabled = busy;
        node.button.classList.toggle("mm-picked", index >= 0);
        node.button.dataset.unresolved = String(source.unresolved);
        node.button.setAttribute("aria-pressed", String(index >= 0));
        node.button.setAttribute(
          "aria-label",
          `${label}${index >= 0 ? ` · selected ${index + 1}` : ""}`,
        );
      }
    },
    destroy() {
      for (const [target, type, callback] of listeners)
        target.removeEventListener(type, callback);
      connectionUI.beforeOpen?.(() => {});
    },
  };
}
