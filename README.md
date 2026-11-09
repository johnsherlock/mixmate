# Mixmate

An offline-first Soundcraft Ui24R connection and input-fader test. It displays channel names, mute states and fader positions, and lets you explicitly enable level control for the selected input. Fader changes affect the real desk.

**App:** https://johnsherlock.github.io/mixmate/

## Try it

1. While online, open the app and wait for **Saved for offline use**.
2. Android Chrome: menu → Install app. iPhone/iPad Safari: Share → Add to Home Screen.
3. Open the installed app once while online and check offline readiness there too.
4. Close it, turn off mobile data and disconnect internet, but leave Wi-Fi enabled. Join the Swissonic router’s Wi-Fi. Keep this connection if the phone warns it has no internet.
5. Reopen Mixmate, select a saved local rig or enter the mixer’s private LAN IPv4 address (default `192.168.0.60`), and tap Connect. Allow local network access if asked.
6. Select an input and check Mixmate follows changes from the original Soundcraft UI. To send a level, check **Enable fader control**, adjust the slider, and release it (keyboard changes also send). The readout follows the desk’s reported level; the slider sends once per committed change. Stereo-linked inputs move together.
7. Changing inputs, disconnecting or hiding the app disables control. Re-enable it for each selected input. No mute, gain, master, routing or scene controls are provided.
8. Test closing/reopening and device sleep. Reconnect explicitly if the connection drops. Keep the original UI available.

No Mac or internet server is required during use. All app assets are cached on each device; the device connects directly to the mixer. Revisit online for updates. The offline panel shows the verified **Offline version** and a separate notice when an update is downloaded and waiting. Close all MixMate windows/tabs when finished to let it activate. A later successfully verified version change shows an in-app updated notice; the first version observation silently establishes a baseline. Version history is device-local and optional when storage is unavailable. Clearing browser/site data can remove the offline copy. Cache-first launch keeps the installed version stable during a session; allow the update worker to finish downloading online before closing the app. Missing or damaged cached files are repaired online only when they match that installed version. If a newer deployment prevents repair, close all app windows and reopen online to finish the update; check offline readiness again.

## Local rigs and preferences

The connection test now saves named rigs on this device. **New rig** starts a draft; enter its name/address and choose **Save rig**. Save edits before switching rigs. Names identify your local profiles, not a verified desk identity; profiles can share an address. Selecting/deleting a rig or editing its target address disconnects and disables fader control. Connecting always requires a separate tap on Connect, using the address currently shown.

**IEM display preferences** stores orientation and meter visibility for the future IEM view; it does not add simulated meters or change this test's layout. Settings status distinguishes loading/saving/saved from temporary memory-only changes or a conflict with another app window. If storage fails, the connection test still works, but temporary changes disappear when closed. No received mixer names, levels, meters or armed controls are saved. An old saved address migrates only after validation; its legacy key is removed after a durable settings commit. Open **Settings backup & recovery** to download a local JSON backup, preview an import or reset MixMate's local definitions. Save rig first to include uncommitted editor changes. Import/reset disconnects MixMate only after confirmation and never changes the desk. A reset keeps the offline app files, offline version history and other apps' data; empty definitions stay empty after reopening. Temporary settings can be exported too. See the [backup and recovery guide](docs/settings-backup.md).

**Request storage protection** asks the browser to protect local storage from automatic removal. It is optional and may be denied; the app remains usable. Even granted protection does not prevent a user clearing site data, so keep a backup. Storage belongs to this browser/installation; sharing with another browser or home-screen app is not assumed.

## Installation identity update

The manifest now identifies MixMate specifically as `/mixmate/`, correcting an earlier origin-root app ID. Browsers can treat this as a separate installation. If an existing MixMate installation needs replacement, record its details first and uninstall/reinstall **only the identifiable MixMate app** after opening the updated site online. Uninstall can remove installation-local data. Do not clear all Chrome data or remove another app. If Chrome says installed/Open but MixMate cannot be found or opened, report the device/OS/Chrome versions and its Android app/WebAPK details before further recovery. This correction still needs phone/tablet retesting.

## Important compatibility limit

Loading offline and connecting to the mixer are independent tests. This app retains its HTTPS origin when installed, while the mixer uses unencrypted `ws://`. Some browsers block this mixed-content/local-network connection. Current Chrome documents local-network permission support for local WebSockets; Android/iOS versions must be tested on actual hardware. **iPhone and iPad compatibility is unverified.** Installation does not bypass browser restrictions. This prototype does not weaken browser security or require mixer configuration changes.

