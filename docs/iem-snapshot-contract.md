# Snapshot list / recall / save-current contract — F07-S01

Status: implemented as typed guards and a private session API in F07-S01 (no UI; F07-S02 adds the menu and confirmation dialogs). Decision record: [ADR-0009](adr/0009-snapshot-operation-contract.md). Feature-class authorization: [ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md). Code: `src/iem/snapshot-protocol.js` (pure serializers, validators, bounded parsers) and the private owner in `src/iem/session-core.js`.

## Evidence

Three tiers, kept separate. Only the first two are protocol basis.

### Source-backed (native `mixer.html` served by the desk, firmware 3.0.7865-ui24, read by root 2026-11-21)

- `E_COMMANDS` names: `SHOW_LIST "SHOWLIST"`, `SNAP_LIST "SNAPSHOTLIST"`, `SNAP_SAVE "SAVESNAPSHOT"`, `SNAP_LOAD "LOADSNAPSHOT"`, `SNAP_DEL "DELETESNAPSHOT"`, `SNAP_RENAME "RENAMESNAPSHOT"`, `CUE_LIST "CUELIST"`, `SHOW_LOAD "LOADSHOW"`, plus the incoming broadcast `UPDATE_SHOWS`.
- List: `SNAPSHOTLIST^<show>`, sent by native on INIT and when its menu opens. Reply `SNAPSHOTLIST^<show>^<name>^<name>…`; native drops empty names and applies the list only when the reply's show matches.
- Recall: `LOADSNAPSHOT^<show>^<snapshot>` (native sends `LOADSHOW^<show>` first only when the selected show differs from `var.currentShow`; MixMate never does).
- Save (update current): `SAVESNAPSHOT^<show>^<snapshot>` after a native confirmation box ("UPDATE CURRENT SNAPSHOT" / "REPLACE SNAPSHOT"). Native save-as replaces `^` with `_` in new names; MixMate has no save-as.
- Incoming `MSG^$<KEY>^args` is a native popup message (language key), for example `MSG^$SNAPLOAD^MixMate2`. `UPDATE_SHOWS` makes native refresh its lists.
- Locks: native `isBlocked(x)` is active only when `settings.block.pass` is non-empty and the client is not master; the action is then permitted only if `settings.block.<x>` is truthy. Recall checks `loadshows`, save checks `shows`.

### Observed on the desk (root 2026-11-21, a Node WebSocket script limited to show `Default` and snapshots MixMate1/MixMate2; native mixer.html with a read-only hook)

- `3:::SNAPSHOTLIST^Default` answered in 3 ms: `SNAPSHOTLIST^Default^* Init *^AIC^IMGL FIBBERS^IMGL Harbour Bar^IMGL Studio^John Test^MixMate1^MixMate2^NSLYA^RECORDING`. The list is not in INIT. `SHOWLIST` → `SHOWLIST^Default`; `CUELIST^Default^MixMate1` → `CUELIST^Default^`.
- `3:::SAVESNAPSHOT^Default^MixMate1` → `UPDATE_SHOWS` at 184 ms; no SET lines, no explicit ack or error; the full 6649-key INIT dump was unchanged.
- `3:::LOADSNAPSHOT^Default^MixMate2` → `MSG^$SNAPLOAD^MixMate2` at 377 ms, `UPDATE_SHOWS` and `SETS^var.currentSnapshot^MixMate2` at 409 ms, then 109 changed SET lines (changes only). Recall back to MixMate1 likewise. Full dumps before and after the sequence were identical.
- Delivery per socket (writer sends; a second observer socket only INIT/heartbeat): the list reply and `MSG^$SNAPLOAD` reach the **requester only**; `var.currentSnapshot` (when it changes) and `UPDATE_SHOWS` are **broadcast**. Re-recalling the already-current snapshot gives the writer `MSG^$SNAPLOAD^<name>` and both sockets `UPDATE_SHOWS`, but **no `var.currentSnapshot` re-send**. Save gives `UPDATE_SHOWS` on both sockets only.
- This desk: `settings.block.pass` empty (no locks), `loadshows=1`, `shows=0`. A running MixMate live tab followed a recall (rig switch, F02-S05).
- INIT contains `SETS^var.currentSnapshot^…`, `SETS^var.currentShow^Default`, an empty `var.currentCue`, and the settings `settings.block.loadshows`, `settings.block.shows`, `settings.block.presets`.

### Closed risk: `settings.block.*` INIT line form (root, 2026-11-21)

Root read the raw INIT lines: `SETS^settings.block.pass^<string>` (empty on this desk) and `SETD^settings.block.<x>^0|1`. This matches the parser (`SETS`/`SETD`, flags exactly `1` or `0`; the password only matters as empty or non-empty). The fail-safe stays: an unparsed lock is unknown and refuses.

