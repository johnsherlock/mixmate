# MixMate implementation backlog

Approved direction: 2026-11-08. The accepted responsive clickable prototype in `mockups/iem.html` is the product target. Delivery uses sequential features and stories, with explicit protocol verification and release-qualification gates. [ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md) records the user's 2026-11-09 authorization and qualification deferral.

## Feature order

| Feature | Outcome | Stories | Status |
| --- | --- | --- | --- |
| [F01](features/F01.md) | Offline distribution and device compatibility | 6 | Evidence checkpoint ready — qualification deferred/open in F08 |
| [F02](features/F02.md) | Device-local settings | 3 | In progress |
| [F03](features/F03.md) | Read-only live IEM view | 4 | Planned |
| [F04](features/F04.md) | Groups and navigation | 2 | Planned |
| [F05](features/F05.md) | Safe AUX level control | 3 | Planned |
| [F06](features/F06.md) | Pan and faithful AUX EQ | 4 | Planned |
| [F07](features/F07.md) | Snapshots, recording and native UI | 4 | Planned |
| [F08](features/F08.md) | Release validation | 2 | Planned |

## Orchestration contract

- The master chat selects the next eligible story and delegates to one story agent at a time, in sequence. Do not create sidebar chats unless the user asks for them.
- Work in this repository on `codex/` branches. Preserve pre-existing user changes, including the uncommitted integration handoff; do not stage it implicitly.
- Each story has a PR, passing tests/build and affirmative `@codex review` before merge. Fix review findings and repeat review as needed; no parallel story implementation or starting the next story while review is outstanding.
- Record completion in story, feature and backlog documents. When preparing a merge, status may say implementation complete / awaiting review; only report merged when GitHub confirms it.
- New findings may split a story or add a dependency; record the scope change. Under ADR-0002, park blocked hardware-dependent acceptance honestly and record a dependency exception before independent coding. Do not start parallel implementation or silently reduce support targets.
- Track real-device checks and unresolved decisions in [user-follow-up.md](user-follow-up.md). The user approved deferring remaining F01 qualification to F08-S01; implementation may continue while hardware stays unverified. Arrange later exact device checks without inferring passes.
- Planned AUX levels/groups, pan, output GEQ/shelf curve mapping, snapshot recall/save and recording start/stop are user-authorized in ADR-0002. Verify exact wire forms, types/ranges, stereo/current-socket prerequisites and typed guards, then deliberately update the active allowlist through the feature PR; no repeated permission request for these approved feature classes. Other operation classes remain outside scope. No real-desk actuation during development.

## Current work

F01 implementation/evidence scope is complete: PRs [#7](https://github.com/johnsherlock/mixmate/pull/7), [#8](https://github.com/johnsherlock/mixmate/pull/8), [#10](https://github.com/johnsherlock/mixmate/pull/10), [#11](https://github.com/johnsherlock/mixmate/pull/11), [#12](https://github.com/johnsherlock/mixmate/pull/12) and [#9](https://github.com/johnsherlock/mixmate/pull/9) merged after passing checks and affirmative Codex review. The S03 checkpoint merged at `b949430`, reviewed final head `bdf130b`. Physical Pixel/Android/iOS/offline qualification remains open in [F08-S01](stories/F08-S01.md); the tablet's targeted version/name pass does not qualify the full device workflow.

F02-S01 implements the versioned local settings repository and is awaiting its PR review/merge. S02 rig/preferences UI and legacy address migration must wait for that merge. Routine decisions and parked dependencies are in [the follow-up log](user-follow-up.md). Eight features contain 28 sequential stories.

## Evidence rules

Library/manual evidence describes candidate semantics; sanitized current-firmware observations validate receive paths. Physical-device checks establish install/offline/local-network behavior. Automated tests use fake mixers and cannot certify mobile support. Received desk state is transient and never a settings backup.
