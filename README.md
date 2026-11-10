# Mixmate

An offline-first Soundcraft Ui24R IEM monitor using the accepted phone/tablet interface. Connect explicitly to see received AUX levels, sends, pan and source-backed VU meters. Individual AUX master/send levels start off and require selecting a strip and explicitly enabling its level. Pan and group/EQ/snapshot/record controls remain unavailable. Demo is a separate simulation.

**App:** https://johnsherlock.github.io/mixmate/ · **Version:** 0.4.0

## Try it

1. While online, open the main app. Check the small status bar shows **v0.4.0** and **Offline ready** (or **Updated**) with a verified offline version hash.
2. Install through Android Chrome's menu → Install app, or iPhone/iPad Safari → Share → Add to Home Screen. Open the installed app once online and verify its offline status there too.
3. Close the app, turn off mobile data and disconnect internet, but leave Wi-Fi enabled. Join the mixer's external router Wi-Fi and keep the connection if warned there is no internet.
4. Open MixMate, choose **Connect to desk**, select a saved local rig or enter the private mixer address, then choose **Connect live IEM**. Allow local-network access if asked. Nothing connects automatically.
5. All Mixes follows received output state. Select a verified AUX to browse its observed sources. Missing/unsupported data stays unavailable; source VU is not measured AUX-send contribution.
6. Disconnect, hiding, navigation and stale sessions clear received values. After sleep or a lost connection, reconnect explicitly. Keep the native UI available.