### Not tested / hypotheses (do not rely on these)

- `LOADSHOW`, `DELETESNAPSHOT`, `RENAMESNAPSHOT`, save-as, recall of any other snapshot, recall of a nonexistent name, and behaviour with a lock password set were not exercised.
- What the desk does when a save or recall arrives while another client is mid-operation is unknown.

## Allowed outbound forms

| Purpose | Exact wire form | Socket |
| --- | --- | --- |
| List | `3:::SNAPSHOTLIST^<show>` | control session writer only |
| Recall | `3:::LOADSNAPSHOT^<show>^<snapshot>` | control session writer only |
| Save current | `3:::SAVESNAPSHOT^<show>^<snapshot>` | control session writer only |

Only the literal `createAuxControlSession` owns them. `createReadOnlySession` (three connection forms), `createAuxLevelSession` and every receive-only companion socket never send them (tested). There is no public sender: callers pass a snapshot **name**, never a command string, path or array, and `<show>` is never caller-supplied.

**Excluded, never sent:** `SHOWLIST`, `CUELIST`, `LOADSHOW`, `CREATESHOW`, `DELETESNAPSHOT`, `RENAMESNAPSHOT`, any `DELETE*` / `RENAME*`, save-as a new name, presets, cues, `MIXER_RESET`, `resetGraphEQ` and every other command. The desk's `* Init *` entry (factory reset) is never recallable or savable through MixMate.

## Public API (private owner, `createAuxControlSession` only)

- `requestSnapshotList()`, `recallSnapshot(name)`, `saveCurrentSnapshot()`, each returning a frozen `{ ok: true, kind[, name] }` or `{ ok: false, code, reason }`. Refusal codes: `not-ready`, `no-show`, `gesture`, `pending`, `busy`, `no-list`, `stale-list`, `invalid-name`, `init-entry`, `not-in-list`, `no-current`, `locked`, `lock-unknown`, `send-failed`.
- `snapshot().snapshots`: `{ show, current, list: { status: none|pending|fresh|stale, show, truncated, names[] }, operation: { kind, name, status, text } | null, lock: { recall, save } }` where each lock entry is `allowed | locked | unknown`. Copies only: no authority. The list never contains the Init entry. The lock password value is **never** stored, exposed, logged or persisted; only its emptiness is retained.

## Validation and bounds

- Snapshot and show names: a string, not blank, at most **64 characters and 256 UTF-8 bytes** (observed names are ≤ 20 characters; the bound is generous yet keeps everything sent and retained bounded; a longer desk name is dropped from the list and can never be recalled), well-formed, no `^`, and no C0/DEL/C1 control or U+2028/U+2029 character (so no `\n` or `\r`). Sent exactly as received, case-sensitive; no trimming or normalisation.
- `* Init *` (compared trimmed and case-insensitively, stricter than the desk) is refused by the encoders and the session.
- Recall requires the exact, case-sensitive name to be in the latest **fresh** list received for the current show on this connection. Save requires the received `var.currentSnapshot` to be a valid, listed, non-Init name (it updates that snapshot only; there is no way to supply a new name).
- Writer parser (exactly `SNAPSHOTLIST^<show>^…` and `MSG^$SNAPLOAD^<name>`): frame ≤ 2 MiB and ≤ 32768 lines (as the state parser); a list line ≤ 70 000 bytes; empty, unsafe, overlong and duplicate names dropped; at most **256** names kept (`truncated` flagged). A reply for another show is ignored, and a list reply is accepted only while a request is outstanding. Anything else on the writer socket (including the late INIT dump) is ignored by this parser and never populates mixer, provider or meter state.
- Companion parser (`var.currentShow`, `settings.block.pass|loadshows|shows`, `UPDATE_SHOWS`): same frame/line bounds as the state parser.

## Prerequisites (revalidated immediately before every send)

Refused with a reason, never queued, retried or replayed:

