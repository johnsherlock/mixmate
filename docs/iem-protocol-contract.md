# IEM receive protocol contract — F03-S01

Date: 2026-11-09. Status: source-backed receive schema implemented; current-firmware qualification parked. This contract adds no transport, UI wiring, parameter writer or outbound permission. The existing connection/input-fader experiment is unchanged.

## Evidence and provenance

1. Pinned `soundcraft-ui-connection` **7.1.0**, already installed and MIT-licensed. `package-lock.json` fixes its npm tarball integrity. Its `index.mjs` SHA-256 is `ff42aa71e8429b6fe8224656448124c00018bc3c510e0c8a790992b8ab83ff94`. Inspected bundled source regions retain their original TypeScript names: `state/state-selectors.ts`, `device-capabilities.ts`, `facade/channel-id.ts`, `channel.ts`, `send-channel.ts`, `aux-channel.ts`, `aux-bus.ts`, `master-bus.ts` and `utils.ts`. This is version-specific implementation evidence, not a vendor protocol guarantee. MixMate does not instantiate its connection/control facade or adopt its default values/reconnect behavior. No vendor assets were copied.
2. Library-maintainer documentation: [AUX sends](https://fmalcher.github.io/soundcraft-ui/buses/aux-sends), [master bus](https://fmalcher.github.io/soundcraft-ui/buses/master-bus), [matrix buses](https://fmalcher.github.io/soundcraft-ui/buses/matrix) and [stereo linking](https://fmalcher.github.io/soundcraft-ui/more/stereolink), checked 2026-11-09. These establish separate source and destination linking and the available facade categories.
3. [Soundcraft Ui24R manual](https://adn.harmanpro.com/product_documents/documents/5503_1492037684/ui24r_Manual_V1.0_Web_original.pdf), sections 4.3–4.3.1: AUX sources include input, line, player and FX returns; pre/post, per-AUX mute and stereo linking are separate concepts; a slot can be an AUX or matrix. The manual's AUX-master bus-count paragraph contains apparent legacy model/count errors, so it is not used to establish counts or wire paths. It describes user-facing semantics, not exact message schemas.
4. A bounded direct Node WebSocket attempt at the known `192.168.0.60` started **2026-11-09 08:38:43 UTC**, Node `v26.13.0`, macOS ARM64. It timed out after a nine-second observation without opening, receiving frames or sending any application frame. The only possible outbound literals were immutable INIT, ALIVE and heartbeat; there was no parameter sender, scan, retry or reconnect. Nothing was persisted from raw mixer state. Firmware/model identity and native-client source were not available in this attempt. Another rig address was not probed because no second-rig schema evidence was needed on this LAN.
5. [Earlier F01 observations](f01-device-evidence.md) established input-state/VU2 receipt on a different day but did not inspect these AUX fields. They are not retroactively treated as validation of the schema or current firmware. Desktop Node access would not qualify HTTPS/browser/mobile policy in any case.

The fixture at `tests/fixtures/iem-state.json` is hand-authored **synthetic** data using the source-backed wire forms. Names, levels, pans, mode and links are not copied from the desk or the accepted mockup. Its firmware label is explicitly synthetic. No real capture is checked into the repository. Current-firmware/read-only native-client confirmation remains an open follow-up, and unsupported fields stay unknown until received.

## Accepted receive fields

Wire framing is the small Socket.IO 0.9 text subset: `3:::` followed by `SETD^path^number` or `SETS^path^string`, optionally newline-batched. Split at the first two carets only; subsequent carets belong to a string value. `SETD` input is strictly decimal/scientific finite numeric syntax; booleans are received only as numeric zero/one. `SETS` names remain untrusted strings for a later renderer to assign via `textContent`.

All indices below are zero-based. Counts are library Ui24 **profile bounds**, not proof that every channel is available in the current configuration.

| Wire path | Wire type/domain | Normalized observation | Source evidence |
| --- | --- | --- | --- |
| `model`, `firmware` | SETS; known model `ui12`/`ui16`/`ui24`, bounded firmware string | device metadata; no fallback model | DeviceInfo selectors |
| `a.<0..9>.name` | SETS string, including received empty | AUX `name` | Channel raw-name selector |
| `a.<0..9>.mix` | SETD finite 0..1 | AUX `level` | master-bus Aux channel and selectFaderValue; Channel clamps to 0..1 |
| `a.<0..9>.pan` | SETD finite 0..1 | AUX `pan` | master-channel pan selector/setter |
| `a.<0..9>.mute` | SETD 0 or 1 | AUX `mute` boolean | Channel/selectMute |
| `a.<0..9>.stereoIndex` | SETD -1/0/1 | received mono / left / right metadata | selectStereoIndex/getLinkedChannelNumber |
| `a.<0..9>.matrix` | SETD 0 or 1 | received AUX/matrix mode, boolean | selectMatrix/AuxBus |
| `<source>.name` | SETS string, including received empty | source `name` | Channel raw-name selector |
| `<i/l/p source>.stereoIndex` | SETD -1/0/1 | source link metadata | selectStereoIndex supports i/l/p/a only |
| `<source>.aux.<0..9>.value` | SETD finite 0..1 | send `level` | selectFaderValue/SendChannel; send uses `.value`, **not input `.mix`** |
| `<source>.aux.<0..9>.pan` | SETD finite 0..1 | send `pan` | selectPan/AuxChannel |
| `<source>.aux.<0..9>.mute` | SETD 0 or 1 | send `mute` boolean | selectMute/Channel |
| `<source>.aux.<0..9>.post` | SETD 0 or 1 | send `post` boolean: false pre-fader / true post-fader | selectPost/SendChannel |
| `<source>.aux.<0..9>.postproc` | SETD 0 or 1 | send `postproc` boolean: false pre-processing / true post-processing | selectPostProc/AuxChannel |

Read acceptance is not write permission. In particular mute, pre/post, processing-tap and matrix/link changes have no write path here and are not newly authorized by this schema. No source input `.mix`, gain, routing, scene, EQ or recording path is accepted by this IEM parser. Model metadata for another model does not establish Ui24 support: the later live store must check the received model and actual field availability before claiming supported capabilities.

The parser preserves normalized 0..1 levels/pans; it does not invent dB, silence or effective audibility calculations. The mock's -60 dB floor, pan percentages and group meter values are not evidence. A send's own mute is separate from global input mute/inheritance; the schema does not claim the complete effective mute state or actual contribution meter.

## Sources and availability

| Source family | Profile bounds | Stereo representation |
| --- | --- | --- |
| `i` — input | 0..23 | received adjacent link metadata |
| `l` — line | 0..1 | received adjacent link metadata |
| `p` — player | 0..1 | received adjacent link metadata |
| `f` — FX return | 0..3 | each index is one intrinsic stereo return in the library profile, not a linked pair of FX indices |

`observedAuxSources` discovers source IDs only from accepted per-send fields actually present in the supplied current-session Map. It includes input, line, player and FX categories in stable family/index order. A name alone does not establish an AUX send; a profile maximum does not manufacture 32 available sources or the mock's 28. A partial send may have received mute/pan but no level; its level stays unknown. This is observation discovery, not a routing/capability or signal guarantee.

Do not force FX returns to supply nonexistent `f.N.stereoIndex`. `stereoRelationship` returns `intrinsic-stereo` with explicit `ui24-library-profile` provenance for an FX index; this does not imply that source was observed/available. Reject incoming `f.N.stereoIndex` rather than guessing adjacent FX pairings. Verify actual FX readback in the firmware qualification follow-up.

## Presence, modes and stereo relationships

`parseIemStateFrame` emits typed observations with their validated wire path, kind, normalized field/value and source/output identifiers. It emits only received fields, including repeated observations in wire order; it never adds defaults. A Map built from those observations uses `.has` to distinguish zero, false and empty names from absence. `receivedIemField` returns `{ received: false }` for missing data, or `{ received: true, value }` for an observation. No live state is saved in settings.

The pure helpers require a Map built only from accepted observations from **one current socket**. They do not own a transport or session. F03-S03 must create/clear that Map on explicit connect/disconnect/hide/navigation, reject old callbacks and distinguish socket open from received/partial AUX state. Never merge cached/previous-session state into the Map. This parser alone does not certify session freshness.

`receivedAuxMode` returns unknown until `.matrix` was received; false explicitly means AUX and true explicitly means matrix. Do not silently display matrix or unknown-mode slots as normal IEM AUX destinations. Matrix contribution paths are intentionally outside this story. Reciprocal output linking does not by itself establish that both slots are in AUX mode: the later view must inspect both received modes and preserve inconsistent readbacks rather than presenting a fabricated valid pair.

Source links and output links are resolved separately by ID family. A received -1 is mono only when no received neighbour claims it as linked. A left/right claim requires an in-range adjacent **same-family** partner with complementary received metadata. Missing partner metadata yields unknown; disagreement, edge overflow, overlapping outside-neighbour claims or a neighbour claiming a received-mono channel yields conflict. Both views of an otherwise reciprocal pair are marked conflicting when an outside member also claims it. No i/l/p families are joined, no source relationship stands in for an output relationship, and no fixed odd/even pair grouping is invented. Unequal linked levels remain separate received values; these helpers do not average, overwrite or collapse them. Later safe control must check both dimensions and all required readback explicitly.

## Administrative parser bounds

These are defensive implementation limits, not measured firmware maxima: 2 MiB UTF-8 per frame, 32,768 lines, 4,096 UTF-8 bytes per line, 1,024 UTF-8 bytes per name and 128 bytes per metadata string. Oversized frames/line counts are rejected as a whole; oversized or malformed individual records are ignored without truncation. Numeric lexemes are limited to 64 characters. Index grammar is canonical and profile-bounded. Unknown/prototype paths and unrelated message types are ignored. These limits must be checked against a future sanitized aggregate initialization observation; do not assume a timeout supplies such evidence.

## Parked evidence and next stories

- Current firmware/model identity, complete INIT field coverage and frame maxima, mode/link semantics and source availability need a bounded read-only observation when the known rig is reachable. Native-client code may be inspected in memory to corroborate paths/constants without copying assets. No real actuation is needed for passive initialization; testing changed-control behavior must remain fake during development.
- Actual normalized-to-dB/silence, linked pan/balance behavior, native-edit conflicts and later writer contracts remain with F05/F06. Source-backed candidates here are not a new active allowlist.
- VU2 decoding, block counts, tap points, numeric calibration and freshness are F03-S04; no meter decoder is added here.
- F03-S02 presentation/demo separation and F03-S03 receive-only transport/session store follow after this story merges. Mobile/local-network qualification remains with F08-S01 under ADR-0002.
