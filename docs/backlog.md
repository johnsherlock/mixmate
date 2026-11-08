# MixMate implementation backlog

Approved direction: 2026-11-08. The accepted responsive clickable prototype in `mockups/iem.html` is the product target. Delivery uses sequential features and stories, with explicit protocol, device and write-permission gates.

## Feature order

| Feature | Outcome | Stories | Status |
| --- | --- | --- | --- |
| [F01](features/F01.md) | Offline distribution and device compatibility | 5 | In progress |
| [F02](features/F02.md) | Device-local settings | 3 | Planned |
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
- New findings may split a story or add a dependency; record the scope change. Browser/hardware blockers do not silently reduce support targets.
- Report real-device checks when needed with an exact procedure and fields to return. Keep the feature awaiting evidence until the user supplies results or approves a revised scope.
- Never broaden outbound permissions implicitly. Later permission stories require explicit approval of exact paths, validations and arming behavior before implementation.

## Current work

F01-S01, F01-S02 and F01-S02A merged in [PR #7](https://github.com/johnsherlock/mixmate/pull/7), [PR #8](https://github.com/johnsherlock/mixmate/pull/8) and [PR #10](https://github.com/johnsherlock/mixmate/pull/10) after passing CI and affirmative Codex review. [F01-S02B](stories/F01-S02B.md) fixes placeholder-only selector labels discovered after the user received mixer state. The installation/device context and offline conditions are not yet established. Device evidence stays in draft [PR #9](https://github.com/johnsherlock/mixmate/pull/9); F01-S03 depends on the corrective stories and remains awaiting hardware results. Eight features now contain 27 sequential stories.


## Evidence rules

Library/manual evidence describes candidate semantics; sanitized current-firmware observations validate receive paths. Physical-device checks establish install/offline/local-network behavior. Automated tests use fake mixers and cannot certify mobile support. Received desk state is transient and never a settings backup.
