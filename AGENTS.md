# Mixmate

An offline PWA testing read-only Soundcraft Ui24R connectivity on Android and iOS.

- This is a separate project from solartracker.
- Keep all application assets bundled locally; no runtime CDNs, analytics or accounts.
- Never send mixer parameter writes, scene recalls, routing, time or network configuration changes. The only outbound frames permitted in this prototype are `3:::INIT`, `3:::ALIVE` and `2::`.
- Connect only after a user action. Do not reconnect automatically, including after sleep or navigation.
- Do not persist mixer state. Treat mixer strings as untrusted; render them with textContent.
- Distinguish socket connectivity from receiving actual channel state. Clear displayed state when disconnected.
- Do not claim offline readiness until every precached asset is verified.
- Preserve relative paths and service worker scope under `/mixmate/` on GitHub Pages.
- Run `npm test` and `npm run build` before opening a PR.
- Request `@codex review` on PRs; resolve findings and wait for affirmative Codex review before merging. Silence is not approval.