1. Qualified control session, writer and companion both current and open, page visible.
2. Received non-empty, valid `var.currentShow`.
3. No owned gesture, no dispatching send (list), and for recall/save also no pending own control send (the observation wait of a previous level/pan/GEQ send must finish first). A snapshot request never cancels the user's drag.
4. Recall/save: a fresh list for that show on this connection (not stale after `UPDATE_SHOWS` or a show change), and at most one snapshot operation outstanding. A list request is read-only; one may be outstanding at a time (5 s reply window).
5. Locks (recall/save). `settings.block.pass` empty → no lock. Non-empty → recall needs `loadshows` truthy, save needs `shows` truthy, else refused with "Locked on the desk." **Missing information is unknown and refuses** (`lock-unknown`): if the password state or the needed flag has not been received, a refusal costs nothing, while sending a command the desk would reject (or the desk's own policy forbids) is not recoverable by the user. This desk sends them in INIT, so a qualified connection normally has them.

## Receive paths

- Writer socket only: list replies and `MSG^$SNAPLOAD^<name>` (requester-only on the desk).
- Companion socket as today: `SETS^var.currentSnapshot`, `SETS^var.currentShow`, `settings.block.*`, `UPDATE_SHOWS` (broadcast).
- `UPDATE_SHOWS` marks the list **stale** (a reply already in flight is stored stale); a new list request is needed before the next recall/save. A show change clears the list.
- A recall changes `var.currentSnapshot` and streams changed values through the existing companion paths: F02-S05 rig following, topology/native receipt cancellation and the control state model act unchanged. No rollback is added.

## Outcomes (bounded, never an ACK)

| Operation | Status | Rule |
| --- | --- | --- |
| Recall | `confirmed` | within 5 s the writer receives `MSG^$SNAPLOAD^<exact requested name>` **or** the companion receives `var.currentSnapshot` equal to it (re-recalling the current snapshot sends no `currentSnapshot`, only the MSG) |
| Recall | `unconfirmed` | sent, but the desk did not report it within 5 s; a later report does not revise it |
| Save | `reported` | within 3 s the companion receives `UPDATE_SHOWS`. This proves only that the desk reported a show change, **not** that the snapshot contents were written (any client's show change would look the same); the wording says so |
| Save | `unconfirmed` | no `UPDATE_SHOWS` within 3 s |
| Either | `unknown` | disconnect, hide, timeout, socket failure or a throwing send while outstanding; all received state is cleared, there is no replay, and a new explicit connection starts clean |

## Interruption and cancellation

- No cancel after send (the desk cannot be told to stop); no retry, queue or replay on any outcome.
- Disconnect/hide/failure clear the list, show, lock flags and current snapshot with the rest of the received state; only an outstanding operation survives as `unknown` until the next explicit connect.
- Native recalls or saves by other clients are seen only through the broadcast paths; they stale the list and, for `var.currentSnapshot`, switch the rig.

## Out of scope

Show switching, save-as, rename, delete, cues, presets, recording (F07-S03) and native UI access (F07-S04). The F07-S02 UI is described below. Live desk acceptance by root may recall and save only MixMate1 and MixMate2.

## UI (F07-S02)

The live header's **Snapshot** button (shows the received current name) opens the *Recall snapshot* dialog and **Save snapshot** opens *Save current snapshot* (`src/iem/snapshot-controls.js`; dialog owner kind `snapshots`, so the automatic-connection rules for "another dialog" apply). The UI only calls `requestSnapshotList()`, `recallSnapshot(name)` and `saveCurrentSnapshot()`; it builds no wire text and adds no outbound message. Both dialogs request a fresh list on open.

- Header buttons are disabled with a `title` reason when not connected/qualified, with no received show or current name, when the matching lock is `locked` or `unknown`, or while an operation this UI started is pending. The lock password never reaches the UI (the session reduces it to a boolean).
- Recall: "Loading snapshots…", then the desk's names (Init already filtered) in a select with the current one marked `(current)` and preselected; a truncated list adds a one-line note; warning "Recall changes desk settings for everyone."; Cancel and **Recall snapshot** (recalling the current snapshot is allowed; it discards unsaved desk changes). While pending the dialog stays open ("Recalling <name>…"), its buttons, × and Escape are disabled, so no strip gesture can start behind it (closes the F07-S01 session-level gap for the UI). `confirmed` closes it and the footer slot shows "Recalled <name>."; `unconfirmed`/`unknown` keep the session text in the dialog and the slot; a refusal shows its `reason`. Never retried.
- Save: names the received current snapshot ("Overwrite “<name>” with the current desk settings?", text only); no name entry, no save-as. `reported` closes it and the slot shows "Save sent for <name>; the desk reported a show change (contents not verified)." (a report only; any `UPDATE_SHOWS` within 3 s counts, contents are not verified); `unconfirmed`/`unknown`/refusal as above. A current snapshot missing from the list cannot be saved.
- Outcomes are tracked outside the dialog: if the dialog is replaced or the F02-S05 rig switch runs while an operation is pending, the outcome still reaches the footer slot and the Diagnostics log.
- Diagnostics has a *Snapshots* group (show, current, list status and count, last operation, lock) and every operation and outcome is logged. There is deliberately no dirty indicator: the desk's "snapshot modified" state is not verified.