**Settings / test** opens [rig settings and the preserved connection test](https://johnsherlock.github.io/mixmate/connection-test.html). Create/save local rigs, preferences and backups there. Its separate input fader can change the desk only after you explicitly enable it; the main IEM page has no input-fader writer.

No Mac, account or internet server is required during intended gig use. All runtime assets are local. Actual Android/iOS installation, offline restart and local-network qualification remain open; see compatibility below.

## Updating from the earlier connection-test homepage

Earlier versions used the connection test as the homepage. Version 0.3.0 made the IEM interface the default and kept the test at its own URL. Version 0.4.0 adds explicitly armed individual AUX level controls; every connection still starts with levels off. The manifest ID, start URL and scope are unchanged. An existing cache can keep the older homepage until an update completes. Open online, let the update download, close all MixMate windows/tabs when finished, then reopen and check **v0.4.0** and verified offline readiness. No automatic reload or worker activation interrupts a session.

The status bar shows the app version plus the verified offline asset hash. First verified observation seeds optional device-local history silently; a later verified change shows **Updated**. **Update waiting** means the downloaded worker is waiting for all MixMate windows/tabs to close. A new entry/asset proof must pass before offline readiness; a generic old-worker ready reply is insufficient. Do not clear browser/origin data or remove another app to obtain the new interface.

## Local rigs and preferences

**Settings / test** saves named rigs on this device. **New rig** starts a draft; enter its name/address and choose **Save rig**. Save edits before switching rigs. Names identify your local profiles, not a verified desk identity; profiles can share an address. Selecting/deleting a rig or editing its target address disconnects and disables fader control. Connecting always requires a separate tap on Connect, using the address currently shown.

**IEM display preferences** stores orientation and meter visibility for the live IEM view; it does not add simulated meters or change this test's layout. Settings status distinguishes loading/saving/saved from temporary memory-only changes or a conflict with another app window. If storage fails, the connection test still works, but temporary changes disappear when closed. No received mixer names, levels, meters or armed controls are saved. An old saved address migrates only after validation; its legacy key is removed after a durable settings commit. Open **Settings backup & recovery** to download a local JSON backup, preview an import or reset MixMate's local definitions. Save rig first to include uncommitted editor changes. Import/reset disconnects MixMate only after confirmation and never changes the desk. A reset keeps the offline app files, offline version history and other apps' data; empty definitions stay empty after reopening. Temporary settings can be exported too. See the [backup and recovery guide](docs/settings-backup.md).

**Request storage protection** asks the browser to protect local storage from automatic removal. It is optional and may be denied; the app remains usable. Even granted protection does not prevent a user clearing site data, so keep a backup. Storage belongs to this browser/installation; sharing with another browser or home-screen app is not assumed.

## Local IEM groups

In the live IEM view, **Edit Groups** stores ordered source-ID membership for the active local rig. Select a saved rig in the connection dialog if using a manual address; matching an IP does not select a rig identity. Select an observed AUX to add its received sources. Existing missing IDs stay marked **Unresolved** and can be edited offline without being replaced.

Tap order determines membership order. Clear requires confirmation and changes only the draft; Cancel discards it. Save changes local definitions only, with visible temporary/conflict warnings if storage fails. Durable Save closes the editor. Group shortcuts stay available beside All Channels. Tap a shortcut to expand its normal-size group master and ordered members; tap it again to return to group masters. Expanded groups omit the AUX master. Missing members remain explicit Unresolved strips; empty groups retain an unavailable group master. All Channels includes every observed source family. Group levels remain unavailable and have no simulated fader or meter. The editor never moves faders. Save definitions before navigating away, and keep a settings backup. Explicit view choices save only local AUX/group navigation for that rig. Reopening never connects automatically: the saved view appears only after Connect and fresh compatible AUX state. Unavailable saved AUX/groups or EQ fall back safely without rewriting the stored preference. Temporary save failures remain visible.

## Installation identity update

The manifest now identifies MixMate specifically as `/mixmate/`, correcting an earlier origin-root app ID. Browsers can treat this as a separate installation. If an existing MixMate installation needs replacement, record its details first and uninstall/reinstall **only the identifiable MixMate app** after opening the updated site online. Uninstall can remove installation-local data. Do not clear all Chrome data or remove another app. If Chrome says installed/Open but MixMate cannot be found or opened, report the device/OS/Chrome versions and its Android app/WebAPK details before further recovery. This correction still needs phone/tablet retesting.

## Important compatibility limit

Loading offline and connecting to the mixer are independent tests. This app retains its HTTPS origin when installed, while the mixer uses unencrypted `ws://`. Some browsers block this mixed-content/local-network connection. Current Chrome documents local-network permission support for local WebSockets; Android/iOS versions must be tested on actual hardware. **iPhone and iPad compatibility is unverified.** Installation does not bypass browser restrictions. This prototype does not weaken browser security or require mixer configuration changes.

If the separate connection test fails, expand its diagnostics and copy the result. It includes the browser/device identification, app origin, target IP if reported in an error, and connection events. It contains no mixer state. Nothing is uploaded automatically.

## Protocol and scope

`src/protocol.js` implements the small Socket.IO 0.9 text-frame subset used by the mixer. Connection messages are `3:::INIT` (request current state), `3:::ALIVE` (keepalive), and `2::` (heartbeat response). The only parameter write is a validated `3:::SETD^i.<0..23>.mix^<0..1>` input fader level. Writes require the current socket to be open with received fader and stereo-link state, and are never queued or retried. Linked channels require reciprocal link metadata and both received levels; both faders are written as the standard client does.

Incoming name/mix/mute/stereoIndex state never triggers a write. No mute, gain, master, routing, scene, clock or network writes exist. The third-party `soundcraft-ui-connection` library supplies the fader-to-dB conversion, not its connection or control facade. Automated write tests use fake sockets and must not move real faders.

The [main live IEM app](https://johnsherlock.github.io/mixmate/) (also available at [the existing IEM URL](https://johnsherlock.github.io/mixmate/iem.html)) uses the [IEM receive schema](docs/iem-protocol-contract.md) and its own typed AUX-level transport; it never calls this input writer. The separate connection-only factory remains available with no write API. Current-firmware corroboration remains open.

Reference: [community protocol documentation](https://fmalcher.github.io/soundcraft-ui/more/howitworks). Mixmate is an independent experiment, not a Soundcraft product.

## Development

Node.js 24+ recommended.

```sh
npm ci
npm test
npm run dev
npm run build
npm run preview
```

The production build generates a content-versioned service worker and precaches every emitted asset with SHA-256 verification. Offline preparation has a 15-second deadline, including worker activation; diagnostics identify the verified worker version. Development mode does not generate an offline worker; use the production preview to test offline behavior. GitHub Actions runs tests/builds on PRs and deploys `main` to GitHub Pages. Configure Pages source as **GitHub Actions**.

## Review and release

Open a PR, request `@codex review`, resolve findings, and merge only once checks pass and Codex confirms no remaining issues. The repository must be connected to Codex with code review enabled. Phone/tablet installation, offline restart and local-network permission behavior require real-device checks; desktop tests cannot certify iOS support.

## IEM destinations

Open the [main live IEM app](https://johnsherlock.github.io/mixmate/) or [interactive demo](https://johnsherlock.github.io/mixmate/demo.html). The live view starts disconnected with levels off; its explicit session shows received AUX state and separately validated VU2 meters. Demo preserves the accepted simulated interactions and cannot connect to a desk. Its state stays in memory and never becomes live values. Mode labels and links remain visible in compact landscape too. The separate [Settings / test page](https://johnsherlock.github.io/mixmate/connection-test.html) retains local settings and the explicitly armed input-fader experiment. The existing `iem.html` URL remains a compatible alias of the main app.

Offline readiness verifies the current page's HTML identity and actual module/style assets. An older worker's generic readiness cannot certify these new pages; allow its update to download, close all MixMate windows when finished and reopen online before relying on offline launch. All runtime assets remain bundled locally.

## IEM design preview

Open [the responsive IEM mockup](https://johnsherlock.github.io/mixmate/mockups/iem.html) on a phone or tablet. This standalone page simulates five stereo AUX mixes, relative channel groups, pan and EQ controls. It cannot connect to or change the mixer (network access is blocked by its content security policy). The native-app overlay is simulated too.

For local preview: `python3 -m http.server 4190 --bind 127.0.0.1 --directory mockups`, then open `http://127.0.0.1:4190/iem.html`. The build copies this same file into the Pages output and includes it in the existing offline cache.

Preview faders: drag the fader cap to adjust; double-tap the track to jump to a level. A single track touch or a swipe scrolls without changing levels. Double-tap an AUX master cap to open its EQ. Group shortcuts remain available in All Channels; tapping the active group shortcut returns to the group masters. Portrait fullscreen supports vertical scrolling.

## IEM implementation roadmap

The accepted prototype is the target for the full IEM interface. See the [feature backlog](docs/backlog.md), [architecture decision](docs/adr/0001-offline-iem-architecture.md), [distribution audit](docs/distribution-audit.md) and [real-device checklist](docs/device-checks.md). Features and stories run sequentially, each through a PR and affirmative Codex review before merge. The first feature records the offline-distribution implementation and device evidence checkpoint; unresolved Pixel/mobile qualification is carried to the F08 release gate under [ADR-0002](docs/adr/0002-deferred-qualification-and-authorized-controls.md), so independent implementation can continue. It does not add AUX writes. Planned control classes are authorized, while exact protocol guards still require verification and reviewed implementation. See the [follow-up log](docs/user-follow-up.md).

## Live IEM and received state

Open [MixMate](https://johnsherlock.github.io/mixmate/), choose **Connect to desk**, select a saved local rig or enter the private mixer address, then choose **Connect live IEM**. No connection starts automatically. Socket-open and received Ui24/AUX state are distinct; missing model/mode/link/name/level fields remain unavailable. All Mixes shows individual observed outputs with link indicators; tap a known AUX to browse all actually observed input/line/player/FX sends. Matrix and unknown-mode slots do not become normal AUX views. Linked readbacks stay separate, including unequal values.

Pan remains read-only. Individual levels start off: levels use the source-backed common Soundcraft conversion, including −∞ for received zero, while pan is explicitly normalized. Meters use the pinned library VU2 profile and display scale, with explicit post-fader tap labels: source-global VU is **not** measured AUX-send contribution. Received zero shows the −80 dB encoded floor; missing and stale (after two seconds) are separate. Matrix/unknown-mode output meters stay unavailable. Current-firmware calibration remains unverified. Ordered local groups, shortcuts, expanded layouts and saved local navigation are available for a bound saved rig; relative group levels, EQ, snapshots, recording and native UI access remain for later stories; Demo remains the independent clickable simulation. Saved profiles/preferences/backups are under Settings / test; live mixer state is never saved. Disconnect, address/rig changes, hiding/navigation and connection/timeouts clear received values. Return/reopen requires an explicit Connect. See [session details](docs/iem-live-session.md) and [meter evidence/freshness limits](docs/iem-meter-contract.md).


The [AUX level safety contract](docs/iem-aux-level-safety.md) and [ADR-0004](docs/adr/0004-aux-level-safety.md) document F05's typed control foundation. The [individual control contract](docs/iem-aux-level-controls.md) describes the private typed session and release-only control behavior. Group gestures remain a separate story; physical actuation qualification is still open.


## Adjusting one AUX level

Tap an observed output name to open its AUX, or a source name within an AUX to select its send. The highlighted strip and **Enable level** button identify the current target. Enable explicitly; only that strip becomes adjustable. Missing/conflicting link or mode metadata, unknown levels and unequal linked readbacks keep control unavailable. A source send changes its AUX contribution, never its input fader.

Drag from the cap to preview, then release once to apply. A single track tap/swipe scrolls without a change; double-tapping the track applies one jump. With the range focused, arrow/Page/Home/End keys preview and key release applies once; Escape, focus loss or pointer cancellation cancels. Received numeric readouts remain authoritative while the cap previews. Linked source/output closures receive their verified two/four level commands without collapsing unequal readbacks.

Pending readback disables further gestures. Every target must report the requested value after its own command; an observed match is not a transaction acknowledgement. After 2.5 seconds without all matching receipts, or on conflicting/native changes, controls turn off with no retry. Partial send errors can leave delivery unknown; no rollback or replay occurs. Selection, group membership/navigation, profile/target changes, dialogs, hiding, sleep and disconnection cancel/disarm. Arming/gesture intent is never stored or restored. After a matching readback, another explicit gesture may use a fresh baseline for that same enabled target. Keep actual hardware qualification separate from fake development tests.
