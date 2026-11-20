# Orchestrator handoff — F06-S04 batch complete, 2026-11-18

Read [AGENTS](../AGENTS.md), [lifecycle](orchestration.md), [backlog](backlog.md), the assigned story/feature and current contracts before new work. **The explicitly authorized F06-S04-only batch is complete and merged. Stop this batch.** The batch began by finishing a user-reported group-editor fix left half-done by an earlier usage stop (F04-S05). No further implementation is authorized by backlog priority; **F07 is not started.** This reviewed closing delivery is identified by its containing PR/history, avoiding a self-referential commit hash. The last verified story baseline on main is **`5c6a3ca995c6b56c527823689d9bce3374610dcb`**.

## Review gate substitution (user direction)

Codex reviews were unavailable throughout this batch: its usage limit was reached, and PR #48's review attempt failed. The user explicitly directed root to replace `@codex review` with **independent fresh-context agent reviews**. Each story was merged only after such a reviewer affirmatively approved the exact final head, CI passed on that head, and every blocking finding was resolved. Review rounds are recorded on each PR and in [follow-ups](user-follow-up.md). A future orchestrator should go back to `@codex review` once it is available again, unless the user directs otherwise.

## Confirmed deliveries

| Story / PR | Merge commit / UTC time | Final approved head | Passing CI |
| --- | --- | --- | --- |
| [F04-S05 / #48](https://github.com/johnsherlock/mixmate/pull/48) | `0a387d64050466b9c138c8b9b584a867a8e85bb9` / 2026-11-18 17:51:22 | `771bd1d` ([record](https://github.com/johnsherlock/mixmate/pull/48)) | [44363115256](https://github.com/johnsherlock/mixmate/actions/runs/44363115256) |
| [F06-S04 / #49](https://github.com/johnsherlock/mixmate/pull/49) | `5c6a3ca995c6b56c527823689d9bce3374610dcb` / 2026-11-18 23:09:50 | `2aae758` ([record](https://github.com/johnsherlock/mixmate/pull/49)) | [44418133828](https://github.com/johnsherlock/mixmate/actions/runs/44418133828) |

Implementation was delegated to one sequential fresh-context story agent per story; root owned review orchestration, browser and hardware acceptance, and merges. The batch was interrupted once by an account usage limit. On the user's "are we back?" root resumed the preserved branch, which was unchanged; this does not imply an account reset.

## Delivered behavior

- **[F04-S05](stories/F04-S05.md): group editor usability.**
  - In All Mixes, the editor offers the union of received sources across AUXes.
  - Delete group uses an in-dialog confirmation and gives saved, temporary or conflict feedback.
  - Edit Groups works without a saved rig. Settings schema v2 adds a device-local `localDefinitions` set; v1 migrates purely on read, backups are accepted in v1 or v2, and exports are v2.
  - A bound saved rig keeps its own groups unchanged.
  - Reviews fixed focus loss and the case where deleting the expanded group closed the editor without its outcome. Two P3s were accepted, the per-frame catalog cost and the first local save cancelling control intent; both are recorded in follow-ups.
  - **Rollback note:** once a v2 document is committed, older builds read it as unsupported. They keep running on temporary settings and never overwrite it. A revert would need a v2 → v1 reader.
- **[F06-S04](stories/F06-S04.md): approved AUX GEQ controls.**
  - Writes go through the ADR-0008 peer owner (private typed writer plus receive-only companion), in the form `3:::SETD^a.<0..9>.eq.peak.<0..30>^<finite 0..1>`, and only through `createAuxControlSession`.
  - Dispatch is **sparse**: up to 31/62 changed band paths, skipping bands within 1e-9 of the gesture-start coordinate. It is sequential and non-atomic, with revalidation and reentrant stop. There is no retry, rollback or replay.
  - **Points** (since F09-S07, user decision 2026-11-20) are persistent Demo-style drawing aids over an in-memory anchored base, re-anchored at 0 dB on open, draw/reset or any outside change; untouched bands keep their exact values, and since F09-S06 (2026-11-19) a band the bump would push past ±15 dB saturates at exactly ±15 dB (never rejected whole); draw curves and the session still reject an out-of-range request whole without clipping. **Draw** mode is exclusive of points. **Reset** needs an in-panel confirmation and sends only the selected GEQ bands that are not already at 0.5.
  - Linked sides must be exactly equal; otherwise the pair is read-only and both raw sides are shown. Native band, bypass or processing changes cancel any obsolete gesture.
  - A received-basis barrier prevents stale re-sends after an unechoed write.
  - There are no shelf, filter, bypass or preset writes, and no measured-response claim.

`mockups/iem.html` is unchanged; it remains the visual reference, not protocol evidence.

## Verification and resources

- **Final application:** 0.5.0, 18 precached assets, worker `c7399c195aa4b408`. Local Node is 26.13.1; CI uses Node 24. **390/390 fake tests** pass.
- **Browser acceptance:** root ran strict-fake browser acceptance in isolated headless Playwright Chromium 1252 at phone portrait 390×844 and landscape 844×390. Checked:
  - release-only writes;
  - relative points preserving a native −9 dB band exactly;
  - zero-Δ no-op and reset confirmation;
  - distinct L/R readback;
  - landscape fit;
  - no non-GEQ writes and no console errors.
- **Live hardware matrix** ([story](stories/F06-S04.md)): firmware 3.0.7865-ui24, desk 192.168.0.60, pair SPARE/IEM `a.8`/`a.9`. The desk has no mono outputs.
  - **First run, head `18b096f`:** the desk echoes only *changed* paths, rounded to 10 decimals, so the barrier stuck after every edit. This was fixed by sparse dispatch.
  - **Post-fix run, head `3ecb23c`:** passed:
    - sparse send and echo, plus an immediate second gesture;
    - native ↔ MixMate in both directions, with MixMate building on the native value;
    - a real interrupted dispatch, which went read-only with unequal sides, made no writes and recovered automatically after a native correction;
    - a confirmed sparse reset.

  All 155 MixMate writes were GEQ band paths.
- **Final desk state:** the SPARE/IEM GEQ is flat (0.5) on both sides. Pre-test bands 14 and 20 were about ±0.02 dB. Nothing else changed, and no snapshot was saved, recalled or deleted.
- **Resource cleanup:** MixMate was disconnected and its native pane tab closed; the owned 4174 preview was stopped and no listener remains; there are no owned Playwright processes. The user's personal browser was not used.

Preserve the unrelated untracked **`docs/iem-integration-handoff.md`**, SHA256 **`0ac783556d5660ec29e95652c1871628f70c84f45ebb9c4a479e409399dd5bac`**, and never stage it. The prototype SHA256 remains **`d004af78c3ae59491dca09f4202d1697e95d1411c07334e6e292da0ec3a266a9`**.

## Remaining work and next orchestration

- **Physical qualification:** [F08-S01](stories/F08-S01.md) still owns physical Android/iOS testing, both rigs, installation/offline, sleep/recovery, touch and storage retention. GEQ adds these items:
  - mono outputs;
  - SVG handle `touch-action` on phones;
  - exponent-form values near −15 dB;
  - which processing fields stream during a show;
  - display centres versus actual DSP response.
- **Parked:** the unknown tablet group-save issue (no device evidence yet) and the dependency audit (four development-chain high entries from one picomatch advisory; production audit reports zero).
- **Non-blocking GEQ P3s (follow-ups):**
  - rounded echoes after the first report `native-invalidated` rather than precision;
  - a planned value equal to the desk value would get no receipt, which fails safe and needs a reconnect.
- **User-raised future direction:** associate MixMate groups and layout with the desk's current snapshot via a verified stable snapshot identity. It is recorded only and depends on F07.
- **Next backlog candidate:** [F07](features/F07.md) (snapshot contract, operations, recording, native access). It is **unstarted and outside this authorization**.

A fresh orchestration run should verify this closing delivery on remote main, read AGENTS and this handoff, and obtain the next explicit batch. Stop here; no sidebar chat or automatic responsibility transfer is created.
