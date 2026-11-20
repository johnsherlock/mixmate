# MixMate implementation backlog

Current plan: 2026-11-18. Nine features contain **42 stories**. The accepted `mockups/iem.html` remains the design reference; vanilla ES modules/Vite remain the architecture. The S04-only batch is complete and merged in PR #42 after final-head review, passing CI and targeted firmware validation. The subsequent explicit UI-alignment batch authorizes F04-S03 → F04-S04 → F02-S04 sequentially; F04-S03 is confirmed merged in PR #44; F04-S04 is confirmed merged in PR #45; final F02-S04 is confirmed merged in PR #46. The authorized UI batch is complete and stops with its reviewed closing handoff; no next implementation is authorized. A subsequent user-reported usability fix, F04-S05 (All Mixes group catalog, Delete group, device-local groups without a saved rig), is confirmed merged in [PR #48](https://github.com/johnsherlock/mixmate/pull/48) at `0a387d6` after user-directed independent final-head review (Codex unavailable) and passing CI. The explicitly authorized F06-S04-only batch (AUX GEQ runtime/UI) is confirmed merged in [PR #49](https://github.com/johnsherlock/mixmate/pull/49) at `5c6a3ca` after user-directed independent final-head review (Codex unavailable), passing CI and a targeted post-fix live matrix on firmware 3.0.7865-ui24; the batch stops with its reviewed closing handoff. F07 is not started or authorized. The user-authorized F09-S05 (live throttled control writes, live group preview, full-range group travel; user decision 2026-11-18 reversing release-only commits) is confirmed merged in [PR #51](https://github.com/johnsherlock/mixmate/pull/51) at `7d8a8cb`. The user-reported F09-S06 (fader feel: stable drag geometry, dB-linear level display scale with a −60 dB group floor per the user decision of 2026-11-19, bounded GEQ/group echo waits and point-gain clamp) is merged in [PR #52](https://github.com/johnsherlock/mixmate/pull/52) at `50e24d5`; F09-S07 (−70 dB floor, strip cleanup, persistent GEQ points) is merged in [PR #53](https://github.com/johnsherlock/mixmate/pull/53) at `dc371cb`; F09-S08 (groups to −∞, group strip tracking, GEQ handle keyboard, export removal, nav placement) is merged in [PR #54](https://github.com/johnsherlock/mixmate/pull/54) at `9527f91`; F09-S09 (clean EQ/pan panels, immediate GEQ reset, pan value on strips) is merged in [PR #55](https://github.com/johnsherlock/mixmate/pull/55) at `c4acb38`; F09-S10 (GEQ graph `touch-action:none` for touch point drags) is merged in [PR #56](https://github.com/johnsherlock/mixmate/pull/56) at `8d30955`. The F09 user-feedback batch (S05–S10) is complete and stops with its reviewed closing handoff; no next implementation is authorized. Backlog priority alone does not authorize execution.

## Feature status

| Feature | Outcome | Stories | Current status |
| --- | --- | --- | --- |
| [F01](features/F01.md) | Offline distribution and compatibility | 7 | Merged implementation checkpoint; physical F08 qualification open |
| [F02](features/F02.md) | Device-local settings | 4 | S01–S04 merged; physical F08 qualification open |
| [F03](features/F03.md) | Read-only live IEM | 4 | Merged implementation checkpoint; firmware/physical qualification open |
| [F04](features/F04.md) | Groups and navigation | 5 | S01–S05 merged |
| [F05](features/F05.md) | Safe AUX level control | 3 | Merged implementation checkpoint; interoperability remediation in F09 |
| [F06](features/F06.md) | Pan and faithful AUX EQ | 4 | S01–S04 merged (S04 GEQ: targeted live evidence on one pair; F08 physical qualification open) |
| [F07](features/F07.md) | Snapshots, recording and native UI | 4 | Planned |
| [F08](features/F08.md) | Release validation | 3 | S03 evidence checkpoint merged; unresolved findings assigned below; S01/S02 open |
| [F09](features/F09.md) | Reliable control transport and state | 7 | S01–S10 merged; physical F08 gate open |

