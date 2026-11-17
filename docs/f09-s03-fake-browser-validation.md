# F09-S03 strict-fake production-browser evidence — 2026-11-17

The root independently exercised the production build using Playwright Chromium build 1252, loopback preview and a strict in-page fake WebSocket with no network-socket fallback. All writes below are fake assertions; no hardware was connected, probed or actuated. This is desktop browser evidence, not Android/iOS, actual firmware, acoustic, installation, sleep or both-rig physical qualification. Local Node 26.13.1 built app0.5.0 with 18 locally bundled assets; CI targets Node 24.

## Control and geometry checks on worker `da7ea116dca37c35`

- Linked master: keydown produced zero writes; release produced exactly two approved master paths at 0.401. Without echoes, expiry retained requested cap 0.401 while actual received stayed 0.4. A new explicit gesture sent 0.402 without pressing Enable again.
- Relative group: explicit +0.1 then +0.1 gestures each produced four unique approved paths; between gestures the output showed requested cumulative +0.20 dB and input returned to local Δ 0. Keyed input/cap identity stayed stable and actual received values stayed unchanged. Requested offsets are not proof of actual balance/application.
- Eligible mono-source pan: keydown produced zero writes; release produced two approved pan paths at 0.251. No-echo expiry retained the requested position. A deliberate 0.5 preset sent two paths without re-enabling. Raw 0.5001 receipt disabled control, retained actual individual sides 0.5001/0.25 and showed inactive requested diagnostics. Complete compatible 0.25/0.25 receipts made explicit enable available; incoming state never armed/sent.
- 844×390 and844×300 landscape: group/source input travel remained 96 px and 93 px respectively, without overflow. 390×844 portrait: three columns measured 120.66 px each; expanded group had no pinned AUX master. Screenshot was captured in ignored `output/playwright/f09-s03-portrait.png`; it is supporting local material, not required by a fresh checkout.

## Terminal diagnostic correction and offline checks on worker `bc44e300e63dcaf5`

The first synthetic second-pan-send throw correctly stopped and cleared controls, but returned/authorized/unknown-delivery text existed only in a hidden footer after AUX selection cleared. Root found this presentation gap; the final fix includes the control diagnostic status in visible terminal feedback and the empty-state paragraph, with matching aria text. The terminal DOM regression now requires those details.

Retest: the second fake pan-send throw visibly displayed **Returned 1/2 authorized**, **throwing send delivery unknown**, **some values may have changed** and explicit reconnect guidance. Zero ranges remained enabled and attempts remained 2 after 2.7 s; no remainder/retry/rollback occurred. The earlier control/geometry semantics above were unchanged by this terminal rendering fix.

With browser network disabled, cold navigation to root, IEM alias, demo and connection-test entries displayed the expected distinct titles. Root/IEM/demo reported **Offline ready ·bc44e300e63dcaf5**; the connection-test reported **Saved for offline use** and the same offline version. Each cold entry created zero fake sockets. These current-entry checks complement inventory/import-graph fake tests; they do not certify a physical device's installation, local-network permission, suspension or offline/sleep behavior.

## Remaining gate

F09-S04 remains unstarted: the user now reports the desk powered on/reachable, not independently verified here. S03 acceptance/merge must precede a separately bounded live-check plan/authorization. Exact firmware echo/precision/observation completeness, native edits and partial-application recovery need that evidence; F08-S01 physical release qualification remains open. No GEQ/new writer or physical-support claim follows from this report. Root owns/cleans its fake browser and preview resources; the story agent created no hardware socket.

## Corrective-head smoke on worker `091b1303c61d315d`

After both P1 review fixes, root independently repeated group +0.1 then +0.1: each gesture produced four distinct approved paths, requested cumulative +0.20 dB/local input Δ 0 and stable input identity, while actual remained unchanged. After group disarm and fresh receipts for only both `i.0` paths, selecting individual `i.0` correctly left Enable disabled with complete-recovery guidance. The disjoint AUX master remained eligible. Fresh receipts for the remaining paired `i.1` paths made explicit individual Enable available; no recovery action sent a write (eight total from the two deliberate group gestures).

Cold network-disabled root/IEM/demo/connection-test launches again displayed their correct titles and current `091b1303c61d315d` offline-version proof, including connection-test saved-offline text; every entry created zero fake sockets. This is the final runtime-hash smoke. The broader layout/pan/terminal evidence above remains attributed to its earlier builds; no physical or real-firmware claim is added. Root closed its owned fake browser and preview after validation.
