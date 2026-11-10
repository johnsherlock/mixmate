# Ordered local group definitions — F04-S01

Date: 2026-11-09. Baseline: F03-S04 merged in [PR #19](https://github.com/johnsherlock/mixmate/pull/19), main `14cf968`, after green checks and affirmative Codex review of final head `c3fb9c4`. This story edits local definitions only; no mixer writer or active allowlist changes.

## Scoped plan and dependency

Use the accepted editor layout to create/edit ordered group definitions in the F02 repository. Bind the editor to a stable local profile, discover candidate source IDs only from observed sends on the selected AUX, and retain unresolved existing IDs. Save/Cancel/Clear operate on a draft, with storage outcomes visible. Keep group browsing/expanded strips/navigation persistence with F04-S02 and relative level controls with F05.

The user-approved ADR-0002 dependency exception permits this independent local work after F03's source-backed implementation checkpoint. Current-firmware corroboration and physical Android/iOS/offline qualification remain open in F08-S01; they are not inferred passes.

## Local identity and availability

An untouched settings-selected profile ID is the active local rig, shown in the editor. Explicit profile selection in the connection dialog changes that ID and disconnects first. Manual address editing, a changed target at Connect, or an early/touched target before settings finish detaches the group binding; matching IP addresses never infer identity. Duplicate-address profiles remain distinct. No new rig or demo group is created by this editor; create/save rigs in the connection test.

A bound local rig can edit definitions while disconnected. With no selected/observed AUX, existing source IDs appear as **Unresolved** and remain selected. In a received AUX, candidate IDs come only from `projectLiveState().sources`, which itself discovers observed sends across input, line, player and FX families. A name alone, profile bounds or meter packet does not create availability. One FX ID remains its intrinsic stereo source; it is not expanded into adjacent FX IDs.

Buttons show human source family/number, received names when available and explicit unresolved status. Raw IDs stay in stable keys/data/title and the saved membership array. Received names are assigned through textContent in memory; they are never copied into stored group definitions. A missing member is not replaced by the channel occupying a similar position or carrying a similar name.

## Draft and persistence contract

- Group name and ordered member IDs are copied into an editor draft. Toggling off/on moves an ID to the end; numbered choices express the exact saved order. Unresolved baseline members stay available for deliberate removal/re-addition.
- Clear requires confirmation and empties only the draft. Cancel/Close before Save leaves the accepted definitions unchanged. Save validates name/identity/order through the canonical repository boundary.
- A successful durable Save closes the editor and announces success. Memory-only/conflicting saves stay open with explicit temporary status and a Close label; they do not pretend Cancel can undo an already accepted memory definition. Temporary data is local to the current document and must not be assumed to survive leaving it.
- Empty member lists are valid local definitions: confirmed Clear followed by Save can retain the group's stable ID/name with no members. This does not invent an adjustable group master; later navigation/control must handle an empty group as unavailable.
- Limits follow the existing schema: 64 groups/rig, 128 unique members/group, 1–80-character trimmed names. New groups get crypto-random local IDs; there are no seeded names/members and no group deletion action beyond the accepted create/edit/Clear workflow.
- Save uses `repository.update` against the current canonical document and changes only the captured profile/group. Concurrent preferences, other profiles and unrelated groups are retained. An edited group's captured baseline must still match; stale same-document edits are rejected. Cross-window changes use the repository's atomic durable-baseline guard and remain visibly temporary rather than overwriting the newer record.

## Lifecycle and read-only boundary

The live controller publishes a local profile/context revision separately from received data. Target changes, Connect, disconnect, hiding, page navigation, explicit AUX navigation and an incoming mode/model change that removes the selected AUX invalidate/close the draft. Disconnect keeps the same local rig binding available for explicit offline editing; it clears all received choices/state. Manual targets detach identity entirely.

A queued Save checks its original profile/context/operation again before applying its updater. It cannot be replayed into another profile or overwrite a newly opened editor. Once a valid updater/transaction has already been accepted, storage may finish for that original profile; completion never switches profiles, reconnects or overwrites a later draft. Repeated Save and membership/name controls are disabled during persistence, with closure/invalidation still possible.

Meter-only publications do not notify/rebuild the editor. Unchanged source/name catalogs are deduplicated. Real received name changes reconcile text on stable member buttons without changing the user's draft name/order. The shared connection dialog restores its own form when reopened; opening it closes an editor draft. Both dialogs retain keyboard focus/Escape/Tab behavior.

All app-to-mixer traffic remains the read-only session's literal INIT, ALIVE and heartbeat forms. Local membership changes never call the input `.mix` writer, alter observations or synthesize levels/meters. The demo, reference, root connection test and compact fader geometry remain separate and unchanged.

## Validation

Local/fake checks cover ordered drafts, unresolved/offline IDs, Clear confirmation, Save/Cancel, durable reopen, source text, stable member DOM, limits/invalid names, duplicate Save, concurrent preferences/groups, stale local groups, memory/conflict outcomes, same-address identities and actual session lifecycle/meter invalidation. Browser QA and final test/build evidence are recorded in the story. No real mixer connection or actuation is needed; physical qualification remains open.

## F04-S02 scoped plan and routine choices

Baseline: reviewed S01 merge `61944be` / PR #20. Add group shortcuts and a keyed bank projection, retaining the controller's full observed AUX catalog for the editor. Default to group masters when local groups exist; a valid explicit saved navigation for that AUX can choose All Channels or an expanded group. Expanded groups contain one normal-size unavailable group master plus members in exact saved ID order, with unresolved placeholders and no AUX master. Empty groups are valid. No group level or aggregate meter is invented before F05.

Persist only the existing version-1 profile.navigation fields after explicit navigation actions. Restore once after an explicit Connect and actual received Ui24/known-AUX mode; never restore mixer data, connect from settings, or rewrite unavailable/unsupported saved preferences during fallback. Capture stable rig/context/intent when queuing repository updaters, change navigation only, and ignore late completions after context changes. Repository definition updates refresh groups without retargeting or resetting an active local view. All received-state and 10 Hz meter paths remain free of settings writes.

Keyed shortcut buttons, strips, bank and meter nodes survive received updates; meter-only notifications update existing measured-source fills only. Keep accepted compact fader geometry and three-column phone portrait banks. Shortcuts wrap, with bounded scrolling in compact landscape when unusually many groups exceed one row; no redundant Groups button. Edit Groups opens the current expanded stable group ID, and all S01 draft invalidation/profile-binding rules remain in force. No real device access, new transport/allowlist or mixer writer is part of this story; physical checks stay parked in F08-S01.
