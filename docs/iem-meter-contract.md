# Read-only VU2 meters and freshness — F03-S04

Date: 2026-11-09. Baseline: F03-S03 PR #18 merged at `8c887a0` after green CI and affirmative Codex review of final head `25c880`. This is a source-backed read-only implementation checkpoint. No current-firmware meter packet was captured, no mixer retry/probe occurred in this story, and no write scope changes.

## Scoped plan and decisions

1. Verify the pinned library's exact binary decoder, family profile and scale; implement a separate bounded pure VU2 decoder. Do not reuse simulated meter values or instantiate a connection facade.
2. Keep meter packets in the current private socket session, independently from SETD/SETS state. Replace packet inventories, distinguish missing/fresh/stale and clear all samples/timers on lifecycle changes.
3. Render each observed source/output's own supported post-fader tap. Never turn packet counts into source availability, normal AUX modes or assumed stereo pairs. Preserve individual linked readbacks and intrinsic stereo FX.
4. Publish meter-only DOM updates at 100 ms cadence, with a publication revision that also prevents mixed state/VU bursts from bypassing the limit. Retain keyed strips, caps and bank scroll.
5. Use a 2-second meter TTL, independently of 15-second initial Ui24/AUX qualification and 30-second transport liveness. Check elapsed clocks before accepting late packets, sends and snapshots; never reconnect automatically.
6. Exercise synthetic source-backed packets/fake sockets, then isolated browser QA. Keep firmware calibration and physical Android/iOS qualification open in F08 and the follow-up log.

## Primary evidence

Pinned `soundcraft-ui-connection` **7.1.0** `index.mjs` is the implementation source. Its SHA-256 remains `ff42aa71e8429b6fe8224656448124c00018bc3c510e0c8a790992b8ab83ff94`; lockfile tarball integrity is unchanged. Relevant source regions: `vu/vu.utils.ts` (approximately lines 3128–3223), `vu/vu-processor.ts`, `device-capabilities.ts` and `utils/value-converters`. Installed `lib/vu/vu.types.d.ts` and `vu.utils.d.ts` name the fields and describe normalized-to-dB display conversion. The main stereo master processor reads two master entries; Ui24 capabilities bound inputs/line/player/FX/sub/AUX.

The pinned pure decoder is not exported publicly. Tests execute only that exact local function body in an isolated VM and compare every field against MixMate's decoder; no library transport/control facade is instantiated. The [maintainer repository](https://github.com/fmalcher/soundcraft-ui) provides provenance, not a vendor firmware guarantee. The [receive contract](iem-protocol-contract.md) retains the failed nine-second known-rig attempt and lack of a current capture. Do not treat prior uninspected VU2 receipt as validation of these offsets, header counts or calibration.

`tests/fixtures/iem-vu2.json` is explicitly **SYNTHETIC** from this source layout, not a desk capture or copied mockup levels. It has 306 bytes, full profile counts, deliberate unequal channels, encoded zero, raw 255 and opaque byte 7 equal to 197. There is no actual firmware label or invented live signal.

## Binary and framing contract

One logical VU record is `3:::VU2^<standard-base64>`. Ui24 model observation on the current socket is required; missing/unsupported models do not decode. Standard `atob` alphabet/ASCII whitespace and padded or unpadded encodings are accepted, within a 1,024-character record bound and maximum 408 encoded non-whitespace characters / 306 decoded bytes. URL-safe/invalid alphabets, invalid padding and decoder errors are rejected.

Try the complete VU frame first, allowing ASCII-whitespace-wrapped base64 without treating a first header fragment as a packet. Otherwise a bounded newline batch may contain syntactically separate protocol records. Non-record continuation fragments reject meter processing instead of refreshing from a valid-looking partial first line. SETD/SETS parsing remains independent; a malformed meter never becomes a parameter observation. Existing 2 MiB UTF-8 / 32,768-line administrative frame bounds apply before batch work.

The first seven unsigned header bytes are channel counts in the order below. Decoding starts at byte offset 8. Header byte 7 and the unread tail bytes within blocks are ignored by the library: no reserved-zero rule, clipping bit or gain-reduction meaning is inferred.

