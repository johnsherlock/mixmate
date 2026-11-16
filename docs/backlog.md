# MixMate implementation backlog

Current plan: 2026-11-16. Nine features contain **37 stories**. The accepted `mockups/iem.html` remains the design reference; vanilla ES modules/Vite remain the architecture. The S01/S02 batch is complete; the handoff records its stop boundary. Backlog priority alone does not authorize execution.

## Feature status

| Feature | Outcome | Stories | Current status |
| --- | --- | --- | --- |
| [F01](features/F01.md) | Offline distribution and compatibility | 7 | Merged implementation checkpoint; physical F08 qualification open |
| [F02](features/F02.md) | Device-local settings | 4 | S01–S03 merged; new S04 planned |
| [F03](features/F03.md) | Read-only live IEM | 4 | Merged implementation checkpoint; firmware/physical qualification open |
| [F04](features/F04.md) | Groups and navigation | 4 | S01–S02 merged; new S03–S04 planned |
| [F05](features/F05.md) | Safe AUX level control | 3 | Merged implementation checkpoint; interoperability remediation in F09 |
| [F06](features/F06.md) | Pan and faithful AUX EQ | 4 | S01–S03 merged; pure GEQ unwired; S04 unstarted |
| [F07](features/F07.md) | Snapshots, recording and native UI | 4 | Planned |
| [F08](features/F08.md) | Release validation | 3 | S03 evidence checkpoint merged; unresolved findings assigned below; S01/S02 open |
| [F09](features/F09.md) | Reliable control transport and state | 4 | S01–S02 merged reference/design checkpoints; S03–S04 unstarted |

Feature numbers do not determine execution priority. Previously merged implementation remains merged; follow-up stories do not erase that history.

## Cross-feature execution priority

| Order | Story / gate | Dependency and purpose |
| --- | --- | --- |
| 1 | [F09-S01](stories/F09-S01.md) | [Reference/adapter decision](iem-native-protocol-reference.md) merged in PR #37; exact served-source gap parked |
| 2 | [F09-S02](stories/F09-S02.md) | [ADR-0008](adr/0008-control-state-model.md)/pure model merged in PR #38; unwired |
| 3 | [F09-S03](stories/F09-S03.md) | S02 → integrate existing level/group/pan model and coherent UI |
| 4 | [F09-S04](stories/F09-S04.md) | S03 → separately authorized targeted firmware validation; explicit applicable EQ readiness decision |
| 5 | [F04-S03](stories/F04-S03.md) | Passed and affirmatively reviewed/merged applicable foundation gate → logical stereo mix overview |
| 6 | [F04-S04](stories/F04-S04.md) | F04-S03 → compact accessible channel detail |
| 7 | [F02-S04](stories/F02-S04.md) | F04-S04 delivery order → discoverable saved-rig setup and persistence feedback |
| 8 | [F06-S04](stories/F06-S04.md) | F06-S03 + passed and affirmatively reviewed/merged applicable F09 readiness criteria → separately reviewed GEQ runtime/UI |
| 9 | [F07](features/F07.md) S01 → S02 → S03 → S04 | F06-S04 → exact snapshot contract, operations, recording, native access |
| 10 | [F08-S01](stories/F08-S01.md) | All release implementation → supported physical devices, both rigs, offline/sleep/control gate |
| 11 | [F08-S02](stories/F08-S02.md) | F08-S01 → release/recovery documentation |

This is the intended sequence, not a hardware waiver: if F09-S04 is blocked, park exact unrun rows; downstream work remains blocked until its applicable gate is met or an explicit reviewed dependency exception establishes that the proposed work is independent. ADR-0002 alone does not waive the F09 readiness gate. A checklist alone does not make F06-S04 eligible. F08-S03 is an evidence checkpoint with successors, not an indefinite catch-all dependency. Logical overview precedes compact detail so detail uses stable mix identity; saved-rig feedback then closes the remaining usability finding before EQ expansion.

## Current capability and evidence

The live IEM owns its WebSocket/session. `soundcraft-ui-connection` 7.1.0 currently supplies imported display converters; related meter/relative math and protocol references are distinct from instantiating its connection/control facade. [ADR-0007](adr/0007-owned-protocol-adapter.md) selects owned transport plus existing helper-only retention; the [versioned reference/manifest](iem-native-protocol-reference.md) indexes portable official source and explicitly parks unavailable served-source provenance. A library replacement is not an established remedy.

Reviewed runtime capability is AUX master/send levels, relative groups and eligible normalized mono-source pan into verified reciprocal stereo AUX pairs. Current confirmation requires fresh own per-path receipt within 2.5 seconds; intent/send return is not received state or a correlated ACK. Read-only factories remain connection-only. GEQ serializers/curve/leases are pure and **unwired**; shelves/filters are unverified. Snapshots/recording remain unwired. [AGENTS](../AGENTS.md) and linked contracts define authority.

Bounded trials on firmware `3.0.7865-ui24` applied changes without sender target echoes. The native paired-master trial likewise received no own target path for 38.883 seconds; a read-only peer received both approximately 11ms after dispatch at shorter decimal precision. Native source shows local-first state with no established correlated ACK callback. This is one firmware/operation observation, not proof of all fields, endpoints or causality. Last observed `a.0/a.1` values were `0.3961953345` each, left applied. No snapshot save/recall/delete occurred. Existing diagnostic authorization applies only within its recorded scope and bounds; this replan does not expand it. Record applicable prior permission and seek only missing scope.

## Verified delivery checkpoints

Last verified story baseline: `2e7edcba19e25d0d8b08e5f7825a33a7a0bc8231` on main; final handoff delivery is identified by its containing reviewed PR/history. Root verified these merged GitHub deliveries, final-change affirmative review and passing CI on 2026-11-16:

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

Earlier implementation receipts remain in individual stories and Git history (F01–F05; F06-S01/S02). Historical pending/stop wording in evidence reports describes those checkpoints, not current PR state. F08-S03 is not fully validated and no physical support pass follows from these merges.

## Orchestration and release gates

Follow [AGENTS](../AGENTS.md) and the canonical [orchestrator lifecycle](orchestration.md): one fresh-context Sol Medium story agent, sequential reviewed delivery, automatic progression within the recorded authorized batch and a verified repository handoff before stopping. The authorized F09-S01/S02 batch is complete. Stop after the reviewed handoff; F09-S03 is next intended work for a fresh orchestrator, excluded from this run. Preserve unrelated work, especially untracked `docs/iem-integration-handoff.md`.

[ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md) already authorizes the named feature classes; exact forms/types/ranges and deliberate reviewed typed-guard/allowlist changes remain mandatory. It does not authorize automatic real-desk tests. Snapshot SAVE was explicitly forbidden in recent live diagnostics; future F07 feature-class scope does not override that session restriction or create current hardware permission.

Library/native source evidence, fake tests, observed device/firmware trials and hypotheses must remain distinct. [F08-S01](stories/F08-S01.md) retains Android/iOS, installation/current-asset offline proof, local-network permissions, sleep/recovery, both rigs and all implemented controls as a physical release gate. Record unresolved findings and dependency exceptions in [follow-ups](user-follow-up.md). Start from the concise [handoff](orchestrator-handoff.md).
