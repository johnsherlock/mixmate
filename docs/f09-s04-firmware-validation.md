# F09-S04 targeted firmware validation — 2026-11-17

## Checkpoint and authorization

**In progress; hardware gate not passed.** The user explicitly said “Start F09-S04” after confirming the desk powered on/reachable. This authorizes the S04-only preparation batch, not arbitrary hardware changes or downstream implementation. Baseline is reviewed main `865e0085ac45eeee1ced8c6ff1e8b2762943f2b4`: S03 [PR #40](https://github.com/johnsherlock/mixmate/pull/40) merged `4466645` after [final-head affirmative review](https://github.com/johnsherlock/mixmate/pull/40#issuecomment-6945742415) and [passing CI](https://github.com/johnsherlock/mixmate/actions/runs/44066914415); closing [PR #41](https://github.com/johnsherlock/mixmate/pull/41) merged at the baseline. The story branch is `codex/f09-s04-firmware-validation`. Root owns live-browser actions and final acceptance; this story agent owns documentation/checks/review preparation, with no merge authority.

The root authorized exactly one bounded passive diagnostic to known `192.168.0.60`, literal `createReadOnlySession` from `src/iem/live-session.js`, native Node WebSocket, factory-send forwarding recorder, maximum ten seconds, no retry/reconnect/probe/other IP. No control factory, independent raw sender, parameter action, native reload/bootstrap, getter/INIT refresh, second simultaneous observer, hardware fault injection or snapshots. A failed sandbox-before-open attempt could be followed by one approved network execution. Further live work requires the root's concrete bounds and applicable user authorization below. Earlier diagnostics are historical evidence, not a blanket permission.

## Current-build validation matrix

Production source baseline `865e008`; expected S03 worker `091b1303c61d315d`, app0.5.0. A fresh production build and exact live-browser version/device/endpoint/socket provenance must be recorded before its rows can pass. The passive Node diagnostic is not a browser-build trial. Every not-run row below is unpassed; fake regressions are separate evidence.

| Row | Current hardware result | Required evidence / blocking disposition |
| --- | --- | --- |
| Passive model/topology/baseline | Pass, diagnostic connection only | Node26.13.1 own connection described below; does not qualify browser/runtime controls. |
| Repeated paired AUX master | Not run | Own browser: two deliberate gestures, pending block, bounded terminal outcome, retained same-scope permission/requested coordinate, raw actual separate, exact send/receipt counts. Blocks current targeted foundation gate. |
| Repeated paired source send | Not run | Same for qualified mono i1 into pair; master evidence does not substitute. Blocks source-send foundation claim. |
| Repeated four-path relative group | Not run | Canonical saved profile/group, finite immutable received anchor, two−0.1dB gestures and cumulative request, four unique paths each; no claimed hardware balance from intent. Blocks relative-group foundation claim and applicable EQ multi-write readiness. |
| Repeated eligible paired pan | Not run | Mono i1, verified reciprocal stereo pair/equal actual, exact normalized expected values; no direction/law assertion. Blocks eligible-pan foundation claim. |
| Field precision | Not run on current build | Raw owner receive records vs full-precision level/group and three-decimal pan command. No owner echo means precision remains unknown; later explicit new-generation snapshot is current state, not old operation confirmation. Blocks any precision-dependent readiness claim; exact-only safety remains conservative. |
| Native edit / away-back | Not run | Bounded separately authorized native action while owner records current-socket receipts; native change cancels/disarms even if later equal. No automatic rearm/send. Blocks native ownership gate. |
| Partial/interrupted outcomes | Not run | Hardware outcome/recovery must be distinguished from synthetic send throws or omitted fake echoes. No authorized hardware fault injection. Blocks applicable multi-write acceptance; two/four-path all-returned evidence cannot pass this row. |
| Explicit recovery | Not run | Complete compatible post-invalidation touched closure plus explicit rearm, or explicitly authorized new generation with complete actuals; no old-operation ACK/retry/replay. Blocks recovery foundation gate. |
| GEQ31/62 integration | Not run; deliberately unwired | GEQ-specific factory/processing/bypass/full-profile/31-or62-path ownership/send accounting remain F06-S04 reviewed implementation obligations. Not a current-control failure; no GEQ hardware actuation is proposed. |
| Physical Android/iOS/both rigs/offline/sleep | Not run here | Nonblocking for this targeted desktop firmware story only; still mandatory F08-S01 release gate. Desktop emulation cannot pass it. |

## Passive diagnostic: exact observation

A sandbox attempt at **12:06:53.322Z** never opened, received zero frames and sent nothing; error/unclean1006 at53.333Z, final disconnected/readyState3. This is no evidence of desk failure. One approved network execution began **12:07:11.408Z**, opened11.419Z, explicitly disconnected **12:07:20.411Z**, clean1000 close20.416Z; final **20.664Z** disconnected/readyState3. Endpoint `ws://192.168.0.60/`; Node **26.13.1**, native WebSocket; only connect/snapshot/disconnect invoked on the literal read-only session.

Exact outgoing inventory: **`3:::INIT`1, `3:::ALIVE`8, `2::`131**; no other outgoing strings or parameter writes. The recorder forwarded factory sends unchanged and had no independent sending call. **558 incoming frames**, zero skipped frames/lines, zero selected-record overflow. Inspection bounded text frames to131072bytes,2048lines, each line4096characters and retained at most250 selected records. It retained68 records, two repetitions of34 selected fields. Ignored supporting script/result: `output/f09-s04/passive.mjs`, `passive-result.json`; the following durable transcription is sufficient without them.

| Raw path(s) | Received raw value | Timing / interpretation |
| --- | --- | --- |
| model / firmware | `ui24` / `3.0.7865-ui24` | 12:07:11.470Z, repeated11.569Z |
| a.0.matrix / a.1.matrix | `0` / `0` | AUX, not matrix;11.498/11.497Z, repeated11.597/11.596Z |
| a.0.stereoIndex / a.1.stereoIndex | `0` / `1` | Reciprocal pair; same AUX timing |
| a.0.mix / a.1.mix | `0.3961953345` / `0.3961953345` | Equal received masters; same AUX timing |
| a.0.mute / a.1.mute | `0` / `0` | Same AUX timing |
| i.0.name / i.1.name | `BASS L` / `CARL HELIX` | i0 at11.471Z/repeat11.569Z; i1 at11.467Z/repeat11.566Z |
| i.0.stereoIndex | `-1` | Mono;11.537Z/repeat11.629Z |
| i.1.stereoIndex | `-1` | Mono;11.476Z/repeat11.575Z |
| i.0.aux.0.value / i.0.aux.1.value | `0.5637261879` / `0.5637261879` | Equal sides;11.476Z/repeat11.575Z |
| i.1.aux.0.value / i.1.aux.1.value | `0.472038219` / `0.472038219` | Equal sides; same send timing |
| i.0.aux.0.pan / i.0.aux.1.pan | `0` / `0` | Equal sides; same send timing |
| i.1.aux.0.pan / i.1.aux.1.pan | `0.7609890109` / `0.7609890109` | Equal sides; same send timing |
| i.0/i.1 × aux.0/aux.1 mute / post / postproc | `0` / `0` / `1` for each | Same send timing; these are actual received prerequisites, no writes |

All own sockets/timers closed; no diagnostic observer remains. Values are observations at this instant, not reserved baselines for later gestures. No value was changed or restored. The earlier last-applied master value happens to match this receipt; no causality claim follows.

## Proposed bounded live plan — not yet authorized/executed

Root must record the user's exact applicable approval and current browser build/device/version/endpoint/socket before acting. Use one owning MixMate browser socket at a time for at most180seconds overall, no simultaneous observer, at most two explicit connections total. The second connection is a separately authorized explicit recovery between the source-send and group rows if complete same-session post-floor receipts are absent; close the first before opening it. Recheck all prerequisites from that owner's received current generation, including local canonical profile/group identity; stop if the passive baseline no longer applies. Instrumentation may forward/record normal owned sends/receipts only; it must not dispatch or rewrite requests. Each operation has one new explicit gesture and deliberate keyup/release, then at least3seconds observation before another gesture. Pending must block controls; terminal unchanged same-scope sent-unverified may retain permission. Any conflict/ineligible/partial/lifecycle anomaly stops that block; no automatic repair, retry or rollback.

| Sequence | Target and gesture limit | Per-target bound / expected command count |
| --- | --- | --- |
| 1 | a0/a1 master, enable once, at most two ArrowDown+release gestures | At most0.0015 decrease per gesture accounting for slider normalization, at most0.003 total;2paths each,4SETD maximum. |
| 2 | i1→a0/a1 send, enable once, at most two ArrowDown+release gestures | Same normalized bounds;2paths each,4SETD maximum. |
| 3 | Saved device-local group exactly{i0,i1}, bound to explicitly selected saved rig profile, AUX pair, enable once; at most two−0.1dB release gestures | Immutable fresh received anchor; cumulative request−0.2dB maximum;4unique paths each,8SETD maximum. i1 group anchor must be its then-received actual, never the unverified preceding send request. |
| 4 | i1→a0/a1 pan, enable once, at most two−0.001 release gestures | At most0.0015 decrease per gesture,0.003 total; three-decimal normalized commands;2paths each,4SETD maximum. No direction label. |

Maximum **8 gestures/20 parameter strings**; each gesture may send fewer/no commands if no-op or fail-closed. Do not increase attempts to make a row pass. The reduction is left applied; no compensating gesture, rollback, scene/snapshot save/recall/delete or other writer. Final commanded and last actually received values must both be reported; absent readback means final physical state is unknown. Close owned connection/recorders at block end and verify no reconnect/arming.

Selection after an authorized operation invalidates its touched closure. The group overlaps the preceding i1 send values; unchanged old received values cannot clear that barrier. If complete compatible post-floor same-session receipts are unavailable, stop and use only the explicitly authorized single reconnect/new generation before group selection; otherwise park group. Record current baseline after recovery. Pan paths are distinct from send-value paths, but all actual/topology prerequisites still apply.

Missing scope: explicit live permission for these source/group/pan/master targets, limits, one explicit recovery reconnect between send/group if needed, and local saved-profile/group creation/change if needed. The saved rig needs explicit identity; an IP match/manual connection cannot establish it. Existing user local settings must be preserved; prefer a separately named local validation profile/group when authorized, recording whether retained/removed. This is preparation, not a request for the same ADR-0002 feature-class approval.

Native edits/recovery require a separate concrete approval: at most two tiny downward native AUX-pair cap gestures on the existing native app (no reload/bootstrap), bounded to≤0.003 normalized total and recorded forward-only actual native sends, while MixMate records unsolicited own-socket changes/cancellation. Pixel distance alone cannot guarantee a numerical bound; if the native control cannot preview/enforce it, have the user perform a specifically bounded edit or park it. Two downward gestures test native changes, not away/back; away/back needs a separately bounded plan and authorization. After invalidation, at most one explicit MixMate disconnect/Connect can obtain a complete new generation and explicit rearm **without a further write**, if authorized. This demonstrates current recovery, never old-operation confirmation. No second observer/getter/INITrefresh is proposed.

No live hardware partial-fault injection is authorized/proposed. Browser/fake thrown-send demonstrations cannot be labelled firmware partial outcomes. Park the blocking row pending a safe approved test or explicit reviewed rescope; do not silently waive it.

## Applicable EQ-readiness decision

**Not ready.** Current S04 owner-browser repetition, native ownership, real partial/interrupted outcomes and recovery rows are not run. S03's reviewed code/301fake tests establish client semantics, not firmware corroboration. The passive baseline establishes eligible example targets only. Existing exact comparison remains conservative; no field-specific tolerance, no universal sender-echo rule and no decimal-10 precision policy follow.

F06-S04 can become eligible only after the applicable foundation/transport/precision/ownership/multi-write rows above have passed and received affirmative review/merge, or a user-explicit reviewed rescope identifies genuinely independent work. A negative recorded decision or list of dependencies is insufficient. Even a successful2/4-path block would not validate31/62GEQ paths. Its separate reviewed integration must prove full31-band+bypass receipt completeness for each output, equal stereo profiles and processing invalidation/away-back, exact current owner/generation/selection, per-ordinal authorization/send-return accounting/reentrant stop, bounded pending/partial outcomes, all-path recovery and honest requested/actual UI, before any narrow runtime allowlist update. GEQ stays unwired; no proposed trial enables it. F08-S01 remains unchanged.

## Local verification at preparation checkpoint

Node26.13.1 (CI targetsNode24): `npm ci` passed, zero audit vulnerabilities, existing optional fsevents install-script notice; `npm test` **301/301 passed**, zero failures/skips; `npm run build` passed, app0.5.0 /18assets /worker **`091b1303c61d315d`**. No runtime/test/generated distribution changes. `git diff --check` passed. These fake/source/build checks do not pass live matrix rows.
