# Orchestrator handoff — F08 batch in progress, 2026-11-24

Before new work, read:
- the [current product/state handoff](iem-integration-handoff.md) (replaced the stale early-baseline file on 2026-11-24);
- [AGENTS](../AGENTS.md);
- the [lifecycle](orchestration.md);
- the [backlog](backlog.md);
- the assigned story and its feature;
- the current contracts.

This handoff is identified by its containing PR and history, not by its own commit hash. **The last verified baseline on main is the PR #72 merge `0a6e801` (F08-S01 user sign-off documentation; app 0.10.1).** Verify it on remote main before relying on this text.

## Current authorized batch

The user authorized [F08-S06](stories/F08-S06.md) → [F08-S07](stories/F08-S07.md) → [F08-S04](stories/F08-S04.md) → [F08-S05](stories/F08-S05.md) on 2026-11-24. Each story requires final-head approval, passing CI and a confirmed merge before the next starts. The batch ends with a reviewed repository handoff. [F08-S02](stories/F08-S02.md) is explicitly excluded.

- **F08-S06:** the user-approved visual Nudge preview is prepared on `codex/f08-s06-nudge-preview` from `0a6e801` (app 0.11.0). Final-head review, CI and merge confirmation are pending. The delivery contains the preview and the linked planning documents for the three queued stories.
- **Verification:** local install, 604 tests and production build passed. Chromium viewport emulation with a synthetic mixer model verified both phone and both tablet orientations, button behavior and Faders return. See the [story verification](stories/F08-S06.md#delivery-verification) for sizes and limits. This preview check used no physical device or desk.
- **Delegation:** Opus and Sonnet were unavailable in this environment. The available Codex orchestrator and one Codex story agent handled F08-S06 in an isolated clone. The review and CI gate still applies.
- **Next eligible story:** F08-S07 once the F08-S06 merge is confirmed. F08-S04 and F08-S05 are queued behind it.

## Prior state

The user-authorized batches (**F02-S05 → F07-S01 → F07-S02**, the user-requested F09-S11, and the remaining F07 order **F07-S06 → F07-S03 → F07-S04**) are **complete**. All of F07 (S01–S06) is merged.

| Story | PR | Merge commit | Final approved head |
| --- | --- | --- | --- |
| [F02-S05](stories/F02-S05.md) snapshot-named rigs, known addresses, automatic connection | [#58](https://github.com/johnsherlock/mixmate/pull/58) | `f6a1ecd` (2026-11-20 22:44 UTC) | `7429ddc` |
| [F09-S11](stories/F09-S11.md) live UI tidy (user-requested) | [#59](https://github.com/johnsherlock/mixmate/pull/59) | `61d08fd` (2026-11-21 09:32 UTC) | `db393b4` |
| [F07-S01](stories/F07-S01.md) snapshot discovery and operation contract ([contract](iem-snapshot-contract.md), [ADR-0009](adr/0009-snapshot-operation-contract.md)) | [#60](https://github.com/johnsherlock/mixmate/pull/60) | `b916b31` (2026-11-21 09:47 UTC) | `f4142e8` |
| [F07-S02](stories/F07-S02.md) snapshot operations (Recall/Save dialogs) | [#61](https://github.com/johnsherlock/mixmate/pull/61) | `2e9e46f` (2026-11-21 10:01 UTC) | `a61e1d1` |
| [F07-S04](stories/F07-S04.md) native UI access (new tab) | [#66](https://github.com/johnsherlock/mixmate/pull/66) | `5c6fdc8` (2026-11-21) | `bae56a2` |
| [F06-S05](stories/F06-S05.md) AUX EQ filters (user-requested) | [#68](https://github.com/johnsherlock/mixmate/pull/68) | `c1bfe3f` (2026-11-22) | `de5e387` |
| [F09-S12](stories/F09-S12.md) UI tweaks (user-requested) | [#69](https://github.com/johnsherlock/mixmate/pull/69) | `c8dab46` (2026-11-22) | `b20877e` |
| [F09-S13](stories/F09-S13.md) Create/Edit Group button order (user-requested) | [#70](https://github.com/johnsherlock/mixmate/pull/70) | `95b612b` (2026-11-22) | `33daa77` |
| Docs: current product/state handoff and orchestrator handoff (docs-only, no app change; [record](https://github.com/johnsherlock/mixmate/pull/71)) | [#71](https://github.com/johnsherlock/mixmate/pull/71) | `02b158c` (2026-11-24) | `04be303` |

- **Merged (user-requested, 2026-11-21): [F06-S05](stories/F06-S05.md) AUX EQ high-pass / low-pass filters (Low cut / High cut), app 0.9.0,** [PR #68](https://github.com/johnsherlock/mixmate/pull/68), merge `c1bfe3f`, final approved head `de5e387`, review and live record https://github.com/johnsherlock/mixmate/pull/68#issuecomment-7065042504. Extends the AUX GEQ allowlist row by exactly `a.<0..9>.eq.hpf` / `.eq.lpf` (typed intent, same guard). Accepted P3s in [follow-ups](user-follow-up.md): a new gesture within the echo window after a filter release may be refused once; a dropped one-side echo keeps the cuts read-only until the next change or a reconnect; mono-output and slope behaviour are untested live.
- **User-requested, merged (2026-11-22): [F09-S12](stories/F09-S12.md) UI tweaks, app 0.10.0, [PR #69](https://github.com/johnsherlock/mixmate/pull/69), merge `c8dab46`, final approved head `b20877e`.** Root did not live-test the group readout or Edit Group with an expanded group (no saved group on the test origin).
- **User-requested, merged (2026-11-22): [F09-S13](stories/F09-S13.md) Create/Edit Group moved immediately right of All Groups, app 0.10.1, [PR #70](https://github.com/johnsherlock/mixmate/pull/70), merge `95b612b`, final approved head `33daa77`, review/live record https://github.com/johnsherlock/mixmate/pull/70#issuecomment-7082233250.** Layout-only; no wire or allowlist change. Not part of any batch.
- **User report (2026-11-24): the user has done extensive testing on real phones and tablets and it is all working very well.** The user then said "You can sign it off": **F08-S01 is signed off by the user, 2026-11-24** (user sign-off from their own testing of app 0.10.1, not a waiver; per-row results unrecorded; carried exceptions in the [story](stories/F08-S01.md#sign-off--2026-11-24) and [follow-ups](user-follow-up.md)). F08-S02 is unblocked but not authorized.
- **Authorized (user, 2026-11-21; completed): the rest of F07, in this order: F07-S06 → F07-S03 (recording) → F07-S04 (native UI access).** Sequential, one story agent at a time.
- **Merged:** [F07-S05](stories/F07-S05.md) automatic online updates, install prompt and visible versioning (0.6.0), [PR #63](https://github.com/johnsherlock/mixmate/pull/63), merge `5cd755c` (2026-11-21 11:51 UTC), final head `3715737`, record https://github.com/johnsherlock/mixmate/pull/63#issuecomment-7062173207. It had no dependency on F07-S03/S04; the exception is recorded in [follow-ups](user-follow-up.md). **Merged:** [F07-S06](stories/F07-S06.md) install prompt fallback (0.6.1), [PR #64](https://github.com/johnsherlock/mixmate/pull/64), merge `4c6c574`, final head `3a516a3`. Version policy: [orchestration](orchestration.md#versioning-policy-f07-s05).
- **Merged:** [F07-S03](stories/F07-S03.md) multitrack recording status and control (0.7.0), [PR #65](https://github.com/johnsherlock/mixmate/pull/65), merge `901a342`, final head `02bf217`; live start/stop acceptance **parked** pending a USB drive in the desk (accepted P3s: stop requires `rec.busy` < 0.5; a stale `rec.time` may flash at start). **Merged:** [F07-S04](stories/F07-S04.md) native UI access (0.8.0), [PR #66](https://github.com/johnsherlock/mixmate/pull/66), merge `5c6fdc8`, final head `bae56a2`, review/live record https://github.com/johnsherlock/mixmate/pull/66#issuecomment-7064454470. The authorized F07 order is complete; the remaining F07 item is F07-S03 live start/stop acceptance, **parked** until a USB drive is in the desk.
- **Drafted, not authorized:** [F01-S05](stories/F01-S05.md) (side-loaded Android APK, now also including an APK-only full-screen overlay of the desk's native UI behind the Native button, user decision 2026-11-21; open decisions for the user: application ID, APK contents, minimum Android version, overlay implementation (iframe vs plugin) and connection behaviour, signing key and first Release; planned ADR-0010).
- The current authorized scope is recorded above. Backlog priority alone does not authorize execution.

## Delegation (user rule, 2026-11-21)

Root orchestrates and delegates all development and docs work to fresh-context Sonnet subagents, each in its own worktree, with a separate fresh-context reviewer. Root does not implement. This overrides the older "GPT-6.1 Sol Medium" wording in AGENTS and the lifecycle document: Opus orchestrator, Sonnet story and review agents. Still one story, one `codex/` branch and one PR at a time, sequentially. Reproduce on the desk anything the user reports before writing a brief.

## Review gate substitution (user direction, still in force)

Codex is out of usage. Use an **independent fresh-context agent review** instead of `@codex review`. Merge only when all of these hold:
- the reviewer approved the exact final head;
- CI passed on that head;
- every P1 and P2 is resolved;
- root completed live desk acceptance.

Record the review rounds and live results in a comment on the PR. Return to `@codex review` once it is available, unless the user directs otherwise.

## Standing user permissions and rules

- Root may change anything on the desk (Ui24R **192.168.0.60**, firmware **3.0.7865-ui24**) except saving, recalling or deleting snapshots, with one exception: the user created test snapshots **MixMate1** and **MixMate2** and allowed recalling and saving those two (never delete them; never save over or recall any other snapshot).
- Use SPARE (AUX 9/10) for write tests. If JOHN'S MIX is touched, capture its values first and restore them exactly. A recall changes the whole desk, so capture a full INIT dump before and compare after.
- The stale untracked early-baseline `docs/iem-integration-handoff.md` was replaced by the current handoff at the user's request on 2026-11-24; the file is now tracked and is the product/state handoff ([link](iem-integration-handoff.md)). The AGENTS transport table remains the allowlist authority.
- F08-S01 (real phone and tablet testing) was signed off by the user on 2026-11-24; do not claim more than that (per-row results unrecorded, iOS/iPadOS not recorded, exceptions carried). Future device/offline claims still need evidence.

## F02-S05 delivered behavior (user decisions 2026-11-20)

These supersede older wording; AGENTS, the story and [settings](settings-repository.md) / [groups](iem-groups.md) docs carry the detail.
- **Rig identity = the desk's current snapshot name**, received as `SETS^var.currentSnapshot^<name>` (receive-only, bounded). Exact, case-sensitive match: load the rig or create an empty one. **Follow live:** a native recall while connected switches rigs (gestures/selection cancelled, socket kept). An empty or invalid name means no rig, with a one-line reason. Offline, Edit Groups uses the last-used rig.
- **Rig UI removed.** The live Connect dialog is the IPv4 address, Connect, Disconnect while connected, and Close.
- **Known addresses:** up to 8, most recent first, recorded only on full readiness (`qualified`: Ui24 state received and, for control sessions, the writer socket open).
- **Automatic connection** (live app only) on open, after an unexpected drop of a qualified session, on page visible/`pageshow`/`online`: one pass through known addresses, 5 s per attempt, never overlapping; falls back to the Connect dialog. A drop within 30 s of an automatic success opens the dialog instead. Explicit Disconnect suppresses it until the next explicit Connect or app open. Passes pause and triggers defer while any other dialog (Edit Groups, pan, EQ, channel detail) is open.
- **Settings v3:** rigs `{ id, name, groups, navigation }`, `knownAddresses`, no `localDefinitions`; 128-rig cap (evicts only an empty non-current rig; otherwise no rig with a reason). v1/v2 records discard rigs and groups, seed known addresses, keep preferences.
- No new outbound message; the transport allowlist is unchanged.

## Verification and resources

- **Application:** 0.10.1 (baseline `02b158c`; app code last changed in `95b612b`); 604 fake tests pass; the offline worker precaches 18 assets (both re-verified with `npm ci && npm test && npm run build` on 2026-11-24). Local Node 26; CI Node 24.
- **Desk state:** current snapshot **MixMate1**. During F07-S02 acceptance root recalled MixMate1 and MixMate2 and saved MixMate1 from the live state (2026-11-21), so MixMate1 now holds those contents. Full INIT dumps were identical before and after, and no other snapshot was touched. Live records: [PR #58](https://github.com/johnsherlock/mixmate/pull/58#issuecomment-7052427422), [PR #60](https://github.com/johnsherlock/mixmate/pull/60#issuecomment-7060808085), [PR #61](https://github.com/johnsherlock/mixmate/pull/61#issuecomment-7060957809).
- **Prototype:** `mockups/iem.html` unchanged, SHA256 `d004af78c3ae59491dca09f4202d1697e95d1411c07334e6e292da0ec3a266a9`.
- `.claude/launch.json` is a local, untracked root convenience file; do not commit it.

## Remaining items

- **Physical qualification:** [F08-S01](stories/F08-S01.md) owns Android/iOS, installation/offline, sleep/recovery and real touch, including real-device wake, visibility and `online` auto-connect behaviour and the v2 settings upgrade. **Signed off by the user on 2026-11-24** from their own real-device testing; per-row results were not recorded and the exceptions below stay open.
- **Accepted P3s** for F02-S05, F09-S11, F07-S01 and F07-S02 and earlier ones live in [follow-ups](user-follow-up.md).
- **F08-S02** release/recovery documentation is unblocked by the sign-off but **not authorized**.
- **Other F08-S01 carried exceptions:** F07-S03 live recording start/stop untested (USB drive needed); iOS/iPadOS coverage not recorded; shared-origin StackIt cache-deletion risk; F09-S12 group readout / Edit Group with an expanded group not observed by the orchestrator.
- **Open finding:** the Pixel install issue (Chrome refuses to install the PWA, Brave installs it) remains open; F07-S06 added a menu-instructions fallback only.
- **Parked:** F07-S03 live start/stop acceptance (needs a USB drive in the desk); the unknown tablet group-save issue (likely superseded by the F02-S05 rig model, unverified) and the dependency audit (development-chain advisories only).

No sidebar chat or automatic responsibility transfer has been created.
