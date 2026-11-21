# Multitrack recording status and control contract — F07-S03

Status: implemented as typed guards, a private session API and the live header Record button in F07-S03 (0.7.0). Decision record: [ADR-0011](adr/0011-multitrack-recording-contract.md) (ADR-0010 is reserved by F01-S05). Feature-class authorization: [ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md); the user authorized the rest of F07 on 2026-11-21. Code: `src/iem/recording-protocol.js` (pure serializer and bounded parsers), the private owner in `src/iem/session-core.js`, and `src/iem/recording-controls.js` (UI). Pattern: [snapshot contract](iem-snapshot-contract.md).

## Evidence

Three tiers, kept separate. Only the first two are protocol basis. Gathered by root on 2026-11-21 against the desk Ui24R (firmware 3.0.7865-ui24) from the desk-served native `mixer.html` and read-only Node WebSocket reads.

### Source-backed (native `mixer.html`)

- `E_COMMANDS`: `TOGGLE_MTK_REC "MTK_REC_TOGGLE"`; `TOGGLE_REC "RECTOGGLE"` (the 2-track USB recorder); `MTK_REC "MTK_REC"`, `MTK_REC_STOP "MTK_REC_STOP"`, `MTK_REC_PAUSE`, `MTK_REC_JUMP_TO`, `MTK_REC_SET_SESSION`; playback `MTK_PLAY`, `MTK_STOP`, `MTK_PAUSE`, `MTK_JUMP_TO`, `MTK_SELECT`; session management `MTK_DELETE`, `MTK_RENAME`, `MTK_GET_SESSIONS`, `MTK_GET_FILES`.
- The native "MTK record" button runs `toggleMTKRec()`: if `isBlocked("player")` it shows "LOCKED"; else if `var.mtk.rec.busy >= 0.5` it does nothing; else it sends `MTK_REC_TOGGLE`. (The 2-track `toggleRec()` is the same shape with `var.recBusy` and `RECTOGGLE`.) Native does **not** check `var.mtk.present` here.
- Native time display: when `var.mtk.rec.currentState` is truthy it shows `var.mtk.rec.time` (seconds) as the recording length; otherwise playback position/length.
- Native re-reads sessions when `var.mtk.present` changes (drive inserted or removed).
- Lock: `isBlocked("player")` is active only when `settings.block.pass` is non-empty and `settings.block.player` is falsy (the same model as [ADR-0009](adr/0009-snapshot-operation-contract.md)).

### Observed on the desk (root, read-only INIT, no drive in the desk)

- `var.mtk.present=0`, `var.mtk.freespace=-1`, `var.mtk.rec.currentState=0`, `var.mtk.rec.busy=0`, `var.mtk.rec.session=""`, `var.mtk.rec.time` counting up (21, …) while **not** recording, `var.mtk.dropouts=0`, `var.mtk.bufferfill=-1`, `var.mtk.session=0011`, `settings.mtk.format=2`, `var.isRecording=0`, `var.recBusy=1`, `var.usbfill=0`. All `SETD` numeric except session names (`SETS`). `settings.block.player=1`, `settings.block.pass` empty.
- One `3:::MTK_REC_TOGGLE` with no drive present: within 47 ms the requester received `MSG^$REC_ERRNOSTICK`, `SETD^var.mtk.rec.time^0` and `DLGSHOW^usb_rec^$REC_ERRNOACCESS^$MSGBTN_OK`. `var.mtk.rec.currentState` stayed 0 and `rec.busy` stayed 0; `rec.time` then kept counting up from 0. So the desk refuses without a stick, shows its own dialog, and `rec.time` is not an elapsed-recording value unless `rec.currentState` says recording.

### Not tested / hypotheses (needs a USB drive in the desk; do not rely on these)

- Actual start and stop, the `rec.currentState` value(s) while recording (1? 2?), `rec.busy` transitions, `rec.session` naming, dropouts and free space while recording (and the unit of `freespace`), stop by toggle versus `MTK_REC_STOP`, behaviour when the drive fills or is removed mid-recording, delivery of `DLGSHOW` to other clients, and what a toggle does while the desk is paused.
- MixMate therefore treats **any non-zero** `rec.currentState` as "recording" and exactly 0 as stopped, and keeps start and stop outcomes bounded and conservative. Live start/stop acceptance needs a drive; root records what could be tested in the [story](stories/F07-S03.md).

## Allowed outbound form

| Purpose | Exact wire form | Socket |
| --- | --- | --- |
| Toggle multitrack recording | `3:::MTK_REC_TOGGLE` | control session writer only |

Only the literal `createAuxControlSession` owns it. `createReadOnlySession` (three connection forms), `createAuxLevelSession` and every receive-only companion socket never send it (tested; the static send-site audit also checks that the wire text exists only in `recording-protocol.js`). There is no public sender: callers use `startRecording()` and `stopRecording()` and never pass a command string, path or array.

**Excluded, never sent:** `RECTOGGLE` (2-track), all MTK playback (`MTK_PLAY`, `MTK_STOP`, `MTK_PAUSE`, `MTK_JUMP_TO`, `MTK_SELECT`), `MTK_REC`, `MTK_REC_STOP`, `MTK_REC_PAUSE`, `MTK_REC_JUMP_TO`, `MTK_REC_SET_SESSION`, and session delete, rename and listing (`MTK_DELETE`, `MTK_RENAME`, `MTK_GET_SESSIONS`, `MTK_GET_FILES`).

## Public API (private owner, `createAuxControlSession` only)

