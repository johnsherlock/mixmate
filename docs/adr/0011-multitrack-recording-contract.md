# ADR-0011: Multitrack recording toggle contract

Date: 2026-11-21
Status: Accepted for F07-S03 (typed guards, private session API and header UI). Detail and evidence: [recording contract](../iem-recording-contract.md). Numbering: ADR-0010 is reserved by F01-S05.

## Context

[ADR-0002](0002-deferred-qualification-and-authorized-controls.md) authorizes recording as a feature class and keeps the transport allowlist unchanged until exact forms are verified and narrow typed guards are added by the implementing story. Root verified the form against the desk-served native source and the desk (firmware 3.0.7865-ui24) on 2026-11-21. The native "MTK record" button sends the single toggle `MTK_REC_TOGGLE`, never when the player lock is active and never while `var.mtk.rec.busy >= 0.5`. With no USB drive the desk refused a toggle in 47 ms with `MSG^$REC_ERRNOSTICK` and a `DLGSHOW^usb_rec` dialog, leaving `rec.currentState` at 0. The recording-state values while recording are unverified (needs a drive).

## Decisions (root, routine; also in the [follow-up log](../user-follow-up.md))

1. **New allowlist row, one exact form,** `3:::MTK_REC_TOGGLE`, on the `createAuxControlSession` writer socket only. Never on the read-only or level-only factories or the companion. Excluded: `RECTOGGLE` (2-track), MTK playback, `MTK_REC` / `MTK_REC_STOP` / `MTK_REC_PAUSE` / `MTK_REC_JUMP_TO` / `MTK_REC_SET_SESSION`, session delete/rename/list.
2. **Never sent blind.** A toggle has no direction, so the typed API is `startRecording()` and `stopRecording()`: start only when the received `var.mtk.rec.currentState` is exactly 0, stop only when it is received and non-zero.
3. **Prerequisites** revalidated at send: qualified writer and companion open; start also needs `var.mtk.present` received and truthy; `var.mtk.rec.busy` received and < 0.5; lock (`settings.block.pass` non-empty requires `settings.block.player` exactly 1; unknown refuses; the password is never exposed); one recording operation at a time; no retry, queue or replay. Stop does not require the drive (native does not check it; a pulled drive must not trap the user).
4. **Receive.** The companion parses the bounded `var.mtk.*` keys (missing is unknown). A narrow writer-receive parser maps `MSG^$REC_ERR*` and `DLGSHOW^usb_rec^$REC_ERR*` (requester-only) to a refusal outcome with a bounded code and mapped text; raw desk strings are never displayed. None of this populates mixer, provider or meter state ([ADR-0008](0008-control-state-model.md) is unchanged).
5. **Outcomes, no ACK claims:** start `confirmed` (companion state ≠ 0 within 5 s), `refused` (REC_ERR reply), else `unconfirmed`; stop `confirmed` (state 0 within 5 s) else `unconfirmed`; `unknown` on disconnect/failure.
6. **Elapsed time** is the desk's received `var.mtk.rec.time`, shown only while the received state says recording; never a local timer ("REC" when unknown). No synthetic recording status in live mode.

## Consequences

- The static transport audit in `tests/build-offline.test.js` still expects two `message` send sites in `session-core.js` (the SETD dispatch ordinal and the one typed sender shared by snapshot and recording, now named `sendTypedMessage`), and additionally asserts that the toggle wire text exists only in `src/iem/recording-protocol.js` and that no other native recorder/playback command is spelled anywhere in `src`.
- Risks: the recording-state value(s) while recording, `rec.busy` transitions and the stop reply are unverified without a drive; any non-zero state counts as recording and the 5 s outcome windows are conservative guesses; a stop sent while the desk is paused or in another transitional state is untested; the toggle's effect when another client acts concurrently is unknown. Live acceptance needs a USB drive in the desk.
