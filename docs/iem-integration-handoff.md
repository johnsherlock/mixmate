# MixMate handoff — current state, 2026-11-24

This replaces the earlier, untracked 2026-11-08 file that described the pre-integration baseline (PR #6). It is the current product and state handoff for a new human or agent. It links to contracts rather than duplicating them. **For the wire allowlist, the [AGENTS transport table](../AGENTS.md#active-transport-boundary) is authoritative**; for orchestration state see the [orchestrator handoff](orchestrator-handoff.md).

Baseline: `main` at `95b612b` (F09-S13 merge, [PR #70](https://github.com/johnsherlock/mixmate/pull/70)), app **0.10.1**. Verify on remote main before relying on this text.

## Product and deployment

- A phone/tablet in-ear-monitor controller for a **Soundcraft Ui24R used only as an IEM mixer**. Topology: desk -> router -> Android/iOS devices on the same LAN. There is **no internet at gigs**, so the app is installed while online and is offline-first (vanilla JavaScript ES modules, Vite; no framework migration is agreed).
- Deployed to GitHub Pages: https://johnsherlock.github.io/mixmate/ (manifest and service-worker scope `/mixmate/`; keep relative paths).
- Entries: `index.html` and `iem.html` are the same live IEM app; `demo.html` is the isolated simulation; `connection-test.html` (`src/main.js`) is the separate input-fader experiment (never import its writers into AUX control); `mockups/iem.html` is the accepted design reference only, not protocol evidence.
- Two rigs historically (desk addresses 192.168.0.60 and 192.168.1.60). **Rig identity is now the desk's received current snapshot name** ([F02-S05](stories/F02-S05.md)), never the IP address; the IP only feeds the known-address list used for automatic connection.
- Versioning ([F07-S05](stories/F07-S05.md), [policy](orchestration.md#versioning-policy-f07-s05)): every PR changing shipped files bumps `package.json` (patch fix, minor feature) and adds a [CHANGELOG](../CHANGELOG.md) entry; CI runs `scripts/check-version.js` (docs-only and test-only PRs pass unchanged). The live entry checks for a new service worker on open, `online` and return to visible, and applies it (one reload) only when no desk session is past socket open, nothing is mid-gesture/send/snapshot and no dialog is open; otherwise it defers. See [distribution audit](distribution-audit.md).

## What the app does today

Details live in [presentation](iem-presentation.md), the control contracts and the [CHANGELOG](../CHANGELOG.md).

- **Connection:** the Connect dialog takes an IPv4 address. Known addresses (up to 8, most recent first, recorded only on full readiness) drive **automatic connection** on app open, after an unexpected drop, and on visible/`pageshow`/`online`; failure opens the Connect dialog. Each control connection uses a writer plus a receive-only companion socket; only companion observations populate state. See [live session](iem-live-session.md), [control runtime](iem-control-runtime.md), [F02-S05](stories/F02-S05.md).
- **All Mixes / All Groups / groups:** device-local group definitions per rig ([groups](iem-groups.md), [settings](settings-repository.md)); relative group faders move members by one common delta ([relative groups](iem-relative-groups.md)); **Create Group / Edit Group** sits immediately right of **All Groups** ([F09-S12](stories/F09-S12.md), [F09-S13](stories/F09-S13.md)); the group dB readout shows the loudest member.
- **All Channels:** per-source send faders for the selected AUX (inputs, line, player, FX returns), with FX return names derived from `fxtype` (Reverb/Delay/Chorus/Room).
- **Level faders:** dB-linear display scale, +10...-70 dB with a short segment to -inf ([level safety](iem-aux-level-safety.md), [runtime](iem-aux-level-controls.md)). **Nudge buttons** on every fader are configured in `src/iem/nudge-config.js` (`NUDGE_UP_DB = 3`, `NUDGE_DOWN_DB = 1.5`).
- **Pan:** per-send pan with display-only L / CENTRE / R labels (wire 0 = `L 100`, 0.5 = `CENTRE`, 1 = `R 100`) ([pan safety](iem-aux-pan-safety.md), [controls](iem-pan-controls.md)).
- **Mix EQ:** AUX graphic EQ with draggable points/draw curve, scoped reset, and high-pass/low-pass filters ("Low cut"/"High cut", [F06-S05](stories/F06-S05.md)) ([EQ contract](iem-aux-eq-contract.md), [ADR-0006](adr/0006-aux-geq-curve-contract.md)).
- **Snapshots:** header Snapshot (recall) and Save dialogs, names-only, bounded outcomes ([contract](iem-snapshot-contract.md), [ADR-0009](adr/0009-snapshot-operation-contract.md)).
- **Multitrack recording:** header Record button and Stop dialog; a typed toggle that is never sent blind ([contract](iem-recording-contract.md), [ADR-0011](adr/0011-multitrack-recording-contract.md)).
- **Native UI button:** opens the desk's own web app (`http://<address>/`) in a new tab ([F07-S04](stories/F07-S04.md)). An in-app overlay is only possible in the planned F01-S05 APK, which is not authorized.
- **Diagnostics:** footer connection status with IP, one message slot and a Diagnostics modal (build/version, connect/disconnect, bounded log) ([F09-S11](stories/F09-S11.md)).
- **Install and offline:** install strip with a menu-instructions fallback and an iOS "Add to Home Screen" hint ([F07-S05](stories/F07-S05.md), [F07-S06](stories/F07-S06.md)); all assets bundled locally, a generated verified precache (18 assets) and no CDNs/analytics/accounts.
- **Write boundary (summary only):** AUX level/group, pan, GEQ and filters, snapshot recall/save, and the multitrack recording toggle, each through typed methods with private guards. Everything else (mute, gain, routing, clock, network, input EQ, deletes, show/cue/preset changes) is outside the allowlist. Read the AGENTS table before changing any serializer, guard or dispatch.

## Architecture map

- `src/iem/session-core.js` privately owns sockets, observations, receipts, generations and control intent; `aux-level-session.js` and `aux-control-session.js` are the literal factories over it (`live-session.js` is the read-only connection factory). Public snapshots do not grant authority.
- Protocol/safety modules per class: `aux-level-protocol.js`, `aux-level-safety.js`, `aux-pan-protocol.js`, `aux-pan-safety.js`, `aux-eq-protocol.js`, `aux-eq-safety.js`, `aux-eq-curve.js`, `aux-eq-filter.js`, `snapshot-protocol.js`, `recording-protocol.js`, `relative-groups.js`, `control-state-model.js`.
- Live UI: `live-entry.js` (entry), `live-controller.js` (wiring, connect, rigs), `live-provider.js` / `live-view.js` / `live-shell.js` / `shell.js` (projection and rendering), `group-navigation.js`, `group-editor*.js`, `eq-controls.js`, `pan-controls.js`, `snapshot-controls.js`, `recording-controls.js`, `diagnostics.js`, `native-ui.js`, `auto-connect.js`, `updates.js`, `install.js`, `entry-offline.js`, `fader-scale.js`, `fader-law.js`, `gestures.js`, `nudge-config.js`. The Demo uses `demo-*.js` and must stay isolated.
- `src/settings.js` is the v3 device-local settings repository (rigs `{ id, name, groups, navigation }`, known addresses, preferences); `src/offline.js`, `src/sw-template.js` and `scripts/build-sw.js` produce the precache worker.
- Tests (`tests/`, Node test runner) use **fake mixer transports only**; no automated test writes to a real desk.
- Build and checks: Node 24 in CI; `npm ci`, `npm test` (604 passing at this baseline), `npm run build` (emits the four entries and generates the precache). `npm run dev` has no offline worker; use `npm run build` then `npm run preview` for production/offline QA. Do not hand-edit `dist/`.

## Testing status

- Automated: 604 fake-transport tests pass; the build passes with an 18-asset precache.
- **User-reported device evidence (2026-11-24): the user has done extensive testing on real phones and tablets and reports that it is all working very well.** This is a user report, not a recorded checklist.
- **[F08-S01](stories/F08-S01.md) remains the formal release gate and is neither passed nor waived.** Its checklist (both rigs tested separately, online install, offline cold start with no internet, sleep/lock and recovery, local-network permission, update flow, Android and iOS install and touch behaviour, per-control checks) has not been formally signed off in the repo. The user's report is strong evidence toward it, pending a recorded sign-off or an explicit user-approved support change. iOS devices were historically unavailable; see the [device checklist](device-checks.md).

## Open items and known issues

- **Pixel install issue:** Chrome 157 on Android 17 (Pixel) refuses to install the PWA after an uninstall while Brave installs it. The deployed build passes Chrome's CDP installability check; suspected on-device Chrome state or a Chromium bug. Unresolved; F07-S06 only added a menu-instructions fallback.
- **F07-S03 live recording acceptance parked:** needs a USB drive in the desk (without one the desk refuses with `MSG^$REC_ERRNOSTICK`).
- **F09-S12 group readout and Edit Group with an expanded group** were not live-tested by the orchestrator (no saved group on the test origin); the user's device testing likely covers it but it is not recorded.
- **F01-S05** (side-loaded Android APK with a native-UI overlay) is drafted, not authorized; open user decisions are listed in [the story](stories/F01-S05.md).
- **F08-S02** release documentation follows F08-S01.
- Accepted P3s and unresolved observations are in [user-follow-up.md](user-follow-up.md).
- About 50 older merged `codex/` branches remain on the remote; cleanup was offered but not yet answered.

## Process summary

Details: [orchestration](orchestration.md) and the [orchestrator handoff](orchestrator-handoff.md).

- Opus orchestrator; Sonnet story and review agents (user direction 2026-11-21). One story, one `codex/` branch and one PR at a time, sequentially.
- While Codex is out of usage, an independent fresh-context agent reviews instead of `@codex review`. Merge only after approval of the exact final head, passing CI, no open P1/P2 and root's live desk acceptance, recorded in a PR comment.
- Standing desk permissions: write tests on the spare AUX 9/10; the only snapshots that may be recalled or saved are the test snapshots **MixMate1** and **MixMate2**, never deleted; never recall, save or delete any other snapshot.
- **Nothing is authorized beyond what the user explicitly requests.**
