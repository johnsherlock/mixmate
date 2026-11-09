# ADR-0002: Defer device qualification and authorize planned controls

Date: 2026-11-09
Status: Accepted by user in the master chat; documentation checkpoint merged in PR #9 at b949430 after passing CI and affirmative Codex review.
Supersedes: ADR-0001's early mobile-qualification development gate and repeated feature-class permission gates. The remaining architecture and safety constraints remain in force.

## Context and user decisions

The user asked to move on from the unresolved Pixel installation issue and subsequently authorized the planned write features and mapping the requested EQ curve onto actual AUX-master graphic EQ, including user-reported low/high shelves. The user also asked the master to work as far as possible autonomously: make and record routine decisions, or park a blocked item and continue independent work. These are implementation-scope decisions, not reports that hardware tests passed or permission to actuate the live desk during development.

## Development and release gates

1. F01-S03 may close as an evidence-baseline/implementation checkpoint once its PR passes tests/build and affirmative Codex review. F02 may start after that merge. Pixel installation, incomplete mobile/offline checks and unavailable Safari devices no longer block all implementation.
2. Full device qualification remains open and moves explicitly to [F08-S01](../stories/F08-S01.md), carrying the [exact checklist](../device-checks.md) and [existing observations](../f01-device-evidence.md). No platform support, cold-offline pass or complete IEM suitability is inferred from this re-scope.
3. Implement stories sequentially, each through its own PR and affirmative Codex review before merge. Do not begin another implementation story while its current story PR is awaiting review. If a story is blocked by hardware evidence, record a parked status and the missing acceptance, then choose a genuinely independent story; document the dependency exception instead of pretending the blocked story is complete. Do not run story implementation in parallel.
4. Make and record routine implementation/product choices within accepted scope. Keep a consolidated [follow-up log](../user-follow-up.md). New operation classes, material representation changes outside the agreed EQ mapping, destructive behavior or unresolved safety assumptions remain explicit decisions for the user; do not interrupt for already-approved scope.

## Approved future feature classes

The user authorizes implementation of:

- AUX-master and per-source AUX-send levels, including balance-preserving relative group moves.
- AUX pan/balance with verified mono/stereo behavior.
- AUX output EQ: map the requested point/drawn curve onto actual supported graphic-EQ bands and supported low/high shelves.
- Later snapshot listing/recall/save and multitrack recording status/start/stop, with deliberate user actions and the confirmation/readback semantics defined in their stories.

Snapshot recall/save is a deliberate, limited exception to the prior blanket scene-change prohibition. Recall may apply the chosen snapshot's stored settings; it does not authorize arbitrary gain, mute, routing, clock, network or other configuration write paths, general scene editing/deletion, or destructive configuration changes. Existing prohibitions remain except for the named snapshot operation itself.

## Active wire allowlist and verification gate

This approval does not invent protocol paths or immediately enable any new command. At this checkpoint the implemented outbound allowlist remains exactly `3:::INIT`, `3:::ALIVE`, `2::`, and validated `3:::SETD^i.<0..23>.mix^<0..1>` for the existing explicitly armed input-fader test. The read-only IEM milestone exposes only the three connection messages and cannot call the input writer.

Each implementing feature must document evidence-backed exact paths/message forms, types, ranges, source/output limits, capabilities, both stereo dimensions and current-socket prerequisites. Extend AGENTS.md's active allowlist and narrow typed guards deliberately in that feature's reviewed PR. No generic parameter sender, guessed fallback, AUX-to-input `.mix` substitution, queue, retry, replay or incoming-state-triggered writes. Feature-class permission is already granted; do not ask for the same permission again merely to implement verified details within it. Unknown/unsupported semantics stay unavailable or parked until resolved.

Controls start disarmed, require deliberate user action for the selected target, and disarm/cancel on selection, disconnect, hiding and navigation. Define per-operation confirmation and actual readback; unknown/partial failure is not success. Non-atomic multi-write operations never resume after interruption. Relative group moves use one gesture baseline and clamp the entire move at the first member limit; do not independently clamp members and lose balance. Native changes invalidate/reconcile baselines according to the documented contract.

No real-desk actuation is authorized during development or automated verification. All automated write tests use fake mixer transports. Read-only observations may use only the active connection-message allowlist after a user-authorized connect; no background scan or reconnect. Later human live-actuation qualification must be explicitly arranged as a separate device check.

## EQ representation

The intended graph is a requested response curve, not a claim that the hardware has the mockup's three parametric filters. Evaluate/map the requested curve at verified hardware band centres using verified gain limits and supported low/high-shelf controls. The shelf capability is user-reported; exact paths, ranges, ordering and behavior remain unverified. Do not infer shelf or cut paths from the mockup or reuse input EQ paths.

Keep point/drawn modes mutually exclusive and preserve the accepted touch/layout experience. Document approximation and representational limits; do not claim an exact hardware curve where it cannot be realized. Actual band/shelf readback is authoritative after native edits. Preserve unrelated processing, handle both linked AUX sides from received metadata, and do not overwrite a stale baseline. Reset is limited to the explicitly supported selected output-EQ scope. If a requested function cannot be represented with the verified hardware, record the limitation and park it or bring a material product tradeoff to the user; do not add phantom DSP.

## Consequences

Development can advance through settings, read-only state and already-authorized control features while hardware questions remain visible. Release qualification still requires actual Android Chrome, iPhone Safari and iPad Safari evidence or a separately recorded support-scope decision. The Pixel and shared-origin/cache issues stay open; no silent hosting, browser-security or mixer/router configuration changes are authorized. Current protocol guards do not broaden until their corresponding verified implementation PRs.
