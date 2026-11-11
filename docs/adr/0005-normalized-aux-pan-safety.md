# ADR-0005: Normalized AUX send pan with qualified source scope

Date: 2026-11-11
Status: Accepted implementation direction under explicit user F06 orchestration/ADR-0002; S01 CI/review/merge pending.

## Context

F05 implementation is merged in PRs #23–25 and its closure PR #26/main `0d9b326`; physical qualification remains F08-S01. The user authorized sequential F06 delivery, each story with CI and affirmative exact-head Codex review before merge. Pinned pan implementation differs from level fan-out, and neither inspected primary docs nor upstream tests establishes physical numeric direction or stereo-source balance law. A single bounded passive native-client GET was unavailable; no actuator or additional probe is used.

## Decisions

1. F06-S01 adds only pure typed normalized AUX-send pan encoders/eligibility/leases. Main production pan remains unwired until separately reviewed S02 integration; existing level/group runtime, read-only capability and demo/test remain intact. No generic sender/raw socket or input/master pan fallback.
2. Admit only canonical `i.0..23`, `l.0..1`, `p.0..1` source sends on `aux.0..9.pan`, strict finite numeric 0..1 requests validated before the pinned setter's three-decimal normalization. Plan/command expected values equal actual rounded wire values. The narrow scope excludes FX, AUX-master and main/input `.pan` paths.
3. Require current Ui24 model, explicitly mono non-conflicting source metadata, reciprocal stereo AUX output metadata, both modes received AUX and both actual/equal pan observations. A pan observation establishes that send field without a fabricated default or unrelated level prerequisite. Mono destinations and missing/contradictory metadata stay unavailable.
4. Fan-out is the selected mono source on the two output sides only. Never copy the level source × output Cartesian expansion. Linked-source and intrinsic-stereo FX balance remain unavailable until their semantics are verified; normalized readbacks remain visible. Unequal linked output pans are not averaged or equalized to grant control.
5. Physical 0=Left/0.5=Centre/1=Right mapping is not established. S02 uses explicit normalized numeric labels/positions and numeric 0/0.5/1 presets only until primary evidence qualifies directions. Do not infer an acoustic pan law, midpoint neutrality or stereo balance from conventions, the mockup, or main-master wording. This is a qualified normalized-pan checkpoint, not complete stereo-balance support.
6. Pure pan leases bind owner-provided generation/context/actual-pan-change revision and per-path receipts. Revalidate owned current state before every single-use ordinal; actual away/back edits invalidate. Capture each path receipt cutpoint immediately before authorization. Expected partial echoes remain unconfirmed until all fresh paths match. Foreign/replayed/reordered/superseded/partial plans never resume.
7. S02 must privately integrate socket/journal ownership, mutually exclusive level/pan arming contexts, explicit release-only user intent, constructor/send/close/reentrancy handling, actual versus unknown partial delivery and timer/elapsed confirmation deadline. No automatic incoming/settings-triggered arm/write, optimistic received state, retry/rollback/replay, or correlated ACK claim. S01 has no transport/timers/UI writer.
8. Keep direction, linked-source/FX balance, native pan precision/law/mirroring and actual human actuation/mobile/offline/sleep checks parked in F08-S01. No repeat feature-class permission request, physical-support claim, security weakening or mixer/router configuration change.

## Evidence and consequences

The [exact contract](../iem-aux-pan-safety.md) records pinned source/test locations, maintainer/manual evidence and unavailable native observation. AGENTS.md distinguishes permitted pure serializer forms from still-unwired pan runtime. Narrow verified mono-source behavior can proceed sequentially while unsupported semantics remain explicit. EQ verification remains S03 and must use actual AUX output processing evidence rather than input PEQ assumptions.

## S02 runtime integration — 2026-11-11

S01 merged in PR #27 at `4857346` after affirmative final-head `4ddc5c3` review. S02 implements decision 7 through a new literal combined `createAuxControlSession`; the original read-only and level/group-only factories cannot be upgraded through options. One private union context owns level/group/pan permissions and operations. Exclusive dialog leases and separately scoped bank/modal gesture roots prevent stale owner or duplicate input handling. Numeric presets are deliberate opaque gestures with actual three-decimal wire expectations; raw per-output received precision remains separate. Legacy `disarmLevel`/`invalidateLevelContext` remain broad safety cancellation aliases; level begin/preview/commit/cancel methods reject a pan gesture. See the [runtime contract](../iem-pan-controls.md). This adds no direction/balance/EQ claim or real-device qualification.
