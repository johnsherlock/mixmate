# Orchestrator handoff — F07 batch: F07-S01 in review, 2026-11-21

Before new work, read:
- [AGENTS](../AGENTS.md) (updated by F02-S05: snapshot-named rigs and automatic connection);
- the [lifecycle](orchestration.md);
- the [backlog](backlog.md);
- the assigned story and its feature;
- the current contracts.

**The batch resumed on the user's go-ahead (F07-S01 in review, F07-S02 next).** This handoff is identified by its containing PR and history, not by its own commit hash. The last verified story baseline on main is **`61d08fd`** (F09-S11, PR #59), after F02-S05 at `f6a1ecd` (PR #58). The text below about F02-S05 and the desk evidence is historical context for F07-S01.

## Authorized batch (user, 2026-11-20)

**F02-S05 → F07-S01 → F07-S02.** F07-S03 (recording) and F07-S04 (native UI access) are **not** authorized.

| Story | Status |
| --- | --- |
| [F02-S05](stories/F02-S05.md) snapshot-named rigs, known addresses, automatic connection | **Merged**: [PR #58](https://github.com/johnsherlock/mixmate/pull/58), merge `f6a1ecd` (2026-11-20 22:44 UTC), final approved head `7429ddc`, CI [44830969144](https://github.com/johnsherlock/mixmate/actions/runs/44830969144); main CI on `f6a1ecd` [44831343053](https://github.com/johnsherlock/mixmate/actions/runs/44831343053) passed |
| [F09-S11](stories/F09-S11.md) live UI tidy (user-requested interstitial story, outside the batch order) | **Merged**: [PR #59](https://github.com/johnsherlock/mixmate/pull/59), merge `61d08fd` (2026-11-21 09:32 UTC), final approved head `db393b4`, CI [44889844694](https://github.com/johnsherlock/mixmate/actions/runs/44889844694) |
| [F07-S01](stories/F07-S01.md) snapshot discovery and operation contract | **In review**: typed guards and private API merged only once reviewed; contract [iem-snapshot-contract.md](iem-snapshot-contract.md), [ADR-0009](adr/0009-snapshot-operation-contract.md); no UI |
| [F07-S02](stories/F07-S02.md) snapshot operations (list/recall/save UI) | **Next**, after F07-S01 merges |

The F02-S05 / F09-S11 merge receipts and the accepted P3s were folded into the F07-S01 PR (user decision 2026-11-21): story, feature and backlog statuses are updated and the P3s are in [follow-ups](user-follow-up.md).

## Review gate substitution (user direction, still in force)

Codex is out of usage. Use an **independent fresh-context agent review** instead of `@codex review`. Merge only when all of these hold:
- the reviewer approved the exact final head;
- CI passed on that head;
- every P1 and P2 is resolved;
- root completed live desk acceptance.

Record the review rounds and live results in a comment on the PR. Return to `@codex review` once it is available, unless the user directs otherwise.

## Standing user permissions and rules

- Root may change anything on the desk (Ui24R **192.168.0.60**, firmware **3.0.7865-ui24**) except saving, recalling or deleting snapshots, with one exception: for this batch the user created test snapshots **MixMate1** and **MixMate2** and allowed recalling and saving those two (never delete them; never save over or recall any other snapshot).
- Use SPARE (AUX 9/10) for write tests. If JOHN'S MIX is touched, capture its values first and restore them exactly. A recall changes the whole desk, so capture a full INIT dump before and compare after.
- One story agent, one `codex/` branch and one PR per story, sequentially, each in its own worktree. Reproduce on the desk anything the user reports before writing a brief.
- Never stage the untracked `docs/iem-integration-handoff.md` (SHA256 `0ac783556d5660ec29e95652c1871628f70c84f45ebb9c4a479e409399dd5bac`).
- F08-S01 (real phone and tablet testing) remains the release gate and must not be waived.

## F02-S05 delivered behavior (user decisions 2026-11-20)

These supersede older wording; AGENTS, the story and [settings](settings-repository.md) / [groups](iem-groups.md) docs carry the detail.
- **Rig identity = the desk's current snapshot name**, received as `SETS^var.currentSnapshot^<name>` (receive-only, bounded). Exact, case-sensitive match: load the rig or create an empty one. **Follow live:** a native recall while connected switches rigs (gestures/selection cancelled, socket kept). An empty or invalid name means no rig, with a one-line reason. Offline, Edit Groups uses the last-used rig.
- **Rig UI removed.** The live Connect dialog is the IPv4 address, Connect, Disconnect while connected, and Close.
- **Known addresses:** up to 8, most recent first, recorded only on full readiness (`qualified`: Ui24 state received and, for control sessions, the writer socket open).
- **Automatic connection** (live app only) on open, after an unexpected drop of a qualified session, on page visible/`pageshow`/`online`: one pass through known addresses, 5 s per attempt, never overlapping; falls back to the Connect dialog. A drop within 30 s of an automatic success opens the dialog instead. Explicit Disconnect suppresses it until the next explicit Connect or app open. Passes pause and triggers defer while any other dialog (Edit Groups, pan, EQ, channel detail) is open.
- **Settings v3:** rigs `{ id, name, groups, navigation }`, `knownAddresses`, no `localDefinitions`; 128-rig cap (evicts only an empty non-current rig; otherwise no rig with a reason). v1/v2 records discard rigs and groups, seed known addresses, keep preferences.
- No new outbound message; the transport allowlist is unchanged.

### Accepted P3s from the F02-S05 review (to record in follow-ups via F07-S01)
- **P3-a:** a stale pending-dialog flag can open the Connect dialog over a live session after a rare drop-guard → deferred trigger → success sequence. Harmless (nothing sent). Fix: clear it on success.
- **P3-b:** an attempt already in flight when Edit Groups opens can still close the editor if it succeeds and restores the rig's saved mix (a real context change; matches prior behaviour).
- Already recorded by the story: P3-3, more automatic settings writes make the documented two-window stale-baseline conflict more likely.

## Desk evidence for F07-S01 (root, 2026-11-20, read-only)

- INIT contains `SETS^var.currentSnapshot^…`, `SETS^var.currentShow^Default` and an empty `SETS^var.currentCue^`. Related settings seen: `settings.block.loadshows`, `settings.block.shows`, `settings.block.presets`, `settings.cascade.snapsync`, `settings.cue`.
- The snapshot list is **not** in INIT. The native app (`mixer.html`) shows a SHOWS / SNAPSHOTS / CUES menu from the header snapshot name; the show `Default` lists `* Init *`, AIC, IMGL FIBBERS, IMGL Harbour Bar, IMGL Studio, John Test, MixMate1, MixMate2, NSLYA, RECORDING and more. How it obtains that list (socket message or HTTP) is unknown and is F07-S01's research.
- In the native menu, a double-click on a snapshot loaded it; the desk then re-sent `var.currentSnapshot` and MixMate followed live.

## Verification and resources

- **Application:** 0.5.0, 18 precached assets, offline worker `9ce75844fa30b67d`, **439/439** fake tests. Local Node 26; CI Node 24.
- **Live acceptance of F02-S05** (headless Playwright Chromium against the production build, plus the desktop app's browser pane for native recalls) is recorded on [PR #58](https://github.com/johnsherlock/mixmate/pull/58#issuecomment-7052427422).
- **Desk state:** current snapshot **MixMate1** (the user had recalled it). Root recalled only MixMate2 and MixMate1; a full INIT comparison before and after was identical, so JOHN'S MIX and all values are unchanged. No snapshot was saved or deleted. SPARE values remain as left by the F09 batch.
- **Cleanup:** the F02-S05 worktree and branches are removed; the root preview server is stopped. QA scripts are in the session scratchpad only, not part of the repository.
- **Prototype:** `mockups/iem.html` unchanged, SHA256 `d004af78c3ae59491dca09f4202d1697e95d1411c07334e6e292da0ec3a266a9`.

## Remaining work outside the batch

- **Physical qualification:** [F08-S01](stories/F08-S01.md) owns Android/iOS, installation/offline, sleep/recovery and real touch. Added by F02-S05: real-device wake, visibility and `online` auto-connect behaviour, and the upgrade from v2 settings on the user's devices.
- **Earlier accepted P3s** (see [follow-ups](user-follow-up.md)): GEQ touch neighbour-handle grab; `.mm-feedback` not a live region; pan readout jump across the 2.5 s window; level cap showing the retained request after the window; the F09-S10 CSS test scope.
- **Parked:** the unknown tablet group-save issue (likely superseded by F02-S05's rig model, unverified) and the dependency audit (development-chain advisories only).

## Next orchestration

1. Verify this handoff on remote main and the current baseline.
2. Read AGENTS, the [snapshot contract](iem-snapshot-contract.md) and this handoff.
3. Finish F07-S01 (independent review, root live acceptance on MixMate1/MixMate2 only, including confirming the `settings.block.*` INIT form), merge, then brief F07-S02 (UI on the F07-S01 API).

No sidebar chat or automatic responsibility transfer has been created.
