# Mixmate

An offline PWA testing Soundcraft Ui24R connectivity on Android and iOS.

- This is a separate project from solartracker.
- Keep all application assets bundled locally; no runtime CDNs, analytics or accounts.
- Outbound messages are restricted to `3:::INIT`, `3:::ALIVE`, `2::`, and validated `3:::SETD^i.<0..23>.mix^<0..1>` fader writes. No mute, gain, scene, routing, time or network changes.
- Fader writes require received channel level and stereo-link metadata on the current live socket. Preserve stereo-linked pairs. Never queue/retry writes or write in response to incoming state.
- UI control starts disabled and must be enabled by the user for the selected channel. Disarm on channel change, disconnect and app hiding.
- Automated tests must use fake mixer transports for all write commands; do not move real faders.
- Connect only after a user action. Do not reconnect automatically, including after sleep or navigation.
- Do not persist mixer state. Treat mixer strings as untrusted; render them with textContent.
- Distinguish socket connectivity from receiving actual channel state. Clear displayed state when disconnected.
- Do not claim offline readiness until every precached asset is verified.
- Preserve relative paths and service worker scope under `/mixmate/` on GitHub Pages.
- Run `npm test` and `npm run build` before opening a PR.
- Request `@codex review` on PRs; resolve findings and wait for affirmative Codex review before merging. Silence is not approval.