Feature numbers do not determine execution priority. Previously merged implementation remains merged; follow-up stories do not erase that history.

## Cross-feature execution priority

| Order | Story / gate | Dependency and purpose |
| --- | --- | --- |
| 1 | [F09-S01](stories/F09-S01.md) | [Reference/adapter decision](iem-native-protocol-reference.md) merged in PR #37; exact served-source gap parked |
| 2 | [F09-S02](stories/F09-S02.md) | [ADR-0008](adr/0008-control-state-model.md)/pure model merged in PR #38; integrated by S03 |
| 3 | [F09-S03](stories/F09-S03.md) | Existing level/group/pan integration merged in PR #40; superseded interaction and firmware gate addressed by S04 |
| 4 | [F09-S04](stories/F09-S04.md) | Complete, merged in PR #42; revised peer editing and applicable foundation validated; GEQ-specific integration remains F06-S04 |
| 5 | [F04-S03](stories/F04-S03.md) | Passed and affirmatively reviewed/merged applicable foundation gate → logical stereo mix overview |
| 6 | [F04-S04](stories/F04-S04.md) | F04-S03 → compact accessible channel detail |
| 7 | [F02-S04](stories/F02-S04.md) | F04-S04 delivery order → discoverable saved-rig setup and persistence feedback |
| 7a | [F04-S05](stories/F04-S05.md) | F02-S04 → user-reported group editor usability: All Mixes catalog, Delete group, device-local definitions |
| 8 | [F06-S04](stories/F06-S04.md) | F06-S03 + passed and affirmatively reviewed/merged applicable F09 readiness criteria → separately reviewed GEQ runtime/UI |
| 8a | [F09-S05](stories/F09-S05.md) | User-reported live-control fix after F06-S04: throttled live writes (level/group/pan/GEQ), group live preview, full-range group travel — merged in PR #51 |
| 8b | [F09-S06](stories/F09-S06.md) | User-reported fader feel after F09-S05: stable drag geometry, dB-linear level scale and −60 dB group floor (user decision 2026-11-19; superseded by F09-S07 −70 dB, then F09-S08 to −∞), bounded echo waits, GEQ point-gain clamp — merged in PR #52 at `50e24d5` |
| 8c | [F09-S07](stories/F09-S07.md) | User desk feedback after F09-S06: −70 dB fader/group floor (user decision 2026-11-20; group floor superseded by F09-S08 to −∞), no per-strip state line, debug-only Details, persistent GEQ points, compact group Δ — merged in PR #53 at `dc371cb` (`dc371cb09c4973c8910393b722d7d98d571ed07f`) |
| 8d | [F09-S08](stories/F09-S08.md) | User feedback after F09-S07: group faders travel to −∞ in display-scale units (user decision 2026-11-20), group strip tracks members, GEQ point keyboard/near-handle grab, settings export/import removed, right-aligned group navigation — merged in PR #54 at `9527f91` (`9527f91e6f00fdaaa0fc4f3f34471f312501c47e`) |
| 8e | [F09-S09](stories/F09-S09.md) | User feedback after F09-S08: EQ diagnostics only with `?debug`, immediate GEQ reset (user decision 2026-11-20), prototype pan dialog and `PAN · L 30` strip labels (user decision 2026-11-20) — merged in PR #55 at `c4acb38` (`c4acb380c24be56afa9b87dd402d6f27673ad755`) |
| 8f | [F09-S10](stories/F09-S10.md) | User report after F09-S09: GEQ point touch drag was pointercancelled by Chrome; the live graph svg is `touch-action: none` in points mode too, as the prototype — **Merged** in [PR #56](https://github.com/johnsherlock/mixmate/pull/56) at `8d30955` |
| 9 | [F07](features/F07.md) S01 → S02 → S03 → S04 | F06-S04 → exact snapshot contract, operations, recording, native access |
| 10 | [F08-S01](stories/F08-S01.md) | All release implementation → supported physical devices, both rigs, offline/sleep/control gate |
| 11 | [F08-S02](stories/F08-S02.md) | F08-S01 → release/recovery documentation |

This is the intended sequence, not a hardware waiver: if F09-S04 is blocked, park exact unrun rows; downstream work remains blocked until its applicable gate is met or an explicit reviewed dependency exception establishes that the proposed work is independent. ADR-0002 alone does not waive the F09 readiness gate. A checklist alone does not make F06-S04 eligible. F08-S03 is an evidence checkpoint with successors, not an indefinite catch-all dependency. Logical overview precedes compact detail so detail uses stable mix identity; saved-rig feedback then closes the remaining usability finding before EQ expansion.

## Current capability and evidence

The live IEM owns its WebSocket/session. `soundcraft-ui-connection` 7.1.0 currently supplies imported display converters; related meter/relative math and protocol references are distinct from instantiating its connection/control facade. [ADR-0007](adr/0007-owned-protocol-adapter.md) selects owned transport plus existing helper-only retention; the [versioned reference/manifest](iem-native-protocol-reference.md) indexes portable official source and explicitly parks unavailable served-source provenance. A library replacement is not an established remedy.

Reviewed runtime capability is AUX master/send levels, relative groups and eligible normalized mono-source pan into verified reciprocal stereo AUX pairs. S04, merged in [PR #42](https://github.com/johnsherlock/mixmate/pull/42), implements the [peer runtime](iem-control-runtime.md): one explicit connection owns a typed writer and a receive-only companion supplying actual state. Qualified controls are directly editable without Enable/Disable, native changes update actuals and cancel obsolete intent, and a new deliberate gesture uses compatible current state. Groups require complete fresh actual basis and a common cached delta per gesture; partial dispatch stops without replay and requires complete compatible recovery. Intent, send return and matching observations remain distinct from actual receipt/correlated ACK. Read-only factories remain single-socket connection-only. GEQ band-peak runtime/UI is merged in F06-S04 (sparse changed-band dispatch, targeted live evidence on one reciprocal pair; see the [EQ contract](iem-aux-eq-contract.md#f06-s04-runtimeui-integration--2026-11-18-merged)); shelves/filters are unverified. Snapshots/recording remain unwired. [AGENTS](../AGENTS.md) and linked contracts define authority.

The [S04 evidence](f09-s04-firmware-validation.md#final-current-matrix-and-readiness-decision) corroborates bidirectional level/group/pan state on firmware `3.0.7865-ui24`, native away/back cancellation, fresh group reanchoring and genuine one-of-two partial application/recovery. Older absent-sender-echo findings remain evidence for the companion design, not universal firmware/precision guarantees. Last fresh paired actuals before disconnect: masters `.378`, i0 sends `.5535736856`, i1 sends `.455`, i1 pan `.743`, left applied. All owned live resources are closed; no agent snapshot action occurred. Standing user permission covers necessary tests within an authorized story without repeated gesture/time-window approvals, as [ADR-0004](adr/0004-aux-level-safety.md#current-user-direction-and-testing-permission--2026-11-17) records.

## Verified delivery checkpoints

Last verified story baseline: `5c6a3ca995c6b56c527823689d9bce3374610dcb` on main; closing handoff delivery is identified by its containing reviewed PR/history. Root verified these merged GitHub deliveries, final-change affirmative review and passing CI on 2026-11-16–18:

| PR | Delivery | Merge commit |
| --- | --- | --- |
| [#29](https://github.com/johnsherlock/mixmate/pull/29) | F06-S03 pure GEQ primitives | `af4f23026f4f412250bef3fb91168f21db91e017` |
| [#31](https://github.com/johnsherlock/mixmate/pull/31) | F08-S03 offline investigation/fake diagnostics | `820702013b76e969f32b3d381cb080f1f62b4ed1` |
| [#32](https://github.com/johnsherlock/mixmate/pull/32) | Passive firmware evidence | `847b892b89a74d4c888505b76ab06c5fa50d7918` |
| [#33](https://github.com/johnsherlock/mixmate/pull/33) | Controlled linked-master evidence | `78bd267d4ca2da0252f180b70b70b4dcc8db845e` |
| [#34](https://github.com/johnsherlock/mixmate/pull/34) | Native transport evidence | `28bb2875ba62fae7f98da279ed79f06461f1318d` |
| [#36](https://github.com/johnsherlock/mixmate/pull/36) | Orchestrator lifecycle / batch | `c27f0d3f468887dcc8cf9e4382db7215d4d955a9` |
| [#37](https://github.com/johnsherlock/mixmate/pull/37) | F09-S01 reference / ADR-0007 | `5bdf2c667aeffc50919e8e26aad5b09a63888d59` |
| [#38](https://github.com/johnsherlock/mixmate/pull/38) | F09-S02 pure model / ADR-0008 | `2e7edcba19e25d0d8b08e5f7825a33a7a0bc8231` |
| [#39](https://github.com/johnsherlock/mixmate/pull/39) | Reviewed S01/S02 closing handoff | `03f141f610124597cc93f7002388b88b1cf76d44` |
| [#40](https://github.com/johnsherlock/mixmate/pull/40) | F09-S03 private runtime integration | `446664578d5470378730d6acdbe5aa77488a72fb` |
| [#41](https://github.com/johnsherlock/mixmate/pull/41) | Reviewed S03 closing handoff | `865e0085ac45eeee1ced8c6ff1e8b2762943f2b4` |
| [#42](https://github.com/johnsherlock/mixmate/pull/42) | F09-S04 peer runtime and targeted firmware validation | `2b3972df9b3d2e0e10c891d4dcc5a819b1e7fa1e` |
| [#43](https://github.com/johnsherlock/mixmate/pull/43) | Reviewed S04 closing handoff | `6c303de2ddecd8bec1b0d3ccbc1c01c6482d3219` |
| [#44](https://github.com/johnsherlock/mixmate/pull/44) | F04-S03 logical stereo mixes | `c287a6cd5eb0ce51c998ca86e9552ae057f2e181` |
| [#45](https://github.com/johnsherlock/mixmate/pull/45) | F04-S04 compact accessible channels | `09e0cc3110fdaef6b6227de0115c9307c44da815` |
| [#46](https://github.com/johnsherlock/mixmate/pull/46) | F02-S04 live rig setup and current-document backup | `68e61d7964ab42fb2a149752266aa1b1148bf355` |
| [#47](https://github.com/johnsherlock/mixmate/pull/47) | UI batch closing handoff | `7de61b329255242ba81d184b6b3becc561641fde` |
| [#48](https://github.com/johnsherlock/mixmate/pull/48) | F04-S05 group editor usability | `0a387d64050466b9c138c8b9b584a867a8e85bb9` |
| [#49](https://github.com/johnsherlock/mixmate/pull/49) | F06-S04 approved AUX GEQ controls | `5c6a3ca995c6b56c527823689d9bce3374610dcb` |
| [#51](https://github.com/johnsherlock/mixmate/pull/51) | F09-S05 live throttled writes and full-range groups | `7d8a8cbc61974a98847e44c4c1b97c5d36bfcbee` |

Earlier implementation receipts remain in individual stories and Git history (F01–F05; F06-S01/S02). Historical pending/stop wording in evidence reports describes those checkpoints, not current PR state. F08-S03 is not fully validated and no physical support pass follows from these merges.

## Orchestration and release gates

Follow [AGENTS](../AGENTS.md) and the canonical [orchestrator lifecycle](orchestration.md): one fresh-context Sol Medium story agent, sequential reviewed delivery, automatic progression within the recorded authorized batch and a verified repository handoff before stopping. The previous F09-S01/S02 batch is complete. The 2026-11-17 **F09-S03-only** batch is complete, confirmed merged in PR #40 after final review and passing CI. That S03 batch stopped with its reviewed handoff and made no hardware action. S04 subsequently began under separate explicit authorization; its current status is below. Preserve unrelated work, especially untracked `docs/iem-integration-handoff.md`.

[ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md) already authorizes the named feature classes; exact forms/types/ranges and deliberate reviewed typed-guard/allowlist changes remain mandatory. Story-scoped live testing now has the user's separate standing permission in ADR-0004. The completed S04 batch performed no snapshot action and starts no F07 work; future implementation/testing must stay within its authorized story.

Library/native source evidence, fake tests, observed device/firmware trials and hypotheses must remain distinct. [F08-S01](stories/F08-S01.md) retains Android/iOS, installation/current-asset offline proof, local-network permissions, sleep/recovery, both rigs and all implemented controls as a physical release gate. Record unresolved findings and dependency exceptions in [follow-ups](user-follow-up.md). Start from the concise [handoff](orchestrator-handoff.md).

## Historical S04-only batch boundary — previously parked, 2026-11-17

[Exact matrix/evidence](f09-s04-firmware-validation.md) corroborates scoped repeated level/group/pan owner behavior (eight trusted gestures/twenty returned SETD, no sender target echoes) and limited later current-state/precision points. Native edit/away-back, real partial/interrupted dispatch and full touched-closure recovery plus explicit rearm remain **blocking**. S04 is parked incomplete; **F06-S04 not ready**, F08 physical release gate remains open.

[Draft PR #42](https://github.com/johnsherlock/mixmate/pull/42) contains the reviewed handoff off main; no merge/downstream implementation. All owned live resources closed; no further connection in this batch. Preserve existing user target/time/publication approval while assessing genuinely missing scope/evidence; excluded native/fault actions are not implied. Root owns future orchestration/acceptance; story agent stops after final-head review/CI/checkpoint verification.

## Revised S04 direction — 2026-11-17

The user explicitly expanded the S04-only batch to implement and validate equal-weight peer editing of existing level/group/eligible-pan controls. Qualified connected targets require no manual Enable/Disable or rearm after native edits; obsolete gesture cancellation and fresh compatible basis remain necessary. PR #42 retains historical old-model evidence, but revised code/contracts need new final-head review and CI. Standing story-scoped live testing permission supersedes old per-window/native/fault exclusions for necessary S04 tests. No downstream story, GEQ runtime, new write class or agent snapshot action is authorized. See the [revised story](stories/F09-S04.md) and [current user direction](adr/0004-aux-level-safety.md#current-user-direction-and-testing-permission--2026-11-17).


## Revised S04 accepted checkpoint — 2026-11-17

Root accepted the [final attributed existing-control foundation matrix](f09-s04-firmware-validation.md#final-current-matrix-and-readiness-decision) after e032 real-partial diagnostic/recovery/native-edit validation. [PR #42](https://github.com/johnsherlock/mixmate/pull/42) merged at `2b3972d` after [affirmative final-head review](https://github.com/johnsherlock/mixmate/pull/42#issuecomment-6963443125) and [passing CI](https://github.com/johnsherlock/mixmate/actions/runs/44194367234). F06-S04's applicable foundation dependency is satisfied; separately reviewed implementation still retains every GEQ-specific and F08 physical gate. This is no GEQ hardware qualification. The S04-only batch is complete and stops with its reviewed repository handoff. No F04/F02/F06/F07/downstream implementation starts without a new explicit batch. Earlier parked/pending passages are historical checkpoints.
