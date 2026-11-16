# F08-S03 controlled master-level validation — 2026-11-16

Baseline: reviewed `main` `847b892b89a74d4c888505b76ab06c5fa50d7918` (passive checkpoint PR #32). The user subsequently explicitly authorized parameter-altering diagnostic commands, having saved the current snapshot, and expressly prohibited saving a snapshot. This supersedes the earlier passive-only stop **for this bounded test**. One existing armed UI ArrowDown release lowered the verified equal AUX 1/2 master pair from `0.4162710754` to `0.415`. No snapshot save/recall/delete, pan, EQ, source-send or other parameter action occurred. No production code, transport/confirmation contract, allowlist, network or security setting changed.

## Outcome

**Reproduced:** the sending socket received no updated target path in the recorded trial; MixMate returned the cap to its received position, entered PENDING, then disarmed as unconfirmed while staying live. **Separate fresh-state corroboration:** one explicitly authorized Disconnect/Connect received both master paths at exact `0.415`. These new-session observations corroborate application; they are not correlated acknowledgements or confirmation of the old operation. This is one build/browser/firmware trial, not a universal sender-echo rule or a proof of firmware fan-out. Both paths were explicitly sent.

The tiny reduction, `0.0012710754` normalized on each side, remains applied. No rollback, retry, replay or second gesture occurred. Final diagnostic socket closed cleanly; browser left idle, controls OFF and received state cleared. The saved snapshot was untouched. F08-S03 still needs a reviewed readback design and other finding/device evidence; F08-S01 remains the physical release gate and F06-S04 remains planned/unstarted.

## Browser and recording provenance

- Working **native Brave Browser**, macOS host; reported UA `Chrome/156.0.0.0`, legacy `Mac OS X 10_15_7` tokens. Those tokens do not identify the actual host OS version. Existing Lenovo M9 device emulation (1340×800) and docked DevTools were preserved; this is desktop emulation, not a physical tablet pass.
- User's already-live tab: production preview `http://127.0.0.1:4173/`, app **0.5.0**, offline-ready asset version **`f5c4f38ebcaec5d2`**. Final clean-page inspection: visible document, secure context, controller `http://127.0.0.1:4173/sw.js`. This does not establish offline cold-launch/mobile/sleep support. Earlier isolated Chromium `ERR_ADDRESS_UNREACHABLE` remains unexplained; working Brave does not establish its cause.
- Native CUA only for browser interaction. No remote-debugging/security workaround. Initial hidden Console drawer clicks did not execute code; after opening the visible Console, `typeof __mmDiag` was verified undefined before installation. One CUA concurrent-user-change warning occurred during passive setup, before recorder installation, reconnect, arming or writes; context was rechecked. No further such warning occurred during the trial.
- Temporary `WebSocket.prototype.send` wrapper forwarded every production send unchanged, attaching passive incoming/close/error listeners on the first send from each socket. It never called `send` independently. Nonconnection outgoing strings and send-return/throw events were recorded individually; INIT/ALIVE/`2::` were counted without filling the event cap. Selected incoming fields only: model, firmware and `a.0/a.1` mix/matrix/stereoIndex/mute. No mixer names were retained in this report.
- Recorder origin **2026-11-16T18:21:13.048Z**, monotonic **241063.39999997616ms**. All times below are that page's `performance.now()` clock, **not milliseconds from recorder start**. Socket1 was the user's initial connection; socket2 was the deliberate fresh owner baseline and trial; socket3 was the separately authorized post-trial observation. All targeted `ws://192.168.0.60/`. Socket identity comes from the wrapped socket object, not URL matching.
- Event cap 1000, **overflow 0** at final export. Final aggregate counters: **2 INIT, 277 ALIVE, 4108 heartbeat, 2 other outbound, 12659 incoming frames** across the attached sockets; counters include setup traffic. The two other outbound payloads are the exact level commands below. Incoming capture ignored nontext/over-131072-character frames and inspected at most 2048 lines per text frame; skipped-frame/line counts and complete raw frames were not recorded. The result is a bounded selected-field trace, not a complete wire dump. Production's own received state also stayed unchanged on socket2.

## Owner baseline, deliberate release and deadline

Socket1 closed explicitly at **249481.89999997616**, code 1000, clean, empty reason. Socket2 INIT **258340.29999995232**; first model `ui24`/firmware `3.0.7865-ui24` **258396.29999995232**. First baseline receipts:

| Path | Raw value | Receipt time (ms) |
| --- | --- | --- |
| `a.1.mix` | `0.4162710754` | 258513.19999992847 |
| `a.1.stereoIndex` / `matrix` / `mute` | `1` / `0` / `0` | 258513.19999992847 |
| `a.0.mix` | `0.4162710754` | 258517.60000002384 |
| `a.0.stereoIndex` / `matrix` / `mute` | `0` / `0` / `0` | 258517.69999992847 |

Fields repeated unchanged at **258626.19999992847** (a1) and **258629.19999992847** (a0). Received reciprocal metadata and AUX modes established the pair; names/parity/profile did not grant authority. Mute 0 does not establish acoustic safety. No independent native-client observation or acoustic measurement was available.

With controls OFF, selected AUX1 through its master name, explicitly enabled that level, then traversed 65 Tab steps from the first source name to the sole enabled master range. Focus was observed explicitly as the AUX1 master range at `0.416`; no cap/track pointer action or programmatic control/session commit was used. One native Down press/release followed. Passive document key listeners observed trusted keydown **424243.89999997616** with preview string `0.415`, then keyup capture **424244.1999999285** with the same string before the production release handler committed. This confirms actual browser range sanitization for this gesture; no synthetic keyboard event was used.

| Event on socket2 | Monotonic time (ms) |
| --- | --- |
| `3:::SETD^a.0.mix^0.415` outgoing; native send returned | 424244.5 |
| `3:::SETD^a.1.mix^0.415` outgoing; native send returned | 424244.5 |
| UI: “Waiting for fresh level readback; delivery is not confirmed.” | 424250.6999999285 |
| UI: “Level readback unconfirmed; controls off. No retry.” | 426752.7999999523 |
| Explicit socket2 close, code 1000, clean, empty reason | 501981.7999999523 |

Both writes and returns shared the recorded clock resolution; the wrapper records their ordered invocation/return, not simultaneous hardware application. No send throw occurred. Private authorization instants were not directly instrumented; source establishes synchronous authorization/send ownership and the observed keyup/outgoing interval brackets release dispatch. No selected incoming field arrived after release on socket2, including through the full 2.5-second window and later until its explicit close (~77.7s after outgoing). No error, unintended close or visibility event was recorded around the trial. Other traffic continued and the UI showed “Ui24 model received · live”. Last received owner mix values remained `0.4162710754`; outgoing intent did not replace them. The immediately returning cap and repeated Enable requirement are reproduced, but pan/apparent pan disconnect were not retested.

## Separately authorized fresh state and cleanup

After recording the old unconfirmed result, root authorized exactly one explicit UI Disconnect/Connect with controls OFF as a separate diagnostic. Socket3 INIT **508739.60000002384**; model/firmware **508795.7999999523**.

| Path | Raw value | First new-session receipt (ms) | Repeated receipt (ms) |
| --- | --- | --- | --- |
| `a.1.mix` | `0.415` | 508939.10000002384 | 509067.6999999285 |
| `a.1.stereoIndex` / `matrix` / `mute` | `1` / `0` / `0` | 508939.10000002384 | 509067.6999999285 |
| `a.0.mix` | `0.415` | 508943.39999997616 | 509071.5 |
| `a.0.stereoIndex` / `matrix` / `mute` | `0` / `0` / `0` | 508943.39999997616 | 509071.5 |

Socket3 closed by explicit Disconnect **534929.7999999523**, code 1000, clean, empty reason. UI showed disconnected/received state cleared/controls OFF. Restored original `WebSocket.prototype.send`, removed mutation/visibility/key listeners, then explicitly reloaded the already-disconnected page to discard closed-socket listeners and all diagnostic state. Final Console verified `typeof __mmDiag === 'undefined'`; page remained idle with Disconnect disabled and no automatic reconnect. No cleanup error was observed. Existing emulation/DevTools and unrelated tabs were preserved.

## Interpretation and remaining work

This targeted trial independently corroborates the historical no-sender-readback symptom on firmware 3.0.7865-ui24. It supports the existing proposal for honest pending/unconfirmed presentation and a reviewed user-driven reconciliation design. It does not authorize silently counting fresh-socket state as old confirmation, optimistic received values, epsilon changes, automatic INIT/reconnect, extra observer sockets or new commands. Exact `.415` new-state precision supplies one measured point only. No runtime remediation is included.

Pan precision/echo, automatic linking behavior, independent native/client observations, group saving on actual tablet/Mac, compact/five-card physical usability, both rigs and Android/iOS/offline/sleep acceptance remain open. No next implementation story starts automatically.

Validation after all own hardware sessions closed: `npm test` **256/256 pass**, `npm run build` pass, unchanged app 0.5.0/**18 assets**/worker `f5c4f38ebcaec5d2`, local **Node 26.13.1** (CI uses Node 24); `git diff --check` pass. No new test/runtime code or generated distribution edits. CI and affirmative final-head review/merge remain the master orchestrator's gate.

Ignored local artifact: `output/playwright/f08-s03-controlled-level-2026-11-16.json`, an explicitly labelled selected-event excerpt transcribed from the actual native DevTools Console exports in this chat, including exact ordered writes/returns, first baseline/fresh receipts, deadline UI, closes and final counters. It is not a saved full trace; repeated fields/unrelated UI and private key labels are omitted. No additional connection or instrumentation was performed to produce it. The unchanged baseline persisted while selecting/arming/traversing; no other native target/topology change was observed in the recorded fields.