| Header index | Family | Ui24 count cap | Bytes/channel | Read offsets from block start |
| --- | --- | --- | --- | --- |
| 0 | `i` input | 24 | 6 | 0 `vuPre`, 1 `vuPost`, 2 `vuPostFader` |
| 1 | `p` player | 2 | 6 | 0 `vuPre`, 1 `vuPost`, 2 `vuPostFader` |
| 2 | `s` subgroup | 6 | 7 | 0/1 `vuPostL/R`, 2/3 `vuPostFaderL/R` |
| 3 | `f` FX return | 4 | 7 | 0/1 `vuPostL/R`, 2/3 `vuPostFaderL/R` |
| 4 | `a` output slot | 10 | 5 | 0 `vuPost`, 1 `vuPostFader` |
| 5 | `m` main master | 2 | 5 | 0 `vuPost`, 1 `vuPostFader` |
| 6 | `l` line | 2 | 6 | 0 `vuPre`, 1 `vuPost`, 2 `vuPostFader` |

Accept counts **up to** each verified profile cap rather than requiring a guessed full-inventory header. Partial families, including zero counts, are allowed; the exact length must equal `8 + Σ(count × stride)` before any value indexing. No trailers, truncation, overflow or unknown model profile is accepted. Empty valid inventories clear all entries instead of inheriting earlier samples. Non-Uint8Array/nonfinite numeric arrays are rejected; accepted unsigned bytes always produce finite scaled values.

Every decoded value is `rawByte × 0.004167508166392142`, exactly as the pinned library. Raw 255 therefore exceeds normalized one; keep that quantity intact. The display clamps fill position to 0..1 and uses the library's `vuValueToDB` (`round(80 × normalized − 80, 1)` clamped −80..0). This is the **library display scale**, not calibrated dBFS/SPL or a vendor meter-accuracy claim. Encoded zero displays `−80 dB floor`; it is a received floor code, not proof of physical silence and not missing data. No peak/clip hold or synthetic animation is added.

## Projection, tap points and availability

For observed input/line/player sends, display that source's `vuPostFader`; for intrinsic stereo FX, display `vuPostFaderL/R`. A single visible legend says **VU: post-fader · source VU is NOT AUX-send contribution · library scale; firmware unverified**. Per-strip captions use **Source VU** / **Source VU L/R** / **Output VU**, with full tap/provenance in accessible labels and tooltips. Fixed-height numeric/status rows prevent fresh/floor/stale text from changing fader travel; compact metadata is ellipsized rather than consuming the surface. These are source-global taps, independent of the selected AUX send's pre/post/mute/processing settings; a pre-fader audible send can have a low post-fader source meter. No effective AUX contribution or audibility is calculated.

Each observed output retains its individual `vuPostFader`, including unequal linked outputs. The packet array's `aux` name does not prove a slot is a normal AUX: only a received `.matrix === false` may show a normal AUX output meter. Unknown/matrix modes remain unavailable. Source link text still comes from reciprocal current metadata, with each input/line/player strip retaining its own single reading; FX's two sides are explicitly library-profile intrinsic stereo. Main/subgroup packet fields are decoded to keep offsets correct but do not create IEM strips. No group aggregate meter exists.

Meters are projected only onto parameter-observed strips; packet counts never create available sends/outputs or qualify initial AUX readiness. Source/output names, field presence, modes and link status remain independently received. Missing/expired meter readings never alter received level/pan values or turn them into mock defaults. `showMeters` hides fills and captions without saving any live sample. Captions/accessible labels identify library scale and unverified firmware; all strings remain text.

## Session freshness, clocks and cadence

Each valid packet replaces the session's entire meter Map and records monotonic (`performance.now`) plus wall (`Date.now`) receipt times. Snapshot Maps are copies; field records are immutable. Omitted/shortened packet families immediately become missing, never silently inherit freshness. Invalid packets leave the last valid receipt timestamp untouched. Samples become stale at **2,000 ms** using the larger nonnegative elapsed clock; stale values are not displayed. Snapshot age is computed on read, so a delayed timer cannot report an expired sample as fresh.

A pending **100 ms** flush coalesces bursts, retains the latest packet and increments a private publication revision. Existing fresh meter fills/text update only when that revision advances, including full renders caused by mixed SETD+VU frames. Newly discovered/navigated strips may initialize once; missing/stale transitions clear once immediately. Scheduled expiry updates only existing meter nodes. No strip/cap replacement, gesture preparation, bank reconstruction or scroll reset occurs on meter-only events. All pending flush/expiry work is cancelled and generation-guarded on disconnect, errors, hiding/navigation and new connections.

Socket liveness still follows inbound text/heartbeat traffic (30 seconds) rather than parameter changes. Heartbeats keep unchanged legitimate SET state alive; meter TTL is independent. The initial 15-second deadline still requires received Ui24 model and an actual normal-AUX level; meter counts alone cannot satisfy it.

