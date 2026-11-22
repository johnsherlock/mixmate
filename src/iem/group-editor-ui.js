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
    clear = make("button", "", "Clear"),
    remove = make("button", "mm-danger", "Delete group");
  clear.type = remove.type = "button";
  remove.hidden = true;
  bar.append(picks, clear, remove);
  // In-dialog second step for deletion, inside the editor's own dialog lease.
  const confirmRow = make("div", "mm-dialog-actions mm-group-delete-confirm"),
    confirmText = make("p", "mm-caption"),
    keep = make("button", "", "Keep group"),
    destroyGroup = make("button", "mm-danger", "Delete group");
  keep.type = destroyGroup.type = "button";
  confirmText.setAttribute("role", "alert");
  confirmRow.append(confirmText, keep, destroyGroup);
  confirmRow.hidden = true;
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
  // F09-S08 (user decision 2026-11-20): no Export settings button (not in the design).
  actions.append(message, cancel, save);
  content.append(rigLabel, bar, confirmRow, members, status, actions);
  const name = make("input", "mm-group-title-name");
  name.maxLength = 80;
  name.placeholder = "Group name";
  name.setAttribute("aria-label", "Group name");
  let handlers,
    focusBefore,
    active = false,
    busy = false,
    rigName = "", dialogLease = null, replacing = false, aux = null, confirming = false;
  const nodes = new Map(),
    listeners = [];
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push([target, type, callback]);
  };
  const openButton = $('[data-action="edit-groups"]');
  // Create Group / Edit Group opens the editor directly; it no longer detours into rig setup.
  listen(openButton, "click", () => {
    if (!openButton.disabled) handlers?.open();
  });
  listen(cancel, "click", () => handlers?.close());
  listen(closeButton, "click", (event) => {
    if (active && (!connectionUI.dialogOwner || connectionUI.dialogOwner.owns(dialogLease))) { event.stopImmediatePropagation?.(); handlers?.close(); }
  });
  listen(clear, "click", () => handlers?.clear());
  listen(remove, "click", () => handlers?.requestDelete?.());
  listen(keep, "click", () => handlers?.cancelDelete?.());
  listen(destroyGroup, "click", () => handlers?.confirmDelete?.());
  listen(save, "click", () => handlers?.save());
  listen(root, "keydown", (event) => {
    if (active && (!connectionUI.dialogOwner || connectionUI.dialogOwner.owns(dialogLease)) && event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation?.();
      // Escape first backs out of a pending delete confirmation, then closes.
      if (confirming) handlers?.cancelDelete?.();
      else handlers?.close();
    }
  });
  connectionUI.beforeOpen?.(() => handlers?.close());
  return {
    name,
    // Dialog title follows the editor's current draft: new vs existing group.
    title(text) { if (active) $("#mm-dialog-title").textContent = text; },
    cancel,
    save,
    message,
    status,
    busy(value) {
      busy = value;
      name.disabled = clear.disabled = save.disabled = remove.disabled = keep.disabled = destroyGroup.disabled = value;
      for (const button of [
        ...picks.querySelectorAll("button"),
        ...members.querySelectorAll("button"),
      ])
        button.disabled = value;
    },
    saved(message) {
      $(".mm-feedback").textContent = message;
      connectionUI.message?.(message);
    },
    bind(value) {
      handlers = value;
    },
    deletable(value) {
      remove.hidden = !value;
    },
    confirmDelete(groupName) {
      const wasConfirming = confirming;
      confirming = groupName !== null && groupName !== undefined;
      confirmRow.hidden = !confirming;
      confirmText.textContent = confirming
        ? `Delete “${groupName || "Unnamed group"}” from this device? Only this local definition is removed; no mixer changes.`
        : "";
      for (const node of [name, clear, remove, save, ...picks.querySelectorAll("button"), ...members.querySelectorAll("button")])
        node.disabled = busy || confirming;
      if (confirming) keep.focus?.();
      else if (wasConfirming || confirmRow.contains?.(document.activeElement)) this.focusEditor();
    },
    // Keep keyboard/AT focus inside the dialog when transient controls hide.
    focusEditor() {
      if (!active) return;
      const target = !remove.hidden && !remove.disabled ? remove : name;
      target.focus?.();
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
      rigLabel.textContent = `${profileName}. Definitions only; no mixer changes.`;
      head.append(name);
      body.replaceChildren(content);
      layer.hidden = false;
      name.focus();
    },
    scope(value, unionCount = null) {
      aux = value ?? null;
      const scope = aux !== null
        ? `Sources observed for AUX ${aux + 1}`
        : unionCount
          ? "All Mixes: sources received on any available AUX"
          : "No AUX sources received; retained source IDs only";
      rigLabel.textContent = `${rigName} · ${scope} · no mixer changes.`;
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
        button.disabled = busy || confirming;
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
        const label = `${human}${source.name === human ? "" : ` · ${source.name}`}${source.unresolved ? (aux === null ? " · Unresolved — not observed on available AUXes" : " · Unresolved — not observed for this AUX") : ""}`;
        node.order.textContent = index < 0 ? "+" : String(index + 1);
        node.label.textContent = label;
        node.button.setAttribute("title", `${source.id} · ${label}`);
        node.button.disabled = busy || confirming;
        node.button.classList.toggle("mm-picked", index >= 0);
        node.button.dataset.unresolved = String(source.unresolved);
        node.button.setAttribute("aria-pressed", String(index >= 0));
        node.button.setAttribute(
          "aria-label",
          `${label}${index >= 0 ? ` · selected ${index + 1}` : ""}`,
        );
      }
    },
    // F02-S05: one-line reason when no snapshot rig is available.
    unavailable(text) {
      const status = $(".mm-feedback");
      if (status) { status.textContent = text; status.setAttribute?.("aria-label", text); }
      // F07-S05: a lasting reason never replaces a transient message that is showing (e.g. the update notice); the controller's lasting condition shows it afterwards.
      if (text && !connectionUI.diagnostics?.transientMessage?.() && connectionUI.diagnostics?.currentMessage?.() !== text) connectionUI.message?.(text);
    },
    destroy() {
      for (const [target, type, callback] of listeners)
        target.removeEventListener(type, callback);
      connectionUI.beforeOpen?.(() => {});
    },
  };
}
