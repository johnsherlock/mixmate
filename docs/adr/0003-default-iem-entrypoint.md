# ADR-0003: Make read-only IEM the default app

Date: 2026-11-10
Status: Accepted delivery direction in the master chat; F01-S04 implementation awaiting PR review/merge.
Amends: ADR-0001 destination/default-entry description. ADR-0002 safety and deferred qualification gates remain unchanged.

## Context

The user opened the advertised `/mixmate/` URL and saw the earlier connection-test interface rather than the accepted IEM interface described as delivered. The screenshot appeared to be an older cache, but the latest public root still intentionally selected the connection test while reviewed IEM lived at `iem.html`. The site/PWA default therefore did not deliver the expected main interface. The master committed to correcting that entry point before resuming the unfinished F04-S02 group-navigation work.

## Decisions

1. `index.html` is the read-only IEM app, importing the same `src/iem/live-entry.js` as the retained `iem.html` compatibility URL. Use real HTML entries, not a redirect or a test-to-live data bridge. Demo stays isolated at `demo.html`; the reference mockup is unchanged.
2. Preserve the former connection-test HTML at sibling `connection-test.html`, with its existing main module, settings storage, explicit input arming and lifecycle behavior. Navigation calls it **Settings / test**, with full accessible/title text **Rig settings and connection test**. Its prominent backlink opens the main IEM app.
3. Keep manifest `id: "mixmate/"`, `start_url: "./"` and `scope: "./"` unchanged. Update name/description/theme to IEM. This is a content/default-entry correction, not another installation-identity migration or Pixel troubleshooting action. Existing settings remain device-local at the same origin and schema.
4. Bump the source-backed IEM milestone to app version **0.3.0**, in package metadata/lock only. A bundled version module supplies diagnostics and the existing IEM offline bar; no runtime version fetch or extra strip/UI row. App version and verified offline asset hash remain distinct. This release does not claim all future mixer controls/group navigation are complete.
5. Preserve default-app update awareness: first verified worker hash seeds the optional `mixmate-offline-version` marker silently; a changed validated verified hash shows **Updated** only when history can be recorded. Denied/corrupt/read-only storage does not break readiness or repeat false notices. Invalid, failed or superseded results never advance history. **Update waiting** is separate; its title explains closing all MixMate windows/tabs when finished. No forced activation, reload or auto-connect.
6. Vite emits four entry documents: root/index, IEM alias, demo and connection test. Each runtime requests its actual HTML/module/CSS proof plus all four destination URLs. The worker verifies every precached asset and normalizes query navigation only for known entries. An older three-entry inventory cannot certify the new app. Module-graph tests follow every emitted module script, including Vite's shared scripts for identical root/alias inputs.
7. Deliver F01-S04 as a priority sequential correction before unfinished F04-S02. The master preserved the F04-S02 checkpoint on its own branch; this story is isolated from reviewed main `61944be` in `/private/tmp/mixmate-entrypoint`. It does not copy or ship that unfinished navigation. Resume F04-S02 only after this correction passes review/checks and merges.

## Consequences and limits

The public URL and installed app's stable start URL open the intended IEM interface after the reviewed update activates. Old caches can still show the old test until the user opens online, allows the update, closes all app windows and reopens. Do not clear origin/browser data or remove sibling apps. The existing direct IEM/demo/test/reference URLs remain explicit destinations; defaults never mix demo values into received state.

The main IEM remains receive-only with literal INIT/ALIVE/heartbeat. Only the separate already-armed input test retains its existing input writer. No mixer schema, active write allowlist, responsive CSS or touch policy changes. Firmware/device qualification remains open in F08-S01, and the user cannot run current physical checks now. This delivery fix introduces no real mixer access or actuation.

## Validation

See [F01-S04](../stories/F01-S04.md) for final automated/browser/review evidence and the [follow-up log](../user-follow-up.md) for the priority dependency exception.