- `startRecording()` and `stopRecording()`, each returning a frozen `{ ok: true, kind }` or `{ ok: false, code, reason }`. Refusal codes: `not-ready`, `busy` (a recording operation is outstanding), `unknown-state`, `already-recording`, `not-recording`, `drive-unknown`, `no-drive`, `locked`, `lock-unknown`, `recorder-busy`, `recorder-busy-unknown`, `send-failed`.
- `snapshot().recording`: `{ present, freespace, dropouts, state, recording, elapsed, session, busy, lock, operation }`, copies only. `recording` is `null` (unknown), `true` (state non-zero) or `false`. `elapsed` is whole seconds of the desk's own received `var.mtk.rec.time` **only while `recording` is true**, else `null`. `freespace` is the desk's raw number (units unverified). `lock` is `allowed | locked | unknown`. `operation` is `{ kind: start|stop, status, text, code? } | null` with status `pending | confirmed | refused | unconfirmed | unknown`. The lock password is never stored, exposed, logged or persisted.

## Never sent blind

The command is a toggle, so intent is derived from received state at send time:

- **start** is sent only when the received `var.mtk.rec.currentState` is exactly 0;
- **stop** is sent only when it is received and non-zero;
- unknown state refuses both.

## Prerequisites (revalidated immediately before every send)

Refused with a reason; never queued, retried or replayed:

1. Qualified control session, writer and companion both current and open, page visible.
2. At most one recording operation outstanding.
3. Received `var.mtk.rec.currentState`.
4. Start only: received `var.mtk.present` and truthy (≥ 0.5). Stop does not require the drive: native does not check it, and a drive pulled mid-take must not trap the user in "recording".
5. Lock: `settings.block.pass` empty means no lock; non-empty requires `settings.block.player` to be exactly 1. **Missing information is unknown and refuses** (`lock-unknown`). The password is reduced to "is set" at parse time (by the ADR-0009 parser); only the player flag is read by the recording parser.
6. `var.mtk.rec.busy` received and below 0.5 (start and stop, as native).

A recording operation does not wait for or cancel a level gesture: the toggle touches no mixer parameter path. (Snapshot operations do refuse during a gesture; recording does not need to.)

## Receive paths

- Companion socket (the only source of recording state): `SETD^var.mtk.present|freespace|dropouts|rec.currentState|rec.time|rec.busy^<number>`, `SETS^var.mtk.rec.session^<name>` (≤ 64 chars, no control characters) and `settings.block.player`. Numbers are strict finite decimals; anything else is dropped (unknown), never defaulted. They never populate mixer, provider or meter state.
- Writer socket only, requester-only replies to a refused toggle: `MSG^$REC_ERR<X>` and `DLGSHOW^usb_rec^$REC_ERR<X>^…`. Only a bounded `REC_ERR[A-Z0-9_]{1,32}` code is retained, and only while an operation is outstanding. Raw desk text is never shown: `REC_ERRNOSTICK` shows "No USB drive in the desk", `REC_ERRNOACCESS` shows "Recording not available", any other code shows "Desk refused recording (<code>)".
- `rec.time` counts up while stopped; a time-only change while stopped neither emits nor displays.
- External changes (another client starts or stops recording) simply update the received state and are logged ("The desk started/stopped recording."); no operation is invented.

## Outcomes (bounded, never an ACK)

| Operation | Status | Rule |
| --- | --- | --- |
| Start | `confirmed` | within 5 s the companion receives `rec.currentState` ≠ 0 |
| Start | `refused` | the writer receives a `REC_ERR*` reply while pending (mapped text above) |
| Start | `unconfirmed` | neither within 5 s; a later report does not revise it (the received state is still shown) |
| Stop | `confirmed` | within 5 s the companion receives `rec.currentState` = 0 |
| Stop | `unconfirmed` | not within 5 s (the received state stays authoritative; intent never replaces it) |
| Either | `unknown` | disconnect, socket failure or a throwing send while outstanding; all received state is cleared, no replay |

A `REC_ERR*` reply while a stop is pending also settles it as `refused`.

## UI (`src/iem/recording-controls.js`)

The live header's **Record** button (`data-action="record"`, `.mm-record`):

- Available and stopped: "Record" (with " MTK" on wide layouts); one tap starts recording (non-destructive, no confirmation).
- Recording (received state): `.mm-recording` look and the elapsed time `hh:mm:ss` from received `var.mtk.rec.time`; "REC" if the time is unknown. Never a local timer. Tapping opens the dialog **Stop multitrack recording?** ("Current take · hh:mm:ss", live-updating) with **Keep recording** and **Stop recording**; the dialog closes once the stop is sent. It also closes if the connection drops or the desk stops (nothing left to stop). Dialog owner kind `recording`, so automatic connection and automatic updates treat it as another dialog.
- Pending: disabled, "Starting…" / "Stopping…".
- Unavailable: disabled with a `title` reason ("Connect to the desk first", "No USB drive in the desk", "Locked on the desk", "Recorder busy", and the unknown-state reasons).
- Outcomes go to the footer message slot ("Recording started.", "Recording stopped.", the refusal text, or the unconfirmed/unknown text) and the Diagnostics log. The hidden status sink `.mm-rec-state` carries a one-line summary for the Diagnostics "Desk and state" row.
- Diagnostics has a **Recording** section: drive, free space (raw; units unverified), dropouts, state, elapsed, session, busy, recording lock and last recording operation.
- No synthetic recording status in live mode (the Demo is unchanged and isolated). All desk strings use `textContent`.
- `updateBusy` (automatic updates) treats a pending recording operation, an active recording while connected, and this UI's tracked operation as busy.

## Out of scope

2-track recording, playback, session selection/rename/delete, pause, markers, remaining-time estimation, drive format (`settings.mtk.format`) and native UI access (F07-S04).
