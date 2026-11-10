# AUX level safety contract — F05-S01

Date: 2026-11-10. Implementation scope authorized in ADR-0002; scoped plan accepted by the master under the user's explicit F05 orchestration instruction. This story provides pure serializers, target validation and an arming lease, not a socket, control session or UI actuation. The existing read-only session and production entry retain their connection-only capability. Physical qualification remains open in F08-S01; no real desk access or actuation is used.

## Scoped plan before implementation

Create `src/iem/aux-level-protocol.js` for bounded typed master/send encoders and received target expansion, `src/iem/aux-level-safety.js` for a no-transport current-context lease/readback helper, fake-only boundary tests, ADR-0004 and this contract. Update AGENTS.md deliberately to permit only these exact level forms through a future privately owned typed control session. Keep the deployed app read-only in S01; S02 owns private transport integration/arming UI and S03 owns group math/gestures. No pan/mute/pre/post/link/matrix/gain/EQ/configuration writer or input-fader fallback.

Routine choices: reject unequal linked individual target levels instead of equalizing/averaging them; finite relative group offsets are unavailable for zero/nonfinite dB baselines. Current-firmware automatic fan-out and echo behavior are unqualified. No protocol guess or native client asset copy fills that gap.

## Evidence and exact forms

Pinned MIT `soundcraft-ui-connection` 7.1.0 `index.mjs`, SHA256 `ff42aa71e8429b6fe8224656448124c00018bc3c510e0c8a790992b8ab83ff94`, is version-specific implementation evidence (package-lock integrity retained), not a vendor protocol guarantee. Inspected 2026-11-10:

- `Channel` lines 1989–2012: fader command `mix`, setter bounded 0..1, linked paths emitted individually; `SendChannel` 2041 changes command to `value` and uses source/bus identifier; `AuxChannel` 2059–2070 builds source-link × output-link targets. `MasterChannel` 2530–2540 keeps `mix` and mirrors its linked output.
- Identifier functions `er/tr` at 1921–1926 convert facade one-based numbers to canonical zero-based wire indices. Numeric setter 3082 emits `SETD^path^value`; connection text framing uses `3:::`. The existing connection test and receive parser independently establish that framing. The library's generic sender/reconnection/default values are not adopted.
- Ui24 profile bounds: 10 AUX slots; input 24, line 2, player 2, FX 4. Bounds do not establish availability. Selector `B` at 1750–1759 supports received links for i/l/p/a only; each FX return is one intrinsic stereo source. Existing receive contract checks reciprocal/overlapping links without parity assumptions.
- Converter `q` at 1869 displays rounded 0.1 dB and returns negative infinity below its amplitude threshold; normalized zero is silence. `K` at 1859 maps dB <= -200 to zero and >= +10 to one, using a numerical inverse in between. A rounded display conversion is not an exact amplitude baseline. The library's relative helper substitutes -100 for silence: MixMate deliberately does not adopt that fabricated finite baseline. S03 must choose/test continuous conversion precision and whole-group limits separately.

