# ADR-0007: Retain the owned protocol adapter and helper-only dependency

Date: 2026-11-16
Status: Decision recorded for F09-S01; reviewed delivery/acceptance tracked by the containing story PR/history.

## Context

The [versioned native reference](../iem-native-protocol-reference.md) separates served 3.0.7865 trial/function evidence, unavailable full served source, reproducible official3.5.8328 archive and pinned community 7.1.0 implementation. One native paired-master move received no own target update through 38.883s; a read-only peer saw both changed values with shorter decimals. Native local-first state explains stable UI without establishing acknowledgement. Endpoint/session differences have no established causal relationship to missing echoes.

## Decision

Keep a small independently owned protocol/session adapter in `src/iem/`, with native code used as evidence only. Retain the existing community package for its current imported display helpers and attributed derived math/reference roles. This story changes no production imports, dependencies, serializers, allowlist, observer authority or 2.5-second confirmation policy. F09-S02 separately decides the pure state/uncertainty model; F09-S03 separately reviews integration for existing writers.

| Alternative | Assessment |
| --- | --- |
| Helper-only community retention + owned adapter | Selected. Preserves literal factory capabilities, private current-socket receipt provenance, typed guards and explicit-connect lifecycle. Allows independently reviewed state design without vendor/library state becoming received authority. Existing local bundle/attribution remains. |
| Community connection/control facade | Rejected for this scope. General store merges outgoing intent and incoming values; generic setters/defaults/retry behavior would require replacing authority/lifecycle semantics and still would not prove delivery. Root-endpoint use alone does not establish a fix. |
| Native bundle/internals as runtime dependency | Rejected. Global UI/storage/canvas/resource bootstrap, reconnect/reload and USERTIME/SERIAL/list requests exceed MixMate setup authority; setters update local state before send, with no established correlated ACK. Firmware/version coupling and unestablished reuse licence add cost without resolving uncertainty. Privately archived text is sufficient evidence. |
| Endpoint or Socket.IO replacement now | Deferred.3.5 archive shows HTTP-derived session ID; actual3.0 handshake remains uncaptured, and no controlled causal comparison exists. No guessed session ID, new handshake/getter or extra bootstrap is permitted. A future exact transport change needs its own evidence/typed-boundary review. |

## Consequences and acceptance limits

Independent ownership has maintenance cost: keep a versioned evidence index, bounded parsers and fake invariant tests, then qualify actual firmware separately. Do not silently copy native fan-out/defaults/error recovery, or infer server mirroring/precision from client code. Vendor artifacts stay ignored and excluded from production/offline assets; no vendor licence grant is inferred. The community MIT licence remains bundled.

The exact served full-source/hash gap is parked, not represented as completed corroboration. The orchestrator accepted a portable official-archive fallback for S01; the reference records reproducibility and unavailable facts. S02 can model uncertainty without resolving that gap, but choices relying on unverified field precision/session behavior remain blocked until evidenced. No source-backed or fake result passes F09-S04 firmware rows or F08-S01 physical release qualification. Existing ADR-0002/4/5/6 controls and restrictions remain in force until deliberately amended in reviewed integration.
