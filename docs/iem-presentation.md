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