Before late onopen/onmessage/keepalive, and before a snapshot can feed navigation/rendering, compare elapsed monotonic/wall clocks. A monotonic rollback/nonfinite clock, wall rollback beyond a **1,000 ms grace**, monotonic idle ≥30 seconds or wall idle >31 seconds clears/closes the old session. The analogous initial deadline uses 15 seconds monotonic / >16 seconds wall. Small backward wall/NTP skew within that grace does not disconnect; monotonic age still expires samples normally. A forward jump may expire meters early, conservatively. This also handles platforms whose monotonic clock pauses during sleep, including a first post-wake packet arriving before timer callbacks. No old state is revived and no reconnect is scheduled.

## Validation and outstanding evidence

Current implementation: `npm test` **126 passed**; `npm run build` **16 precached assets**, candidate worker **c16e200d043d0162**. Pure decoder, whole-packet replacement, malformed/oversize/partial/base64 cases, zero/raw255, all pinned field offsets, meter TTL, mixed-frame actual fill writes, immutable copies, stale generation callbacks, heartbeat-only parameter preservation, before-timer snapshots, clock jump/rollback and stable strip/input/cap/bank scroll are tested with synthetic fixtures and fake transports. Production graph/offline tests retain separate demo/live graphs and connection-only sends.

Root isolated Chromium QA used strict fake WebSockets and synthetic source-backed packets. Earlier `49ee…` checks established received source floor, unequal FX L/R/output values, three-column portrait, mode gating, preference hiding, shortened/empty packet omission, malformed-packet TTL expiry while heartbeat kept the socket/parameter readouts live, and literal-only outbound messages. Initial landscape QA found insufficient fader travel; compact readouts now use one visible legend, fixed status/pan rows, bounded two-line names and reduced gutter/padding.

Earlier `27b4ff8af2fd9d63` QA passed at 844×390: all seven source inputs are **96 px** high with a **29 px** cap / **67 px** travel, distinct cap positions, app height 390 px and no horizontal page overflow. Fresh→stale transitions retain exact input rectangles and input/cap/bank node identity; state readouts and a heartbeat-responsive socket stay live. The global source-not-AUX/provenance legend remains visible. An emulated hide during a pending 100 ms flush cleared/closed the session and stayed empty after returning/timer expiry, with no new socket. A browser-network-disabled cold query navigation loaded `iem.html` with verified worker `27b4ff8af2fd9d63`, zero strips and zero sockets. No parameter command was sent.

Desktop snapshots/screenshots are generated under ignored `output/playwright/` (including `iem-meters-geometry-final.png`). These are fake-transport desktop/emulated-visibility checks, not physical sleep, real mixer or Android/iOS evidence. These tests do not verify native cadence/header variants/calibration, current firmware, physical phones/tablets or actual AUX audibility. The known rig timed out earlier on 2026-11-09 with zero frames; it was not retried here. Passive firmware/native-client corroboration stays parked. F03 may close as a reviewed source-backed implementation checkpoint; full qualification remains open in F08-S01 under ADR-0002.

## Short-height correction before PR #19 merge

A final 844×300 check exposed clipping at the existing ultra-compact (<320px landscape) breakpoint. Live-only ultra-compact rules now visually clip read-only pan/mute metadata while retaining its full text for assistive technology, hide unavailable header/local-tab controls, slim header/navigation rows and bound names to one line. Mode links, Connect/disconnect, fullscreen, the local clock and source-not-AUX/provenance legend remain visible. The ordinary compact rules at 390px are unchanged. No transport, parser, persistence or meter timing behavior changes.

On candidate **c16e200d043d0162**, all 126 tests and the production build pass (16 assets). Fresh isolated strict-fake-socket Chromium QA at **844×300** measured every one of seven source inputs at **93px**, with **64px** cap travel. Each strip's clientHeight and scrollHeight both measured **171px**: no clipped meter/status rows. App height was 300px with no horizontal page overflow; the visible legend was 16px, all three mode links remained and fullscreen was 26px. Resizing the same final build to **844×390** retained 96px inputs, app height 390px and no overflow. Exact offline readiness verified `c16e200d043d0162`. Screenshot: ignored `output/playwright/iem-meters-ultra-final.png`. These are scoped desktop geometry/offline checks, not physical-device or firmware qualification. The prior affirmative review of head `109d805` does not approve this correction; PR #19 must receive affirmative review of the new head before merge.
