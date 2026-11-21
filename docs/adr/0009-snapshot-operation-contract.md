# ADR-0009: Snapshot list, recall and save-current operation contract

Date: 2026-11-21
Status: Accepted for F07-S01 (typed guards and private session API; UI in F07-S02). Detail and evidence: [snapshot contract](../iem-snapshot-contract.md).

## Context

[ADR-0002](0002-deferred-qualification-and-authorized-controls.md) authorizes snapshot listing, recall and save as a feature class and explicitly keeps the transport allowlist unchanged until exact forms are verified and narrow typed guards are added by the implementing story. Root verified the forms against the served native source and the desk (firmware 3.0.7865-ui24) on 2026-11-21. Key facts: list replies and `MSG^$SNAPLOAD` reach only the requesting socket; `UPDATE_SHOWS` and a changed `var.currentSnapshot` are broadcast; a re-recall of the current snapshot sends no `currentSnapshot`; save has no explicit acknowledgement; native enforces desk locks only when `settings.block.pass` is set.

## Decisions (root, routine; also in the [follow-up log](../user-follow-up.md))

1. **New allowlist row, three exact forms**, on the `createAuxControlSession` writer socket only: `3:::SNAPSHOTLIST^<show>`, `3:::LOADSNAPSHOT^<show>^<snapshot>`, `3:::SAVESNAPSHOT^<show>^<snapshot>` (save updates the current snapshot). Never on the read-only factory, the level-only factory or the receive-only companion. Everything else (`SHOWLIST`, `CUELIST`, `LOADSHOW`, `CREATESHOW`, `DELETE*`, `RENAME*`, save-as, presets, cues, `MIXER_RESET`) is excluded.
2. **Typed API with names only.** `requestSnapshotList()`, `recallSnapshot(name)`, `saveCurrentSnapshot()`. `<show>` is always the received `var.currentShow`. Recall names must be an exact member of the latest fresh received list; save targets only the received `var.currentSnapshot` if listed. Names: non-blank, ≤ 64 characters and 256 bytes, no `^`, no control characters; sent verbatim. `* Init *` is never recallable or savable.
3. **Prerequisites** revalidated at send: qualified writer and companion open, a received show, a fresh list, no gesture and no pending/dispatching own send (refuse, never cancel the user's drag), at most one snapshot operation outstanding, and desk locks (`pass` non-empty ⇒ `loadshows`/`shows` must be truthy). **Unknown lock state refuses.** The password value is reduced to "is set" when parsed and never stored, exposed or logged.
4. **Narrow writer-receive parser** for exactly `SNAPSHOTLIST^<show>^…` and `MSG^$SNAPLOAD^<name>`, bounded (256 names, name and line limits). It feeds only the snapshot list and operation outcome. The writer socket still never populates actual mixer, provider or meter state ([ADR-0008](0008-control-state-model.md)); only companion observations do.
5. **Bounded outcomes, no ACK claims:** recall `confirmed` (MSG on the writer or `var.currentSnapshot` equal to the name, within 5 s) or `unconfirmed`; save `reported` (companion `UPDATE_SHOWS` within 3 s, proving only a show-change report) or `unconfirmed`; `unknown` on disconnect/hide/failure. No retry, queue, replay or rollback.
6. **Rig following** ([F02-S05](../stories/F02-S05.md)) is unchanged: the rig switches when `var.currentSnapshot` changes.

## Consequences

- The static transport audit in `tests/build-offline.test.js` now expects two `message` send sites in `session-core.js`: the SETD dispatch ordinal and the snapshot sender.
- Companion-only facts (`var.currentShow`, `settings.block.*`, `UPDATE_SHOWS`) are parsed by a separate parser, not added to the observed map, so the lock password can never appear in public observations.
- Risks: the `settings.block.*` INIT line form was unrecorded — **closed 2026-11-21**: root read the raw INIT lines (`SETS^settings.block.pass^<string>`, empty on this desk, and `SETD^settings.block.<x>^0|1`), matching the parser, which still treats an unparsed lock as unknown and a refusal; a save's `reported` outcome is weak by design; a recall mid-session streams many value changes that the existing native-receipt paths handle but that were observed only against the fake transport in this story.
- F07-S02 builds the header Recall/Save dialogs and completion feedback on this API (no change to the guards); F07-S03/S04 need their own contracts.
