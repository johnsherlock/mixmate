# Orchestrator handoff — authorized batch complete, 2026-11-21

Before new work, read:
- [AGENTS](../AGENTS.md);
- the [lifecycle](orchestration.md);
- the [backlog](backlog.md);
- the assigned story and its feature;
- the current contracts.

This handoff is identified by its containing PR and history, not by its own commit hash. **The last verified baseline on main is the F07-S02 merge `2e9e46f`.** Verify it on remote main before relying on this text.

## State

The user-authorized batch **F02-S05 → F07-S01 → F07-S02**, plus the user-requested F09-S11, is **complete**.

| Story | PR | Merge commit | Final approved head |
| --- | --- | --- | --- |
| [F02-S05](stories/F02-S05.md) snapshot-named rigs, known addresses, automatic connection | [#58](https://github.com/johnsherlock/mixmate/pull/58) | `f6a1ecd` (2026-11-20 22:44 UTC) | `7429ddc` |
| [F09-S11](stories/F09-S11.md) live UI tidy (user-requested) | [#59](https://github.com/johnsherlock/mixmate/pull/59) | `61d08fd` (2026-11-21 09:32 UTC) | `db393b4` |
| [F07-S01](stories/F07-S01.md) snapshot discovery and operation contract ([contract](iem-snapshot-contract.md), [ADR-0009](adr/0009-snapshot-operation-contract.md)) | [#60](https://github.com/johnsherlock/mixmate/pull/60) | `b916b31` (2026-11-21 09:47 UTC) | `f4142e8` |
| [F07-S02](stories/F07-S02.md) snapshot operations (Recall/Save dialogs) | [#61](https://github.com/johnsherlock/mixmate/pull/61) | `2e9e46f` (2026-11-21 10:01 UTC) | `a61e1d1` |

- **Not authorized:** F07-S03 (recording) and F07-S04 (native UI access).
- **Drafted, not authorized:** [F01-S05](stories/F01-S05.md) (side-loaded Android APK; open decisions for the user: application ID, APK contents, minimum Android version, signing key and first Release; planned ADR-0010).
- **No implementation is authorized until the user says so.** Backlog priority alone does not authorize execution.

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

## Verification and resources

- **Application:** 0.5.0, 18 precached assets, **486/486** fake tests. Local Node 26; CI Node 24.
- **Desk state:** current snapshot **MixMate1**. During F07-S02 acceptance root recalled MixMate1 and MixMate2 and saved MixMate1 from the live state (2026-11-21), so MixMate1 now holds those contents. Full INIT dumps were identical before and after, and no other snapshot was touched. Live records: [PR #58](https://github.com/johnsherlock/mixmate/pull/58#issuecomment-7052427422), [PR #60](https://github.com/johnsherlock/mixmate/pull/60#issuecomment-7060808085), [PR #61](https://github.com/johnsherlock/mixmate/pull/61#issuecomment-7060957809).
- **Prototype:** `mockups/iem.html` unchanged, SHA256 `d004af78c3ae59491dca09f4202d1697e95d1411c07334e6e292da0ec3a266a9`.
- `.claude/launch.json` is a local, untracked root convenience file; do not commit it.

## Remaining items

- **Physical qualification:** [F08-S01](stories/F08-S01.md) owns Android/iOS, installation/offline, sleep/recovery and real touch, including real-device wake, visibility and `online` auto-connect behaviour and the v2 settings upgrade. It stays the release gate.
- **Accepted P3s** for F02-S05, F09-S11, F07-S01 and F07-S02 and earlier ones live in [follow-ups](user-follow-up.md).
- **Parked:** the unknown tablet group-save issue (likely superseded by the F02-S05 rig model, unverified) and the dependency audit (development-chain advisories only).

No sidebar chat or automatic responsibility transfer has been created.
