import { definitionOwner, settingsStatusText, validateSettings } from "../settings.js";
import { sourceLabel } from "./live-provider.js";
const clone = (value) => structuredClone(value);
const sourceID = /^(?:i|l|p|f)\.(?:0|[1-9]\d{0,2})$/;

// A local definition editor only: no session/transport/writer capability enters.
export function mountGroupEditor({
  repository,
  controller,
  ui,
  setEnabled = () => {},
  createID = () => globalThis.crypto.randomUUID(),
  confirmClear = () => false,
}) {
  // Deleting is a two-step in-dialog confirmation owned by this editor's lease;
  // it never opens another dialog and commits only through the settings updater.
  let context = controller.context(),
    stored = repository.snapshot(),
    draft = null,
    baseline = null,
    binding = null,
    pending = Promise.resolve(),
    destroyed = false,
    saving = false,
    operation = 0,
    lastMembers = null,
    confirmingDelete = false,
    // Set only while this editor's own delete of the expanded group is pending.
    deleteCollapse = null;
  // Contexts without an explicit owner predate device-local definitions and can
  // only address a bound saved rig.
  const owner = () =>
    context.owner !== undefined
      ? context.owner
      : context.profileId
        ? { kind: "profile", id: context.profileId }
        : null;
  // The device-local set has no stored record until its first saved group.
  // Malformed owners address nothing rather than granting editor access.
  const definition = () => {
    try {
      return owner()?.id ? definitionOwner(stored.settings, owner()) : null;
    } catch {
      return null;
    }
  };
  const available = () =>
    Boolean(
      context.ready &&
        owner() &&
        (owner().kind === "local" || definition()),
    );
  const groups = () => definition()?.groups || [];
  const ownerLabel = () =>
    owner()?.kind === "profile"
      ? `Saved rig: ${definition()?.name || context.ownerName || "unknown"}`
      : "Groups on this device — no saved rig selected";
  const validBinding = () => {
    const current = owner();
    if (!binding || !current || context.revision !== binding.revision) return false;
    if (current.kind !== binding.kind) return false;
    if (current.kind === "profile") return current.id === binding.id;
    // A local set may gain its stable ID from this editor's own first save.
    return binding.id === null || current.id === null || current.id === binding.id;
  };
  function catalog() {
    const rows = context.catalog || context.sources;
    const available = new Map(
      rows
        .filter((source) => sourceID.test(source.sourceId))
        .map((source) => [source.sourceId, source]),
    );
    const ids = [...available.keys()];
    for (const id of [...(baseline?.members || []), ...(draft?.members || [])])
      if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => ({
      id,
      name: available.get(id)?.name || sourceLabel(id),
      unresolved: !available.has(id),
    }));
  }
  function paintMembers() {
    if (!draft) return;
    ui.scope?.(
      context.selectedAux,
      context.selectedAux === null || context.selectedAux === undefined
        ? (context.catalog || []).length
        : null,
    );
    const sources = catalog(),
      signature = JSON.stringify([sources, draft.members]);
    if (signature !== lastMembers) {
      lastMembers = signature;
      ui.members(sources, draft.members);
    }
  }
  function setConfirmingDelete(value) {
    confirmingDelete = value;
    ui.confirmDelete?.(value ? draft?.name || baseline?.name || "" : null);
  }
  function close() {
    operation++;
    if (confirmingDelete) setConfirmingDelete(false);
    lastMembers = null;
    saving = false;
    ui.busy(false);
    draft = baseline = binding = null;
    ui.hide();
  }
  function selectGroup(id) {
    if (saving) return;
    operation++;
    if (!available() || !validBinding()) {
      close();
      return;
    }
    if (confirmingDelete) setConfirmingDelete(false);
    const group = groups().find((group) => group.id === id);
    baseline = group ? clone(group) : null;
    draft = group ? clone(group) : { id: createID(), name: "", members: [] };
    ui.name.value = draft.name;
    ui.choices(groups(), group?.id || null);
    ui.deletable?.(Boolean(group));
    ui.message.textContent =
      "Tap order becomes fader order. Unresolved IDs stay selected until you remove them.";
    ui.cancel.textContent = "Cancel";
    paintMembers();
  }
  function open(id = null) {
    if (saving || !available()) return false;
    binding = { ...owner(), revision: context.revision };
    ui.show(ownerLabel());
    selectGroup(id || context.expandedGroupId || groups()[0]?.id || null);
    return true;
  }
  function toggle(id) {
    if (
      saving ||
      confirmingDelete ||
      !draft ||
      !validBinding() ||
      !catalog().some((source) => source.id === id)
    )
      return;
    const index = draft.members.indexOf(id);
    if (index >= 0) draft.members.splice(index, 1);
    else if (draft.members.length < 128) draft.members.push(id);
    else {
      ui.message.textContent = "A group can contain at most 128 source IDs.";
      return;
    }
    ui.cancel.textContent = "Cancel";
    paintMembers();
  }
  function clear() {
    if (saving || confirmingDelete || !draft || !validBinding() || !confirmClear()) return;
    draft.members = [];
    ui.cancel.textContent = "Cancel";
    paintMembers();
    ui.message.textContent =
      "Draft cleared. Save group to apply; Cancel leaves the saved definition unchanged.";
  }
  // Tokens address canonical definitions by owner; the local set's ID is either
  // the stored one or a fresh ID created only by this transaction.
  function capture() {
    const current = owner(),
      token = { kind: binding.kind, id: binding.id ?? current?.id ?? null, revision: binding.revision, operation: ++operation };
    if (token.kind === "local" && token.id === null) token.createdId = createID();
    return token;
  }
  const currentFor = (token) =>
    !destroyed &&
    operation === token.operation &&
    Boolean(draft) &&
    validBinding() &&
    context.revision === token.revision &&
    owner()?.kind === token.kind &&
    (token.kind !== "profile" || owner().id === token.id);
  function target(settings, token, create) {
    if (token.kind === "profile") {
      const rig = settings.profiles.find((profile) => profile.id === token.id);
      if (!rig) throw Error("The saved rig no longer exists.");
      return rig;
    }
    const changed = "Device-local groups changed. Reopen Edit Groups before saving.";
    if (token.id !== null) {
      if (settings.localDefinitions?.id !== token.id) throw Error(changed);
      return settings.localDefinitions;
    }
    if (settings.localDefinitions) throw Error(changed);
    if (!create) throw Error("This group no longer exists.");
    settings.localDefinitions = {
      id: token.createdId,
      groups: [],
      navigation: { mixId: null, view: "groups", expandedGroupId: null },
    };
    return settings.localDefinitions;
  }
  const guard = (token) => {
    if (
      destroyed ||
      operation !== token.operation ||
      context.revision !== token.revision ||
      !validBinding()
    )
      throw Error("The rig or session changed; this draft was not applied.");
  };
  function adopt(result, token) {
    // Bind this editor to the local identity created by its own committed draft.
    if (token.createdId && result.settings.localDefinitions?.id === token.createdId) binding.id = token.createdId;
    const ownerId = token.createdId && binding.id === token.createdId ? token.createdId : token.id;
    return token.kind === "profile"
      ? result.settings.profiles.find((profile) => profile.id === ownerId)
      : result.settings.localDefinitions?.id === ownerId
        ? result.settings.localDefinitions
        : null;
  }
  const durable = (result) =>
    result.status.mode === "persistent" && result.status.state === "saved";
  function save() {
    if (saving || confirmingDelete || !draft || !validBinding()) return Promise.resolve();
    const next = {
        id: draft.id,
        name: ui.name.value.trim(),
        members: [...draft.members],
      },
      original = baseline && clone(baseline),
      token = capture();
    const change = (settings) => {
      guard(token);
      const rig = target(settings, token, !original);
      const index = rig.groups.findIndex((group) => group.id === next.id);
      if (original) {
        if (
          index < 0 ||
          JSON.stringify(rig.groups[index]) !== JSON.stringify(original)
        )
          throw Error(
            "This group changed while you were editing. Reopen it before saving.",
          );
        rig.groups[index] = clone(next);
      } else {
        if (index >= 0) throw Error("This group identity already exists.");
        if (rig.groups.length >= 64)
          throw Error("A group set can contain at most 64 groups.");
        rig.groups.push(clone(next));
      }
    };
    try {
      const candidate = clone(stored.settings);
      change(candidate);
      validateSettings(candidate);
    } catch (error) {
      ui.message.textContent = `Group not saved. ${error.message}`;
      return Promise.resolve();
    }
    saving = true;
    ui.cancel.textContent = "Close";
    ui.busy(true);
    ui.message.textContent = "Saving local group…";
    pending = repository
      .update(change)
      .then((result) => {
        if (!currentFor(token)) return;
        const saved = adopt(result, token)?.groups.find((group) => group.id === next.id);
        if (saved) {
          baseline = clone(saved);
          draft = clone(saved);
          ui.name.value = saved.name;
          ui.choices(groups(), saved.id);
          ui.deletable?.(true);
          paintMembers();
          ui.cancel.textContent = "Close";
        }
        ui.message.textContent = durable(result)
          ? settingsStatusText(result.status)
          : "Group definition is temporary; it was not saved on this device. Choose Export settings here before closing or leaving this page. Check the storage message below; reopen after resolving storage or another-window edits.";
        if (durable(result)) {
          close();
          ui.saved(settingsStatusText(result.status));
        }
      })
      .catch((error) => {
        if (currentFor(token)) {
          ui.cancel.textContent = "Cancel";
          ui.message.textContent = `Group not saved. ${error.message}`;
        }
      })
      .finally(() => {
        if (!destroyed && operation === token.operation) {
          saving = false;
          ui.busy(false);
        }
      });
    return pending;
  }
  // Step one of deletion: only a saved group with an unchanged baseline can be
  // offered; nothing is changed until the in-dialog confirmation is chosen.
  function requestDelete() {
    if (saving || !draft || !baseline || !validBinding()) return false;
    setConfirmingDelete(true);
    ui.message.textContent =
      "Delete this group from this device? Only the local definition is removed; no mixer changes.";
    return true;
  }
  function cancelDelete() {
    if (!confirmingDelete) return;
    setConfirmingDelete(false);
    ui.message.textContent = "Delete cancelled. The saved group is unchanged.";
  }
  function confirmDelete() {
    if (saving || !confirmingDelete || !draft || !baseline || !validBinding()) return Promise.resolve();
    const original = clone(baseline),
      token = capture();
    setConfirmingDelete(false);
    // Deleting the expanded group collapses navigation, which advances the
    // controller revision once; that self-caused change must not close the
    // editor before its saved/temporary outcome is shown.
    deleteCollapse = context.expandedGroupId === original.id
      ? { token, groupId: original.id, selectedAux: context.selectedAux }
      : null;
    const change = (settings) => {
      guard(token);
      const rig = target(settings, token, false);
      const index = rig.groups.findIndex((group) => group.id === original.id);
      if (index < 0 || JSON.stringify(rig.groups[index]) !== JSON.stringify(original))
        throw Error("This group changed while you were editing. Reopen it before deleting.");
      rig.groups.splice(index, 1);
      if (rig.navigation.expandedGroupId === original.id) rig.navigation.expandedGroupId = null;
    };
    try {
      const candidate = clone(stored.settings);
      change(candidate);
      validateSettings(candidate);
    } catch (error) {
      ui.message.textContent = `Group not deleted. ${error.message}`;
      return Promise.resolve();
    }
    saving = true;
    ui.cancel.textContent = "Close";
    ui.busy(true);
    // Busy disables the focused confirm control; Cancel stays enabled.
    ui.cancel.focus?.();
    ui.message.textContent = "Deleting local group…";
    pending = repository
      .update(change)
      .then((result) => {
        if (!currentFor(token)) return;
        saving = false;
        ui.busy(false);
        if (durable(result)) {
          close();
          ui.saved(`Group deleted. ${settingsStatusText(result.status)}`);
          return;
        }
        // The accepted memory state no longer has this group; show what remains.
        selectGroup(groups()[0]?.id || null);
        ui.cancel.textContent = "Close";
        ui.message.textContent =
          "Group deletion is temporary; it was not saved on this device. Choose Export settings here before closing or leaving this page. Check the storage message below; reopen after resolving storage or another-window edits.";
      })
      .catch((error) => {
        if (currentFor(token)) {
          ui.cancel.textContent = "Cancel";
          ui.message.textContent = `Group not deleted. ${error.message}`;
        }
      })
      .finally(() => {
        if (!destroyed && operation === token.operation) {
          saving = false;
          ui.busy(false);
          // Temporary or failed deletes leave the dialog open; keep focus in it
          // on the name field rather than another group's Delete button.
          ui.name.focus?.();
        }
        deleteCollapse = null;
      });
    return pending;
  }
  const unsubscribeSettings = repository.subscribe((snapshot) => {
    stored = snapshot;
    ui.status.textContent = settingsStatusText(snapshot.status);
    setEnabled(available());
    if (draft && (!available() || !validBinding())) close();
  });
  // Accept exactly the single revision step caused by this editor's own
  // pending delete collapsing the expanded group; anything else still closes.
  function rebaseOwnCollapse(previous, next) {
    const pendingDelete = deleteCollapse;
    if (!pendingDelete || !saving || !binding || pendingDelete.token.operation !== operation) return;
    if (previous.expandedGroupId !== pendingDelete.groupId || next.expandedGroupId !== null) return;
    if (next.selectedAux !== pendingDelete.selectedAux || next.revision !== binding.revision + 1) return;
    if (JSON.stringify(next.owner) !== JSON.stringify(previous.owner) || next.profileId !== previous.profileId) return;
    binding.revision = next.revision;
    pendingDelete.token.revision = next.revision;
    deleteCollapse = null;
  }
  const unsubscribeContext = controller.subscribeContext((next) => {
    const previous = context;
    context = next;
    rebaseOwnCollapse(previous, next);
    setEnabled(available());
    if (draft && (!available() || !validBinding())) close();
    else paintMembers();
  });
  ui.bind({ open, close, selectGroup, toggle, clear, save, requestDelete, cancelDelete, confirmDelete, exportSettings() { ui.message.textContent = controller.exportSettings(); } });
  return {
    open,
    close,
    snapshot: () => (draft ? clone(draft) : null),
    whenIdle: () => pending,
    destroy() {
      destroyed = true;
      close();
      unsubscribeSettings();
      unsubscribeContext();
      ui.destroy();
      setEnabled(false);
    },
  };
}
