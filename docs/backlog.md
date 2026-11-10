# MixMate implementation backlog

Approved direction: 2026-11-08. The accepted responsive clickable prototype in `mockups/iem.html` is the product target. Delivery uses sequential features and stories, with explicit protocol verification and release-qualification gates. [ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md) records the user's 2026-11-09 authorization and qualification deferral.

## Feature order

| Feature | Outcome | Stories | Status |
| --- | --- | --- | --- |
| [F01](features/F01.md) | Offline distribution and device compatibility | 7 | Done implementation checkpoint — S04 PR #21 merged; physical qualification open in F08 |
| [F02](features/F02.md) | Device-local settings | 3 | Done — PRs #13–15 merged |
| [F03](features/F03.md) | Read-only live IEM view | 4 | Done implementation checkpoint — firmware/physical qualification open |
| [F04](features/F04.md) | Groups and navigation | 2 | Done implementation — PR #22 merge gate pending; physical qualification open in F08 |
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

F02-S01 merged the versioned repository in [PR #13](https://github.com/johnsherlock/mixmate/pull/13) at `6b2e859` after passing CI and affirmative Codex review. F02-S02 merged named local rigs/preferences and safe target migration in [PR #14](https://github.com/johnsherlock/mixmate/pull/14) at `c89a845` after passing CI and affirmative Codex review. F02-S03 merged local backup/import/reset and storage-protection status in [PR #15](https://github.com/johnsherlock/mixmate/pull/15) at `cd1bddc` after passing CI and affirmative Codex review. F02 implementation scope is complete. F03-S01 merged source-backed bounded receive schemas in [PR #16](https://github.com/johnsherlock/mixmate/pull/16) at `c721b9f`; its [contract](iem-protocol-contract.md) keeps current-firmware corroboration parked after the bounded timeout. F03-S02 merged the extracted presentation and separate demo/read-only entries in [PR #17](https://github.com/johnsherlock/mixmate/pull/17) at `9ce2647` after passing CI and affirmative Codex review. F03-S03 merged explicit current-socket read-only sessions in [PR #18](https://github.com/johnsherlock/mixmate/pull/18) at `8c887a0` after passing CI and affirmative final-head review. F03-S04 merged source-backed VU2 decoding, separate freshness and stable rendering in [PR #19](https://github.com/johnsherlock/mixmate/pull/19) at `14cf968` after green CI and affirmative review of final head `c3fb9c4`. F04-S01 merged the ordered local group editor in [PR #20](https://github.com/johnsherlock/mixmate/pull/20) at `61944be` after green CI and affirmative final-head review (`a5d3…`). F03 is an implementation checkpoint; with S04 reviewed and merged, independent F04 local groups/navigation may proceed sequentially under ADR-0002 and user autonomy. Firmware corroboration and physical qualification remain open in F08-S01 as release gates, not silently passed dependencies. The existing connection experiment and all active wire permissions remain unchanged. Routine decisions and parked dependencies are in [the follow-up log](user-follow-up.md). Eight features contain 29 sequential stories including priority F01-S04.

F04 implementation is accepted in PR #22 after affirmative Codex review of `5c036e2` ([receipt](https://github.com/johnsherlock/mixmate/pull/22#issuecomment-6755354185)); final documentation review/CI and merge confirmation remain pending. Physical F08 qualification is open. No next story starts until PR #22 is merged.

## Evidence rules

Library/manual evidence describes candidate semantics; sanitized current-firmware observations validate receive paths. Physical-device checks establish install/offline/local-network behavior. Automated tests use fake mixers and cannot certify mobile support. Received desk state is transient and never a settings backup.

## Priority dependency exception — 2026-11-10

[F01-S04](stories/F01-S04.md) / [ADR-0003](adr/0003-default-iem-entrypoint.md) corrects the root/PWA default entry before resuming F04-S02. The user's screenshot exposed a delivery gap: IEM existed separately, while the advertised root remained the test. Work is isolated from reviewed main `61944be`; unfinished group navigation is preserved at its separate local checkpoint `6a10e55` and is not included. F01-S04 subsequently merged in [PR #21](https://github.com/johnsherlock/mixmate/pull/21) at `96ee135` after 147 tests, a successful 17-asset build and affirmative Codex review of final head `9abaadc`. Its deployment succeeded with offline version `9a59683dde643264`. F04-S02 resumed/rebased as a separate story and is now done implementation in [PR #22](https://github.com/johnsherlock/mixmate/pull/22): group shortcuts/expanded banks and guarded local navigation passed 157 tests/build and [affirmative Codex review](https://github.com/johnsherlock/mixmate/pull/22#issuecomment-6755354185) of implementation head `5c036e2`. Its final documentation review/CI and merge gate remain pending; no merge is claimed before GitHub confirms it. Physical qualification stays open in F08-S01; the user cannot test it now.
