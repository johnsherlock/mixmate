# Mixmate

An offline-first, **read-only** connection test for a Soundcraft Ui24R. It displays an input channel’s name, mute state and fader position. It does not control audio or change mixer settings.

**App:** https://johnsherlock.github.io/mixmate/

## Try it

1. While online, open the app and wait for **Saved for offline use**.
2. Android Chrome: menu → Install app. iPhone/iPad Safari: Share → Add to Home Screen.
3. Open the installed app once while online and check offline readiness there too.
4. Close it, turn off mobile data and disconnect internet, but leave Wi-Fi enabled. Join the Swissonic router’s Wi-Fi. Keep this connection if the phone warns it has no internet.
5. Reopen Mixmate, enter the mixer’s private LAN IPv4 address (default `192.168.0.60`), and tap Connect. Allow local network access if asked.
6. Select an input. Change its name/fader/mute using the original Soundcraft UI and check Mixmate follows. Mixmate’s display has no controls that write to the mixer.
7. Test closing/reopening and device sleep. Reconnect explicitly if the connection drops. Keep the original UI available.

No Mac or internet server is required during use. All app assets are cached on each device; the device connects directly to the mixer. Revisit online for updates. Close all app windows to let a pending update activate. Clearing browser/site data can remove the offline copy. Cache-first launch keeps the installed version stable during a session; allow the update worker to finish downloading online before closing the app.

## Important compatibility limit

Loading offline and connecting to the mixer are independent tests. This app retains its HTTPS origin when installed, while the mixer uses unencrypted `ws://`. Some browsers block this mixed-content/local-network connection. Current Chrome documents local-network permission support for local WebSockets; Android/iOS versions must be tested on actual hardware. **iPhone and iPad compatibility is unverified.** Installation does not bypass browser restrictions. This prototype does not weaken browser security or require mixer configuration changes.

If connection fails, expand diagnostics and copy the result. It includes the browser/device identification, app origin, target IP if reported in an error, and connection events. It contains no mixer state. Nothing is uploaded automatically.

## Protocol and scope

`src/protocol.js` implements the small Socket.IO 0.9 text-frame subset used by the mixer. Outbound messages are hardcoded: `3:::INIT` (request current state), `3:::ALIVE` (keepalive), and `2::` (heartbeat response). It only reads `i.0`–`i.23` name/mix/mute updates. No `SETD`, `SETS`, clock-setting or control messages are sent. The third-party `soundcraft-ui-connection` library supplies the fader-to-dB conversion, not its connection or control facade.

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
