# Mixmate

An offline PWA testing Soundcraft Ui24R connectivity on Android and iOS.

- This is a separate project from solartracker.
- Keep all application assets bundled locally; no runtime CDNs, analytics or accounts.
- Runtime transport currently permits `3:::INIT`, `3:::ALIVE`, `2::`, and validated `3:::SETD^i.<0..23>.mix^<0..1>` only in the existing explicitly armed input-fader test. The read-only IEM factory/entry still exposes only the three connection messages; never broaden that factory or call the input writer for AUX controls.
- F05-S01 deliberately adds reviewed typed AUX-level serializer forms: `3:::SETD^a.<0..9>.mix^<value>` and `3:::SETD^<source>.aux.<0..9>.value^<value>`, source i.0..23/l.0..1/p.0..1/f.0..3, JavaScript finite numeric value 0..1 inclusive. These may be sent only through the later privately owned typed AUX-control session after its reviewed S02 integration, explicit arming, owned current-socket/generation/selection state, received Ui24/AUX-mode/link/level prerequisites and per-command revalidation. S01 itself adds no socket writer/UI actuation. No arbitrary path/raw sender, guessed fallback or AUX-to-input `.mix` substitution. See [ADR-0004](docs/adr/0004-aux-level-safety.md) and the [exact contract](docs/iem-aux-level-safety.md). Unequal linked target levels remain read-only; group finite offsets require finite non-silent baselines. All other fields remain outside these level forms.
- User authorization dated 2026-11-09 covers future implementation of AUX-master/send levels and relative groups, AUX pan, AUX output EQ curves mapped to verified graphic-EQ bands/supported shelves, snapshot recall/save, and multitrack start/stop. See [ADR-0002](docs/adr/0002-deferred-qualification-and-authorized-controls.md). This is feature-class authorization, not an immediate expansion of the active wire allowlist; do not request the same scope permission again.
- Before enabling an approved feature, document verified exact paths/message forms, types/ranges, capabilities, stereo handling and current-socket prerequisites, then deliberately update this active allowlist and narrow typed guards in that feature's reviewed PR. No generic sender or guessed paths. Unknown semantics remain unavailable or parked. No independent mute, gain, routing, clock/time, network, general scene-edit/delete or destructive configuration writes.
- The approved snapshot recall/save operations are the deliberate exception to the former scene-change prohibition; recall may apply the selected snapshot's stored settings. This does not authorize arbitrary parameter/configuration write paths outside the named operation.
- No real-desk actuation during development or automated verification. All automated writes use fake mixer transports; human live-actuation qualification must be separately arranged.
- Fader writes require received channel level and stereo-link metadata on the current live socket. Future approved controls require their verified current-socket capability/state prerequisites. Preserve source and output stereo-linked relationships. Never queue/retry/replay writes or write in response to incoming state. Clamp relative group moves as a whole at the first member limit; do not independently clamp members and lose balance.
- UI control starts disabled and must be enabled by the user for the selected channel. Disarm on channel change, disconnect and app hiding.
- Automated tests must use fake mixer transports for all write commands; do not move real faders.
- Connect only after a user action. Do not reconnect automatically, including after sleep or navigation.
- Do not persist mixer state. Treat mixer strings as untrusted; render them with textContent.
- Distinguish socket connectivity from receiving actual channel state. Clear displayed state when disconnected.
- Do not claim offline readiness until every precached asset is verified.
- Preserve relative paths and service worker scope under `/mixmate/` on GitHub Pages.
- Run `npm test` and `npm run build` before opening a PR.
- Request `@codex review` on PRs; resolve findings and wait for affirmative Codex review before merging. Silence is not approval.

- Per ADR-0002, F01/S03 may complete as an implementation/evidence checkpoint while physical-device qualification remains open in F08-S01. Record unsupported/untested results honestly. Work stories sequentially through reviewed PRs; when hardware blocks a story, record it as parked and document a dependency exception before independent coding. Track decisions and follow-ups in `docs/user-follow-up.md`.
