import { settingsStatusText, validateSettings } from "../settings.js";
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
  let context = controller.context(),
    stored = repository.snapshot(),
    draft = null,
    baseline = null,
    binding = null,
    pending = Promise.resolve(),
    destroyed = false,
    saving = false,
    operation = 0,
    lastMembers = null;
  const profile = () =>
    stored.settings.profiles.find(
      (profile) => profile.id === context.profileId,
    );
  const validBinding = () =>
    binding &&
    context.profileId === binding.profileId &&
    context.revision === binding.revision;
  function catalog() {
    const available = new Map(
      context.sources
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
    ui.scope?.(context.selectedAux);
    const sources = catalog(),
      signature = JSON.stringify([sources, draft.members]);
    if (signature !== lastMembers) {
      lastMembers = signature;
      ui.members(sources, draft.members);
    }
  }
  function close() {
    operation++;
    lastMembers = null;
    saving = false;
    ui.busy(false);
    draft = baseline = binding = null;
    ui.hide();
  }
  function selectGroup(id) {
    if (saving) return;
    operation++;
    const rig = profile();
    if (!rig || !validBinding()) {
      close();
      return;
    }
    const group = rig.groups.find((group) => group.id === id);
    baseline = group ? clone(group) : null;
    draft = group ? clone(group) : { id: createID(), name: "", members: [] };
    ui.name.value = draft.name;
    ui.choices(rig.groups, group?.id || null);
    ui.message.textContent =
      "Tap order becomes fader order. Unresolved IDs stay selected until you remove them.";
    ui.cancel.textContent = "Cancel";
    paintMembers();
  }
  function open(id = null) {
    if (saving || !context.ready || !profile()) return false;
    binding = { profileId: context.profileId, revision: context.revision };
    ui.show(profile().name);
    selectGroup(id || profile().groups[0]?.id || null);
    return true;
  }
  function toggle(id) {
    if (
      saving ||
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
    if (saving || !draft || !validBinding() || !confirmClear()) return;
    draft.members = [];
    ui.cancel.textContent = "Cancel";
    paintMembers();
    ui.message.textContent =
      "Draft cleared. Save group to apply; Cancel leaves the saved definition unchanged.";
  }
  function save() {
    if (saving || !draft || !validBinding()) return Promise.resolve();
    const next = {
        id: draft.id,
        name: ui.name.value.trim(),
        members: [...draft.members],
      },
      original = baseline && clone(baseline),
      token = { ...binding, operation: ++operation };
    const change = (settings) => {
      if (
        destroyed ||
        operation !== token.operation ||
        context.profileId !== token.profileId ||
        context.revision !== token.revision
      )
        throw Error("The rig or session changed; this draft was not applied.");
      const rig = settings.profiles.find(
        (profile) => profile.id === token.profileId,
      );
      if (!rig) throw Error("The local rig no longer exists.");
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
          throw Error("A local rig can contain at most 64 groups.");
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
        if (
          destroyed ||
          operation !== token.operation ||
          !draft ||
          !validBinding() ||
          binding.profileId !== token.profileId ||
          binding.revision !== token.revision
        )
          return;
        const saved = result.settings.profiles
          .find((profile) => profile.id === token.profileId)
          ?.groups.find((group) => group.id === next.id);
        if (saved) {
          baseline = clone(saved);
          draft = clone(saved);
          ui.name.value = saved.name;
          ui.choices(profile().groups, saved.id);
          paintMembers();
          ui.cancel.textContent = "Close";
        }
        ui.message.textContent =
          result.status.mode === "persistent" && result.status.state === "saved"
            ? settingsStatusText(result.status)
            : "Group definition is temporary; it was not saved on this device.";
        if (
          result.status.mode === "persistent" &&
          result.status.state === "saved"
        ) {
          close();
          ui.saved(settingsStatusText(result.status));
        }
      })
      .catch((error) => {
        if (
          !destroyed &&
          operation === token.operation &&
          draft &&
          validBinding()
        ) {
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
  const unsubscribeSettings = repository.subscribe((snapshot) => {
    stored = snapshot;
    ui.status.textContent = settingsStatusText(snapshot.status);
    setEnabled(Boolean(context.ready && profile()));
    if (draft && !profile()) close();
  });
  const unsubscribeContext = controller.subscribeContext((next) => {
    context = next;
    setEnabled(Boolean(context.ready && profile()));
    if (draft && !validBinding()) close();
    else paintMembers();
  });
  ui.bind({ open, close, selectGroup, toggle, clear, save });
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
