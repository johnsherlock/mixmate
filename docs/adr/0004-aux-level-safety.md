# ADR-0004: Typed AUX level authority and conservative linked controls

Date: 2026-11-10
Status: Accepted implementation direction under the user's explicit F05 orchestration authorization and ADR-0002; S01 review/merge pending.

## Context

The F04 implementation checkpoint is merged at `de72fc7` in PR #22 after affirmative final-head review and passing CI. The user explicitly requested orchestration of every F05 story sequentially through PR and affirmative Codex review. Approved feature classes do not replace exact protocol/current-state evidence. Pinned library code establishes level paths and both stereo dimensions; firmware write behavior remains unqualified and no real-desk actuation is authorized during development.

## Decisions

1. Admit only typed AUX master `a.N.mix` and source `i/l/p/f.N.aux.A.value` level forms with finite numeric 0..1 values/profile bounds, documented in the [safety contract](../iem-aux-level-safety.md). No raw sender, input `.mix` fallback, pan/mute/pre/post/link/mode/configuration writer or generic library connection facade.
2. S01 provides pure target/serializer/lease/readback primitives without changing the production entry or `createReadOnlySession`. S02 must introduce a separate privately owned typed control capability, receive journal, actual dispatch/confirmation lifecycle and explicit user arming; no public copied Map or plan grants live authority. S03 owns relative group math and gestures. The app remains read-only at this S01 checkpoint.
3. Require current Ui24 model, known AUX mode for every destination, independently valid source/output link metadata and every target's actual level. Resolve source links × output links, deduplicate stable typed paths, never infer mono from absence or manufacture availability. FX returns are intrinsic stereo sources under the pinned profile, not adjacent FX pairs.
4. Individual linked controls require equal observed levels across their closure. Unequal readbacks remain visible and unavailable for actuation; never average or overwrite them to one value. This conservative choice can later be revisited with explicit offset semantics and reviewed tests/evidence. Mono/consistent closures can explicitly request normalized zero; zero is silence, not a mock floor.
5. Relative group finite-offset baselines cannot contain zero/nonfinite dB. S03 must use tested continuous conversion precision, one frozen baseline and one common clamped delta, deduplicating overlap; the pinned rounded 0.1 dB display converter is not an exact amplitude baseline. Do not adopt the library's artificial -100 dB silence substitution or clamp members independently.
6. Bind arming/opaque plans to privately owned socket generation, selection/topology/membership revision and actual level-change revision. Recheck before every ordinal; plans cannot be forged, skipped, replayed or queued behind a newer intent. Incoming data/restore cannot arm or send. Away-and-back native changes invalidate the baseline; identical receipts alone do not.
7. SETD dispatch is non-atomic and has no inspected transaction acknowledgement. Stop/disarm on any interruption/conflict/throw and never rollback/retry/replay the remainder. A send throw may leave delivery unknown; distinguish authorization, actual send-return count and observed state. Readback needs fresh per-path receipts matching all expected values. Partial expected echoes remain unconfirmed; an observed match is not a correlated acknowledgement or proof of causation. S02 owns bounded confirmation deadlines/status and catches reentrant/microtask/lifecycle races.
8. Keep current-firmware/native fan-out, readback precision/order and human actuation qualification parked in F08-S01. Tests use synthetic observations/fake dispatch; no desk access or support claims are inferred. Preserve offline bundle proofs, accepted layout and existing test/demo separation.

## Consequences

S02/S03 receive narrow shared building blocks without prematurely granting a writer to the read-only view. Some linked/relative controls remain unavailable for inconsistent or silent baselines rather than losing balance. The exact current runtime versus reviewed-but-unwired AUX forms are explicit in AGENTS.md. No repeated feature-class scope permission is required; evidence, typed integration and each story's CI/affirmative review remain mandatory.
