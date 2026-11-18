# IEM presentation and mode boundaries — F03-S02

Date: 2026-11-09. Story: [F03-S02](stories/F03-S02.md). Baseline: reviewed `main` at `c721b9f` (F03-S01 / PR #16). No mixer connection, writer, meter decoder or active wire-permission change is part of this story.

## Scoped implementation plan

1. Preserve the accepted standalone reference and root connection/input-fader test.
2. Extract the accepted styling, static shell, local clock and touch policy into bundled vanilla modules. Keep all simulated data and mutation paths behind a demo-only entry/provider.
3. Add an empty read-only IEM destination with a neutral keyed renderer suitable for future received-state projections. Unknown state must remain unavailable; no mock source counts, names, pairs, levels, pan or meters enter live mode.
4. Verify the assets of each executing entry before reporting offline readiness, including when an older worker still controls the page.
5. Test pure/provider/gesture/rendering boundaries and production/offline coverage, then perform isolated browser QA using fake transports. Keep actual session wiring and metering with F03-S03/S04.

This plan follows the user-approved architecture and autonomous routine decisions in ADR-0002; it does not add another permission gate or promise that hardware qualification passed.

## Destinations and modules

- Root `index.html` remains the existing connection/input-fader experiment, with links to both IEM destinations and the reference. Its explicit arming/connection behavior remains unchanged.
- `demo.html` imports `demo-entry.js`, `demo-view.js`, `demo-provider.js` and `demo-eq.js`. It preserves the accepted simulated masters/sends, groups/editor/order, relative moves, pan, point/drawn EQ, snapshot/record/native-layer simulations and fullscreen. Every viewport retains a visible **DEMO · SIMULATED · NO MIXER CONNECTION** label and links to the other modes. Demo state is session-local, with no transport, persistence or shared rig/group settings. Its finite dB floor/meters are design values only.
- `iem.html` imports `live-entry.js`, `live-provider.js` and `live-view.js`. The provider starts empty and never imports demo code or uses profile bounds as observed availability. The page explicitly says it has no mixer session and offers the connection test/demo. Snapshot/save/record/native/group/EQ controls stay disabled/unavailable. F03-S03 will add the separate receive-only session; S04 owns actual meters.
- `shell.html`/`shell.js`, `iem.css`, `clock.js`, `layout.js` and `gestures.js` supply neutral presentation primitives. Static shell HTML is trusted application markup. Provider/user/mixer strings in the read-only renderer use `textContent`; clock markup derives only from the local numeric wall clock.
- `live-view.js` preserves keyed strip/input/cap nodes across readback and order changes. It moves existing nodes only when order changes. Missing/out-of-range positions hide input/cap rather than displaying a default or previous position; unavailable meters are dashes. No rendering event sends a command.

Extracted JavaScript/CSS is formatted for maintenance, using an already cached formatter rather than adding a project/runtime dependency. The accepted `mockups/iem.html` is byte-identical, still separately published and precached.

## Responsive and touch contract

The accepted CSS remains the layout basis: portrait overview masters retain the reference's two-column arrangement, while phone portrait channel banks use three strips per row; tablets widen the bank. Landscape fits the viewport with horizontal bank scrolling. Portrait fullscreen scrolls vertically. The compact mode bar deliberately remains visible, correcting the reference's hidden preview row so users can always identify/switch demo and read-only modes.

`gestures.js` owns cap-only pointer capture/drag, no-op single track taps and scroll gestures, double-track-tap jumps, and double-master-cap/Enter EQ navigation. It reuses existing wrappers/caps, handles pointer cancellation and disabled controls, and can be torn down without retaining listeners. Demo navigation cancels active gestures; background/navigation cancels fader/EQ drags. Point/drawn modes stay mutually exclusive, portrait EQ controls remain below the graph, and group draft Clear still requires confirmation. Simulation remains disconnected from mixer semantics.

## Offline entry proof

A worker's generic `ready: true` only verifies its own inventory. It cannot certify a newly loaded entry or changed assets from a newer deployment. Every production entry now requests an explicit proof:

1. After Vite emits final module/style URLs, `build-sw.js` normalizes an entry's `<meta name="mixmate-entry-proof">` back to a fixed placeholder and hashes that HTML. It stamps the token into the HTML before calculating the actual per-asset SHA-256. This avoids a circular self-hash; reruns are deterministic. HTML-only changes alter the token.
2. The worker receives the generated entry-token map alongside its existing byte hashes. The page requests its exact entry URL/token, actual loaded content-hashed module/CSS URLs and known entry URLs. The worker rejects unknown assets or a mismatched HTML identity, then verifies every precached asset before echoing matching proof.
3. `verifyOfflineCopy` rejects legacy ready replies with no proof and mismatched coverage. An older controlling worker cannot claim that the current entry assets are offline-ready. The UI explains that users should allow an update to download and close all MixMate windows when finished; no forced activation/reload is added.
4. Root/index, `iem.html` and `demo.html` navigation queries normalize to their own known cached entry. Unknown routes remain unintercepted. Relative URLs and worker scope remain under `/mixmate/`.

Runtime asset requests remain same-origin/local bundles. Both new pages use CSP `connect-src 'none'` at this milestone, with no page transport. Worker precache/verification continues independently. Source development without generated proof cannot claim production offline readiness.

## Validation and limits

Automated checks cover isolated demo/live providers, shared touch semantics, stable read-only DOM/order/unknown transitions, inert strings, separate production dependency graphs with no demo data or mixer protocol in live, exact asset inventory, HTML-only token changes, legacy/mismatched proof rejection and known-entry query navigation. Existing protocol/settings/fader tests continue using fake transports.

Isolated desktop Chromium QA uses only loopback requests and strict fake WebSockets. It checks portrait/landscape/fullscreen layout, scrolling without value change, cap drag/double tap/master EQ, point/draw controls, mode isolation, offline navigation and the root connection test. This is browser evidence, not physical Android/Safari qualification; F08-S01 remains open. Current-firmware AUX corroboration remains parked after the earlier timeout. No real desk was contacted or moved for presentation work.


Final validation: `npm test` passes 97 tests; `npm run build` passes with 15 precached assets, worker `8d2d0548088afe29`. Browser gesture/fullscreen/root-isolation checks used the initial `4df5…` build; the final build specifically rechecked compact label/navigation visibility and cold offline query navigation to live/demo/root with matching version. At 390×844 the portrait channel bank had three columns and no horizontal page overflow. At 844×390 the horizontal bank scrolled while app height remained 390px. Portrait fullscreen native emulated swipe scrolled 0→67 without changing the touched level. The final live page had zero strips/sliders/sockets; demo had five simulated masters and zero sockets. No browser check contacted a real mixer or qualified a physical device.

## Subsequent F03-S03 integration

The empty-shell observations above describe the S02 baseline. [F03-S03](iem-live-session.md) adds the separate explicit receive-only session and actual observed strips while preserving demo isolation, keyed DOM, gestures and entry-specific offline proof. Unknown/matrix fields do not become synthetic AUX values; no new parameter writer or meter decoder is added.

## Default-entry amendment — F01-S04

The root/test destinations above describe the historical S02 baseline. ADR-0003 / F01-S04 promotes the reviewed read-only IEM to `index.html` while retaining `iem.html` as the same-entry compatibility URL. The preserved input experiment/settings move to `connection-test.html`, labelled **Settings / test**; demo/reference remain separate. Version 0.3.0 and verified update notices use the existing bar. Four-entry proof/query handling replaces the original three-entry list without changing CSS/gestures or forcing an update/reconnect.


## F09-S03 requested versus received controls

For the selected owned level/pan coordinate, the cap remains at the last requested/preview value through pending and terminal sent-unverified; the numeric level/per-side pan readout remains last received, explicitly labelled separately from requested intent. Canceled controls restore received cap position and retain inactive requested diagnostics/counts. Groups show local preview Δ while gesturing and requested cumulative offset between gestures, with no hardware-balance proof or aggregate VU. Unchanged requested vectors do not resend. Existing keyed strips/caps/dialog roots, cap drag, double-track jump, single-touch scroll, three-column portrait and compact landscape geometry are preserved; no row, direction labels or runtime asset dependency is added. Desktop fake evidence cannot qualify physical touch/offline/sleep.

## F04-S03 logical overview and linked preview — 2026-11-17

The live overview now collapses only received reciprocal non-conflicting AUX pairs with both modes verified AUX. The first actual member supplies the stable logical key/typed target; unusual pair starts are valid. Mono/unknown/conflicting outputs remain individual. Distinct trimmed received names join with a space, identical names appear once, and missing names remain explicit; names do not establish topology. Both old side navigation preferences resolve to the same current logical identity, without writing settings during restoration or receipt. Explicit navigation persists the canonical existing `a.N` value only on the bound stable profile.

The projection retains both raw individual sides, including send mute/pre/post processing; only fully known equal processing shares one description, while differences or missing fields retain labelled sides. Equal actual levels show one common display, unequal/missing actuals show labelled sides, and accessible detail retains exact normalized values. Two output meter tracks remain individual; source VU retains its source post-fader meaning. The source catalog unions observations on both paired outputs, without manufacturing missing levels. Both linked input strips remain present, and only their qualified active preview/request cap coordinate moves together; actual numeric readouts remain received. No authority, implicit equalization or per-move write comes from this presentation data. Existing private session eligibility, gesture release, cancellation and lifecycle rules still apply.

Overview nodes survive pair/unpair within the ten-output bound; input-bank nodes use stable actual source identity across canonical AUX transitions; group-master render keys retain stable profile plus group identity separately from their current typed AUX target. Landscape overview occupies one row, horizontally scrollable when unresolved individual outputs need space. Existing phone portrait three-column channel banks remain unchanged. Compact channel/pan detail and even landscape channel capacity belong to F04-S04; saved-rig setup belongs to F02-S04. See [F04-S03 evidence](stories/F04-S03.md) for automated/browser checks and the unchanged F08 physical qualification gate.


## F04-S04 compact channel detail — 2026-11-18

Primary live strips follow the prototype's name, received value, fader and meter surface, with compact Pan/Details actions. Repeated topology, processing and VU prose moves to an owned read-only Details dialog; touch buttons and keyboard navigation remain explicit. Details exposes full names, exact individual normalized level/pan actuals, per-output mute/pre-post/processing including unknowns, stereo relationships and source-versus-output meter semantics/provenance. Requested diagnostics remain separate from actuals and survive meter-only publication. Groups describe relative requested delta without inventing aggregate actuals or VU. Opening details cancels obsolete control context; shared unique dialog leases, Escape/Close, focus trapping and safe focus restoration preserve exclusive ownership. Disconnect/navigation or removing the detailed target closes obsolete detail. Mixer strings remain text.

Pan retains numeric 0/0.5/1 labels and presets, a full-width slider and a compact received/requested/preview position. Raw per-output received values and unverified physical-direction/balance explanation are under a native keyboard/touch Details disclosure. Pending/terminal/unavailable feedback stays visible; disclosure never establishes control authority or an ACK. Existing opaque gesture/release/keyup and cancellation paths remain unchanged.

Landscape source banks use an even visible capacity derived from available bank width. Only adjacent sources whose received reciprocal relationship identifies the same pair are kept in one bank, leaving an empty column before a boundary pair when necessary. This includes a leading expanded group master. DOM/model order and saved group membership remain unchanged; neither names nor parity establish links. Phone portrait remains three equal columns. Keyed strips/inputs/caps survive state/meter updates. Physical touch/offline/sleep qualification remains F08-S01; this story adds no writer, library or runtime network dependency.