Maintainer primary documentation checked 2026-11-10: [AUX sends](https://fmalcher.github.io/soundcraft-ui/buses/aux-sends), [master bus](https://fmalcher.github.io/soundcraft-ui/buses/master-bus), [stereo link](https://fmalcher.github.io/soundcraft-ui/more/stereolink). These corroborate source families, AUX/matrix distinction and both link dimensions. [Soundcraft Ui24R manual](https://adn.harmanpro.com/product_documents/documents/5503_1492037684/ui24r_Manual_V1.0_Web_original.pdf) sections 4.3–4.3.1, previously inspected for the receive contract, describes AUX sources/modes/linking rather than exact wire paths. No mock value/path is evidence.

| Operation | Only permitted generated form | Type/domain |
| --- | --- | --- |
| AUX output master level | `3:::SETD^a.<0..9>.mix^<value>` | JavaScript finite number 0..1 inclusive |
| Per-source AUX-send level | `3:::SETD^<family>.<index>.aux.<0..9>.value^<value>` | family/index: i.0..23, l.0..1, p.0..1, f.0..3; same numeric domain |

No raw path/message argument. Reject strings, booleans, null, NaN/infinities, out-of-bounds/noncanonical IDs and extra descriptor fields. Values serialize as their finite numeric representation (negative zero normalized to zero); do not clamp invalid input or turn it into an input `.mix` write. Pan and other receive fields remain read-only.

## Required current-socket target closure

The future private writer owns validated observations from one actual open socket. A copied/public Map, profile/setting or caller-supplied plan never establishes live authority. Require received `model=ui24`; output mode false/AUX for every destination; explicit valid mono or reciprocal same-family output links with no overlap; received finite 0..1 level for every addressed path. For sends also require valid source mono/reciprocal i/l/p links, or profile-backed intrinsic-stereo FX. Source links and AUX links are resolved separately; take their Cartesian product, stable order, and deduplicate exact typed paths. A linked pair can start at an unusual index; no odd/even assumption. Missing, partial, unsupported, conflicting, matrix or unequal linked levels makes that individual operation unavailable.

For master closure, only output master levels are required; no source metadata is relevant. For send closure, input `.mix` is irrelevant and never read as a substitute. Every member send level and both output modes/link relationships must be observed. Names, meters, mute/pre/post state and profile counts cannot establish a missing level. Source/global mute and actual signal contribution are not inferred.

An individual absolute level action applies one value to a mono target or an equal-level linked closure. Unequal linked targets remain separate readable values but cannot be controlled in this milestone; no averaging or independent clamping. Normalized zero is an explicit individual level request, not unknown and not a -60/-100 dB floor.

## Lease, arming and dispatch contract

`createAuxLevelGuard` has no transport. It reads an owner-supplied closed-over current context on every operation; methods do not accept a replacement context/Map. The future S02 private control-session factory must own this callback, the socket, receive journal and generation. No public raw socket/sender or public setter can replace the authoritative state.

Context requires an integer generation, context revision (selection/local-membership/mode/link changes), actual level-change revision and per-path receipt sequence Map, plus `open === true`, `visible === true` and validated observations. Actual changes increment the level revision even if a path changes away and back between calls. Repeated identical receipts advance receipt sequence but alone do not invalidate a level baseline. Meter/name-only updates need not invalidate. Selection/profile/target/group membership changes, disconnect, error, timeout, hide, navigation and socket replacement cancel/disarm. Settings/view restoration never calls arm.

Explicit arm resolves/captures a target closure and lease. Preparing one finite normalized value revalidates model, modes, links, all levels and lease revisions. Plans are immutable, opaque identities local to that guard; foreign/cloned/forged plans fail. Authorize ordinals exactly once in order, revalidating the owned context immediately before each authorization; no batching escape, replay or skipping. It only returns one narrow typed message for a later private writer to send synchronously. The guard does not send. A changed baseline/context invalidates the entire lease. No action is triggered by receiving observations.

Future S02 integration must synchronously send immediately after authorization on that same owned open socket, rechecking socket/generation after any user callback; catch constructor/send/close failures. If any send throws, readiness changes, or an observation changes the baseline during dispatch, stop and disarm; never send remaining commands, retry, rollback, reconnect or resume. Record authorized versus actually dispatched counts honestly: authorization itself does not prove send or application. A partial multi-target action is non-atomic and may leave unequal desk state; render actual subsequent readback and require explicit fresh selection/arming before another action. The pure lease cannot certify socket ownership or actual delivery on its own.

## Readback and interruption

Wire SETD has no transaction ID or operation acknowledgement in the inspected implementation. A socket send returning is not success. Readback requires an observation for **every** target after the captured receipt sequence and exact requested normalized values, with compatible current context. Matching fresh values mean observed match, not proof that MixMate caused them. Missing/old/equal pre-send state is unconfirmed; any fresh different value is conflict. Future S02 owns a bounded confirmation deadline and visible pending/unconfirmed/conflict status, not optimistic received-state replacement. No timer/network is added here. Late receipt after invalidation cannot rearm, replay or complete an old session's action.

## Relative groups — contract for S03, not implementation here

Expand each saved stable source through the same source/output closure; retain unresolved members and block the move if any required member is unknown/conflicting/unequal. Deduplicate overlaps before calculating or sending; one physical path receives one command. Freeze a single authoritative finite dB baseline per path for the gesture. Any external actual level change or topology/membership/context revision invalidates that baseline, even if a value returns later; do not absorb it into a new baseline mid-gesture. Only explicitly correlated expected readback can be reconciled by the later private owner, acknowledging there is no protocol transaction ID.

Zero/negative-infinite baseline prevents a finite relative move; a group with silence remains unavailable until resolved by individual controls. No invented finite silence floor. Calculate one delta and clamp it at the first member's common lower/upper limit before conversion; never independently clamp/round members to disguise lost balance. Document precision/round-trip bounds from continuous conversion, preserve both stereo dimensions, handle overlapping groups and fail partial dispatch without retry/replay. S03 owns those calculations/tests and product labels; no adjustable group fader or aggregate VU is enabled by S01.

## Parked qualification and validation

Current-firmware INIT/link/mode coverage, automatic firmware fan-out, native-client linked edits, echo precision/order and whether writes are normalized/quantized must be verified later in explicit human qualification. No current firmware actuation result is claimed. Native unknown behavior must not silently relax guards. Mobile/network/offline/hide/sleep qualification stays F08-S01; no hardware retry is performed now.

Tests use synthetic parser observations and fake context/dispatch only. Check exact message boundaries, no input fallback, model/mode/source/output requirements, shifted/overlapping/conflicting relationships, Cartesian deduplication, zero vs missing, unequal linked rejection, selection/generation/membership/actual-edit invalidation, forged/reordered/replayed plans, partial interruption, fresh versus stale readback, and zero outbound effects from observation/arming alone. Main read-only bundle/session remain unchanged. Test/build results and review links belong to F05-S01.
