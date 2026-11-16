# F08-S03 passive validation checkpoint — 2026-11-16

Baseline: reviewed `main` `820702013b76e969f32b3d381cb080f1f62b4ed1`, after offline investigation PR #31. The user separately authorized bounded passive observation of known `192.168.0.60` only, connection-only INIT/ALIVE/heartbeat and incoming state, with no parameter changes. No arming, fader/key/preset action, native control manipulation, scan, alternate address, configuration/security change or automatic reconnect occurred. Production source and confirmation contracts are unchanged. This supplies passive current-firmware evidence, **not post-write readback or full hardware acceptance**.

## Browser attempt and fallback provenance

Production build/preview `http://127.0.0.1:4173/`: app **0.5.0**, **18 assets**, worker **`f5c4f38ebcaec5d2`**. Fresh isolated headed Chromium showed `v0.5.0 · Offline ready · f5c4f38ebcaec5d2`, controller `http://127.0.0.1:4173/sw.js`, visible document and loopback `isSecureContext=true`. This is desktop current-entry evidence, not an offline cold-launch/mobile pass. Host: macOS **26.2 (25C56)**, Node **26.13.1** (CI Node24); browser UA **Chrome/157.0.0.0** with legacy Mac OS X 10_15_7 UA tokens. Cached Chromium for Testing was selected because default Google Chrome was unavailable; security was unchanged.

A bounded temporary WebSocket constructor/send wrapper forwarded production app sends unchanged, recording selected fields/events. One explicit manual-address app connection (no saved-rig binding) targeted `ws://192.168.0.60/`. Trace origin **17:51:20.655Z**, construction at monotonic **28528.700000047684ms**; error at **28539.899999976158ms** (~11.2ms later), readyState3, then close **28540.5ms**, code1006, empty reason, unclean. No open, incoming frames or outgoing messages occurred. Exact console: `WebSocket connection to 'ws://192.168.0.60/' failed: Error in connection establishment: net::ERR_ADDRESS_UNREACHABLE`. App showed error/state cleared/controls OFF. No visibility change. The planned eight-second observation elapsed after failure; a `require`-based export failed in CLI run-code, so evidence was recovered via evaluation. Disconnect was already disabled. Browser context closed and preview stopped; wrappers/listeners ceased. No browser retry/security weakening followed.

User confirmed address/current Mac network. Root separately observed an existing host route via en0 (not reachability proof) and made one bounded HTTP GET: **200 OK**, `Server: rkdmixer`, `Content-Type: text/html`, `Content-Length: 6521`. HTTP reachability does not explain Chromium's outcome; no local-network-permission cause is established. Root then explicitly authorized one Node read-only fallback under the original passive plan. No vendor app/scripts were executed and no native observer was available.

## Successful literal read-only session

Fallback uses existing `createReadOnlySession` from `src/iem/live-session.js` with native Node26 WebSocket supplied as a recording subclass. The factory exposes only connect/disconnect/snapshot/subscribe; it cannot arm or write parameters. The subclass forwarded factory sends unchanged and recorded bounded incoming selected fields/events, with no independent sender calls. One explicit connection at **2026-11-16T17:54:55.096Z**; all following times are milliseconds from harness start, distinct from the browser clock.

- Socket open **65.319ms**; INIT **65.391ms**. Model `ui24` and firmware **`3.0.7865-ui24`** first received **117.015ms**, repeated **211.964ms**.
- **513 incoming frames**, maximum **2,110 UTF-8 bytes**, maximum **98 lines**; last incoming **8021.596ms**. These measured maxima do not establish every possible INIT/firmware size. No socket error. Session `live`, `Received Ui24 AUX state · read-only`, readyState1, meters fresh immediately before explicit disconnect at **8052.101ms**.
- Explicit close **8060.222ms**, code1000, clean, empty reason. After cleanup **8356.149ms**: readyState3, disconnected and **zero retained observations**. No reconnect/retry/rollback/replay.
- **180 selected raw field records** retained, with no selected-field overflow. All selected fields were received twice with unchanged exact values during initialization; no relevant subsequent change was observed. Temporal proximity to INIT is not correlated request/response proof.
- Outbound record cap **100** filled with **1 INIT, 6 ALIVE, 93 `2::` heartbeats**; **24 additional outbound records were omitted**. All captured strings are connection-only. The trace therefore is **not a complete observed outbound inventory**; the no-parameter-send conclusion additionally relies on the literal factory source boundary and absence of any control API/calls in this harness. No unrecorded string contents are claimed. Frequent heartbeat traffic was not anticipated by the small cap. No repeat capture was performed to repair this limitation.

### AUX observations and timing

Wire indices are zero-based. Raw numeric lexemes below retain precision; `matrix=0` means AUX, `mute=0` is the received output mute field only, not proof of safe/effective audio conditions. Each cell includes first receipt time. All ten name fields were received; private labels are redacted here, retained only in ignored local evidence. No value is inferred from names, parity or profiles.

