# Mixmate

An offline-first Soundcraft Ui24R connection and input-fader test. It displays channel names, mute states and fader positions, and lets you explicitly enable level control for the selected input. Fader changes affect the real desk.

**App:** https://johnsherlock.github.io/mixmate/

## Try it

1. While online, open the app and wait for **Saved for offline use**.
2. Android Chrome: menu → Install app. iPhone/iPad Safari: Share → Add to Home Screen.
3. Open the installed app once while online and check offline readiness there too.
4. Close it, turn off mobile data and disconnect internet, but leave Wi-Fi enabled. Join the Swissonic router’s Wi-Fi. Keep this connection if the phone warns it has no internet.
5. Reopen Mixmate, enter the mixer’s private LAN IPv4 address (default `192.168.0.60`), and tap Connect. Allow local network access if asked.
6. Select an input and check Mixmate follows changes from the original Soundcraft UI. To send a level, check **Enable fader control**, adjust the slider, and release it (keyboard changes also send). The readout follows the desk’s reported level; the slider sends once per committed change. Stereo-linked inputs move together.
7. Changing inputs, disconnecting or hiding the app disables control. Re-enable it for each selected input. No mute, gain, master, routing or scene controls are provided.
8. Test closing/reopening and device sleep. Reconnect explicitly if the connection drops. Keep the original UI available.

No Mac or internet server is required during use. All app assets are cached on each device; the device connects directly to the mixer. Revisit online for updates. Close all app windows to let a pending update activate. Clearing browser/site data can remove the offline copy. Cache-first launch keeps the installed version stable during a session; allow the update worker to finish downloading online before closing the app.

## Important compatibility limit

Loading offline and connecting to the mixer are independent tests. This app retains its HTTPS origin when installed, while the mixer uses unencrypted `ws://`. Some browsers block this mixed-content/local-network connection. Current Chrome documents local-network permission support for local WebSockets; Android/iOS versions must be tested on actual hardware. **iPhone and iPad compatibility is unverified.** Installation does not bypass browser restrictions. This prototype does not weaken browser security or require mixer configuration changes.

If connection fails, expand diagnostics and copy the result. It includes the browser/device identification, app origin, target IP if reported in an error, and connection events. It contains no mixer state. Nothing is uploaded automatically.

## Protocol and scope

`src/protocol.js` implements the small Socket.IO 0.9 text-frame subset used by the mixer. Connection messages are `3:::INIT` (request current state), `3:::ALIVE` (keepalive), and `2::` (heartbeat response). The only parameter write is a validated `3:::SETD^i.<0..23>.mix^<0..1>` input fader level. Writes require the current socket to be open with received fader and stereo-link state, and are never queued or retried. Linked channels require reciprocal link metadata and both received levels; both faders are written as the standard client does.

Incoming name/mix/mute/stereoIndex state never triggers a write. No mute, gain, master, routing, scene, clock or network writes exist. The third-party `soundcraft-ui-connection` library supplies the fader-to-dB conversion, not its connection or control facade. Automated write tests use fake sockets and must not move real faders.

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

The production build generates a content-versioned service worker and precaches every emitted asset. Development mode does not generate an offline worker; use the production preview to test offline behavior. GitHub Actions runs tests/builds on PRs and deploys `main` to GitHub Pages. Configure Pages source as **GitHub Actions**.

## Review and release

Open a PR, request `@codex review`, resolve findings, and merge only once checks pass and Codex confirms no remaining issues. The repository must be connected to Codex with code review enabled. Phone/tablet installation, offline restart and local-network permission behavior require real-device checks; desktop tests cannot certify iOS support.

## IEM design preview

Open [the responsive IEM mockup](https://johnsherlock.github.io/mixmate/mockups/iem.html) on a phone or tablet. This standalone page simulates five stereo AUX mixes, relative channel groups, pan and EQ controls. It cannot connect to or change the mixer (network access is blocked by its content security policy). The native-app overlay is simulated too.

For local preview: `python3 -m http.server 4190 --bind 127.0.0.1 --directory mockups`, then open `http://127.0.0.1:4190/iem.html`. The build copies this same file into the Pages output and includes it in the existing offline cache.

Preview faders: drag the fader cap to adjust; double-tap the track to jump to a level. A single track touch or a swipe scrolls without changing levels. Double-tap an AUX master cap to open its EQ. Group shortcuts remain available in All Channels; tapping the active group shortcut returns to the group masters. Portrait fullscreen supports vertical scrolling.