If connection fails, expand diagnostics and copy the result. It includes the browser/device identification, app origin, target IP if reported in an error, and connection events. It contains no mixer state. Nothing is uploaded automatically.

## Protocol and scope

`src/protocol.js` implements the small Socket.IO 0.9 text-frame subset used by the mixer. Connection messages are `3:::INIT` (request current state), `3:::ALIVE` (keepalive), and `2::` (heartbeat response). The only parameter write is a validated `3:::SETD^i.<0..23>.mix^<0..1>` input fader level. Writes require the current socket to be open with received fader and stereo-link state, and are never queued or retried. Linked channels require reciprocal link metadata and both received levels; both faders are written as the standard client does.

Incoming name/mix/mute/stereoIndex state never triggers a write. No mute, gain, master, routing, scene, clock or network writes exist. The third-party `soundcraft-ui-connection` library supplies the fader-to-dB conversion, not its connection or control facade. Automated write tests use fake sockets and must not move real faders.

The separate [read-only IEM view](https://johnsherlock.github.io/mixmate/iem.html) uses the [IEM receive schema](docs/iem-protocol-contract.md) and its own connection-only transport; it never calls this input writer. Current-firmware corroboration remains open.

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

Open the [read-only IEM view](https://johnsherlock.github.io/mixmate/iem.html) or [interactive demo](https://johnsherlock.github.io/mixmate/demo.html). The read-only presentation starts empty with unavailable controls; its mixer session follows in the next story. Demo preserves the accepted simulated interactions and cannot connect to a desk. Its state stays in memory and never becomes live values. Mode labels and links remain visible in compact landscape too. The root connection/input-fader test remains available.

Offline readiness verifies the current page's HTML identity and actual module/style assets. An older worker's generic readiness cannot certify these new pages; allow its update to download, close all MixMate windows when finished and reopen online before relying on offline launch. All runtime assets remain bundled locally.

## IEM design preview

Open [the responsive IEM mockup](https://johnsherlock.github.io/mixmate/mockups/iem.html) on a phone or tablet. This standalone page simulates five stereo AUX mixes, relative channel groups, pan and EQ controls. It cannot connect to or change the mixer (network access is blocked by its content security policy). The native-app overlay is simulated too.

For local preview: `python3 -m http.server 4190 --bind 127.0.0.1 --directory mockups`, then open `http://127.0.0.1:4190/iem.html`. The build copies this same file into the Pages output and includes it in the existing offline cache.

Preview faders: drag the fader cap to adjust; double-tap the track to jump to a level. A single track touch or a swipe scrolls without changing levels. Double-tap an AUX master cap to open its EQ. Group shortcuts remain available in All Channels; tapping the active group shortcut returns to the group masters. Portrait fullscreen supports vertical scrolling.

## IEM implementation roadmap

The accepted prototype is the target for the full IEM interface. See the [feature backlog](docs/backlog.md), [architecture decision](docs/adr/0001-offline-iem-architecture.md), [distribution audit](docs/distribution-audit.md) and [real-device checklist](docs/device-checks.md). Features and stories run sequentially, each through a PR and affirmative Codex review before merge. The first feature records the offline-distribution implementation and device evidence checkpoint; unresolved Pixel/mobile qualification is carried to the F08 release gate under [ADR-0002](docs/adr/0002-deferred-qualification-and-authorized-controls.md), so independent implementation can continue. It does not add AUX writes. Planned control classes are authorized, while exact protocol guards still require verification and reviewed implementation. See the [follow-up log](docs/user-follow-up.md).

## Read-only live IEM

Open [Read-only IEM](https://johnsherlock.github.io/mixmate/iem.html), choose **Connect to desk**, select a saved local rig or enter the private mixer address, then choose **Connect read-only**. No connection starts automatically. Socket-open and received Ui24/AUX state are distinct; missing model/mode/link/name/level fields remain unavailable. All Mixes shows individual observed outputs with link indicators; tap a known AUX to browse all actually observed input/line/player/FX sends. Matrix and unknown-mode slots do not become normal AUX views. Linked readbacks stay separate, including unequal values.

Levels/pan are read-only: levels use the source-backed common Soundcraft conversion, including −∞ for received zero, while pan is explicitly normalized. Meters, groups/editing, EQ, snapshots, recording and native UI access are unavailable here until their later stories; Demo remains the independent clickable simulation. Saved profiles/preferences can be edited in the existing connection test; live mixer state is never saved. Disconnect, address/rig changes, hiding/navigation and connection/timeouts clear received values. Return/reopen requires an explicit Connect. See [session details and limits](docs/iem-live-session.md).