| Output | matrix | stereoIndex | mix | mute | name |
| --- | --- | --- | --- | --- | --- |
| `a.0` | `0` (181.300ms) | `0` (181.300ms) | `0.4162710754` (181.299ms) | `0` (181.300ms) | received; redacted (117.015ms) |
| `a.1` | `0` (178.009ms) | `1` (178.008ms) | `0.4162710754` (178.009ms) | `0` (178.009ms) | received; redacted (117.014ms) |
| `a.2` | `0` (180.156ms) | `0` (179.187ms) | `0.5317460317` (179.187ms) | `0` (179.187ms) | received; redacted (117.015ms) |
| `a.3` | `0` (176.957ms) | `1` (176.956ms) | `0.5317460317` (175.983ms) | `0` (175.983ms) | received; redacted (116.959ms) |
| `a.4` | `0` (178.008ms) | `0` (178.008ms) | `0.2555657139` (178.008ms) | `0` (178.008ms) | received; redacted (116.960ms) |
| `a.5` | `0` (174.612ms) | `1` (174.606ms) | `0.2555657139` (174.609ms) | `0` (174.609ms) | received; redacted (116.900ms) |
| `a.6` | `0` (175.983ms) | `0` (175.982ms) | `0.488804598` (175.819ms) | `0` (175.819ms) | received; redacted (116.959ms) |
| `a.7` | `0` (120.136ms) | `1` (120.137ms) | `0.488804598` (120.136ms) | `0` (120.137ms) | received; redacted (112.366ms) |
| `a.8` | `0` (121.273ms) | `0` (121.274ms) | `0.3643187971` (121.275ms) | `0` (121.275ms) | received; redacted (112.372ms) |
| `a.9` | `0` (184.801ms) | `1` (184.722ms) | `0.3643187971` (184.802ms) | `0` (184.802ms) | received; redacted (117.265ms) |

The received reciprocal non-overlapping metadata establishes **five AUX pairs**: `a.0/a.1`, `a.2/a.3`, `a.4/a.5`, `a.6/a.7`, `a.8/a.9`. All sides were AUX and each pair's actual master levels were exactly equal: respectively **0.4162710754**, **0.5317460317**, **0.2555657139**, **0.488804598**, **0.3643187971**. This corroborates the user's five logical mixes request for this captured rig; production still projects ten individual output cards. It does not qualify physical layout/touch or implement consolidation.

`i.0.stereoIndex=-1` first **128.105ms**; neighboring `i.1=-1`, no conflicting claim: source `i.0` resolves mono. `i.0.aux.0.pan=0` first **124.659ms**, `i.0.aux.1.pan=0` first **123.643ms**, repeated at **220.880ms**. Exact pan equality and verified reciprocal AUX destination qualify this normalized source/destination context passively. Other i.0 destination pan pairs were equal: a2/a3 **0.5**, a4/a5 **0.2626683819**, a6/a7 **0**, a8/a9 **0.5714285714**. No physical direction/balance meaning or setter rounding behavior was tested. Pan is not bundled into the proposed level experiment.

## Proposed smallest controlled-write experiment — NOT EXECUTED

Current observed candidate is AUX Outputs 1/2 (`a.0/a.1`), both actual **0.4162710754**, reciprocal stereoIndex0/1, AUX modes0. Only after the production browser connection works with normal security, separate explicit approval and confirmation of safe user-controlled audio/output conditions, select that master, explicitly Enable level, and use **one ArrowDown keydown/keyup** through the existing owned UI gesture. No raw sender or native control action. The range step is0.001: browser range presentation rounds baseline to0.416; existing gesture math `Math.round((0.416 - 0.001) / 0.001) * 0.001` produces **0.41500000000000004**. An isolated offline Chromium `about:blank` range check showed the range setter then sanitizes that computed preview to string `0.415`; `live-view.js` commits `Number(input.value)`, so the final value is **0.415**. The level serializer preserves that final numeric representation; it does not itself round. Local artifact: `output/playwright/f08-s03-range-precision.txt`. Proposed exact pair:

```text
3:::SETD^a.0.mix^0.415
3:::SETD^a.1.mix^0.415
```

This is a tiny downward change (~0.0012710754 normalized), never an increase from silence or equalization of unequal sides. Values are a proposal tied to the captured baseline, not authority for later execution. The Node fallback supplies receive evidence only; it does not fix or qualify browser control access and cannot be replaced by a generic/raw Node writer. Re-read current received values, topology and selected target immediately beforehand; abort rather than adapt if changed, unequal, unknown, conflicting, native/context change, close or ambiguity. Obtain user-approved safe audio conditions; output mute/meters do not establish them. No step occurs without separate explicit user authorization.

Capture exact outgoing strings/send returns and fresh per-path incoming values/times on the owner socket through **2.5 seconds**, plus status/pending/OFF, visibility and close/error events. Observe an already-open native client passively if available; never open/manipulate one that could emit unverified writes. Missing echoes cannot be repaired by sent intent or another socket. Multi-write is non-atomic; interruption stops/disarms without retry/rollback/replay or automatic reconnect. Leave and disclose any applied value. Explicit fresh reconnect is a separate user action/new state, not retrospective acknowledgement. No pan trial unless separately approved later. **Passive capture cannot prove post-write sender echo**, firmware mirroring or application of a requested value.

## Evidence, checks and parked acceptance

Ignored local artifacts in `output/playwright/`: `f08-s03-passive-2026-11-16.json`, `f08-s03-passive-immediate.txt`, `f08-s03-passive-context.txt`, and successful `f08-s03-node-passive-2026-11-16.json`. No raw mixer names are committed. Node harness and browser recording context were closed; no mixer connection remains. Root's HTTP text/header artifacts are `/tmp/mixmate-passive-native.html` and `/tmp/mixmate-passive-http-headers.txt`.

Local **256/256 tests** and unchanged **18-asset production build** pass on Node26.13.1; automated transports are fake and the own real diagnostic had closed before tests. No runtime/allowlist/confirmation change. Sender echo, exact post-write precision/mirroring, tablet save/Mac group context, physical compact usability, Android/iOS/offline/sleep and other F08-S01 matrix acceptance remain open. F08-S03 is not fully validated; F08-S01 remains the physical release gate; F06-S04 stays planned/unstarted. Further actuation requires explicit approval, not this checkpoint.
