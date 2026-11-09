# F01 real-device checks

Status: Partial Android installation reports plus received state on an unconfirmed installed-app platform/context; tablet targeted version/name retest passed; full mobile/offline checks outstanding. [Separate desktop transport observations](f01-device-evidence.md) are recorded and do not satisfy this matrix. Owner: user for physical-device operations; master agent for evidence recording and any permitted read-only desktop observations. Follow [F01-S03](stories/F01-S03.md). Record the tested app commit, deployment and worker/cache version; do not apply results from an older build to later behavior changes without a targeted retest.

## Qualification ownership

On 2026-11-09 the user approved continuing implementation and deferring unresolved Pixel/mobile qualification to [F08-S01](stories/F08-S01.md), recorded in [ADR-0002](adr/0002-deferred-qualification-and-authorized-controls.md). F01-S03 may merge as an evidence checkpoint after review; this checklist remains an open release gate. Existing result cells are unchanged and no missing check is treated as a pass. See [the follow-up log](user-follow-up.md).

## Historical F01 test target

The historical F01 target was update-awareness merge `7c2fd850005d108f2a0de4c77cc26cccdc2595af` ([PR #12](https://github.com/johnsherlock/mixmate/pull/12)), worker `0dbe2dd8fae4a9dd`. [Pages deployment](https://github.com/johnsherlock/mixmate/actions/runs/42536378686) succeeded. The tablet user confirmed a targeted cache-version/name pass on prior worker `917e3ba9d64587ec`; update-notice behavior on the new release remains untested. The Pixel browser screenshot also verified `917e3ba9d64587ec`, while installation remains blocked. Historical worker IDs are not silently transferred to newer results.

Open online, allow any waiting update to download, close all MixMate windows/tabs and reopen before testing. The new version is visible in the offline panel; first observation seeds history, later verified changes announce an update. Follow [S02A migration cautions](stories/F01-S02A.md#migration-and-device-gate): remove only an identifiable MixMate installation, never sibling apps or browser data. Record the verified worker version; an existing icon alone does not identify a build.


## Latest reviewed read-only IEM target

Until F03-S04 passes review/merge, use read-only session PR #18, main `8c887a0`, worker `278765c0d1f64197` as the latest reviewed IEM baseline. This is distinct from the historical F01 target/results above. The S04 working branch adds meters but is not a new reviewed device target yet. Read-only entry: `https://johnsherlock.github.io/mixmate/iem.html`; it starts disconnected, and **Connect to desk → Connect read-only** is explicit. Its parameter controls are disabled. The root input-fader connection test remains separate; keep **Enable fader control unchecked** there. Demo/reference gestures are simulated and cannot establish live behavior.

Use the [settings backup guide](settings-backup.md) before any device-only recovery. Backup/import/reset already exists in F02; reset is scoped to local definitions and preserves cached app files/offline history/sibling data. Never clear origin-wide/browser data or remove another app to test MixMate. Record the actual entry, commit and verified worker for every new observation; historical result cells below are unchanged.

## Safety and setup

For the current IEM check use the read-only entry with all parameter controls disabled. If using the separate existing connection test, leave **Enable fader control unchecked throughout**. Do not touch live level controls or change mixer/router settings. No snapshot, record, routing, clock or other state changes are needed. The simulated IEM preview is for layout only; it cannot prove live AUX behavior. Permitted connection messages are INIT, ALIVE and heartbeat.

Have one Android phone/tablet with Chrome, one iPhone with Safari and one iPad with Safari. Record exact device model, OS and browser version. Repeat transport checks on both rigs when available: mixer `192.168.0.60` and mixer `192.168.1.60` (not router addresses). If a rig/device is unavailable, mark it not run; do not fabricate a pass.

## Test procedure

1. **Online browser launch.** Open `https://johnsherlock.github.io/mixmate/`. Wait for “Saved for offline use.” Record any permission prompt, error and diagnostics. App launch must not start a mixer connection.
2. **Install and installed launch.** Android Chrome: browser menu → Install app. iPhone/iPad Safari: Share → Add to Home Screen. Open the home-screen app while online and verify readiness there, reopening once if the worker is taking control. Record whether it opens standalone and whether the last address matches the browser; sharing is an observation, not a requirement.
3. **Cold offline launch.** Close all MixMate browser tabs and installed windows. Disable mobile data and disconnect internet; leave Wi-Fi enabled and join the mixer router. Keep the Wi-Fi connection if warned it has no internet. Launch from the home-screen icon. The complete interface and preview must load without internet. It must begin disconnected with blank received-state readouts and control unchecked. Record readiness and load errors.
4. **Explicit local connection.** In the IEM entry choose Connect to desk, enter/select that rig's mixer address and choose Connect read-only. In the separate root connection test, enter the address and tap Connect with fader control unchecked. Allow local-network access if asked. Record the progression separately: browser blocked/error, socket connected, actual channel state received. A “Socket connected” label alone is not a pass. Confirm at least a received name/level/mute readout and its timestamp; do not change it. Copy diagnostics after reviewing them for device/network details.
5. **Disconnect and reconnect.** Tap Disconnect; displayed received values must clear and control remain unchecked. Wait 20 seconds: no reconnection. Tap Connect explicitly and record received state again.
6. **Background and sleep.** With received state visible, switch away and return, then repeat with a screen lock/sleep of at least one minute. On return the app must be disconnected/cleared, never implicitly reconnected. Tap Connect to recover. Record if the browser kills/reloads the app. A separate long sleep can be recorded as additional evidence.
7. **Close/reopen and navigation.** Close/reopen offline and navigate from connection test to preview/back. No reconnect or restored live values/arming. Verify portrait/landscape and portrait fullscreen can scroll the preview. Preview gesture checks remain simulated.
8. **Permission denial/recovery.** Where the platform exposes an app/site local-network permission, deny access for a test, tap Connect and record visible failure/diagnostics. Restore normal permission through site/OS settings and retry explicitly. If there is no exposed permission UI, record not applicable rather than changing security flags.
9. **Second rig.** Repeat steps 3–6 at the other rig when available; record results separately. Do not infer reachability from the shared address pattern.
10. **Update between sessions.** This needs two reviewed deployments, A and B. Cache A and keep it open while B becomes available online. The open session must not reload. Allow B to download; close all MixMate windows/tabs, reopen online and confirm B, then repeat cold offline launch. Record which build actually served each launch. Until B exists, mark not run.
11. **Failed update and recovery.** Automated local tests cover a failed asset request. On a spare/test installation only, interrupt B's download: A should remain usable. Restore internet, allow download and close/reopen to recover. If deterministic failure cannot be produced, record not run and retain automated evidence separately.
12. **Scoped settings recovery.** On a spare/test installation, export settings first, preview/cancel then confirm local settings reset, and import the backup with explicit confirmation. App caches/offline version history and sibling keys must remain; no connection starts automatically. See the backup guide. Do not clear origin-wide/browser data or erase another app. Testing actual cache loss/reinstallation requires a separately arranged device recovery check; unknown/corrupt/newer records are not silently deleted.

## Result matrix

Use pass / fail / not run / not applicable, with evidence. No mobile support is claimed at baseline. Each installed device must pass offline launch and actual received state without internet; both rig transport rows remain separate.

| Device / browser | Browser online readiness | Installation / installed online launch | Installed offline cold launch | Rig .0.60 state | Rig .1.60 state | Hide/sleep/reopen | Permission recovery | Two-release update | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pixel 6 Pro / Chrome 156 (actual OS version unknown) | Screenshot verifies browser cache `917e3ba9d64587ec` | Blocked: Chrome reports installed/Open; app not found and Open does nothing; absent from chrome://webapks; Settings Apps result pending | Not run | Not run | Not run | Not run | Not run | Not run | Install/launch blocker; cause unknown |
| Lenovo approximately 9-inch tablet / Chrome (exact model and versions pending) | User verifies cache `917e3ba9d64587ec`; selector names work | Installation reported; current installed/browser context not independently confirmed | Not run | Not run | Not run | Not run | Not run | Not run | Targeted version/name update passed; full qualification pending |
| iPhone / Safari | Not run — unavailable | Not run — unavailable | Not run | Not run | Not run | Not run | Not run | Not run | Unverified; support target unchanged |
| iPad / Safari | Not run — unavailable | Not run — unavailable | Not run | Not run | Not run | Not run | Not run | Not run | Unverified; support target unchanged |

User reports and screenshots dated 2026-11-08 confirm the prior `917e3ba9d64587ec` cache on both devices and the tablet's targeted named-selector retest. See [latest evidence](f01-device-evidence.md#later-targeted-tablet-and-pixel-observations). This does not establish cold-offline/sleep behavior or the new update-notice build. Pixel installation remains blocked; installed sibling-app metadata is documented in the [comparison](f01-device-evidence.md#installed-sibling-app-comparison). No support target is silently dropped.

## Additional user report with platform/context unconfirmed

The user confirmed that a router-reachability incident was resolved by moving the cable to the correct Ethernet port on the desk. An installed app described as a “desktop app” now connects and displays an actual received channel name, while the input dropdown displayed placeholders. A follow-up answer did not establish whether this meant the Lenovo home-screen installation or a computer installation. Record actual received state as reported, but do not assign it to a device/rig matrix cell or infer internet was unavailable. No actual channel name is stored here.

F01-S02B has corrected the selector labels from current-socket state, with `textContent`, clearing on disconnect and no write behavior. The later tablet report confirms named labels on worker `917e3ba9d64587ec`; retain this targeted result separately from the earlier ambiguous installed-app report. Exact model/OS/browser/context and offline/sleep conditions still need confirmation.

## Copyable evidence record

```text
Date/time/timezone:
Device model:
OS version:
Browser and version:
Context: browser tab / installed home-screen app
App commit / deployed version:
Offline worker/cache version (if accessible; otherwise unknown):
Rig / mixer IP / mixer firmware (if known):
Internet and mobile data disabled: yes/no
Step number:
Expected:
Observed:
Result: pass/fail/not run/not applicable
Permission prompt and choice:
Received state vs socket-only:
Diagnostics / evidence location:
Parameter controls remained unchecked / no write commands used:
Follow-up / retest required:
```

If a device blocks the local socket, return its exact versions and diagnostics. Leave that verdict blocked/unverified pending a decision; installation or successful desktop access cannot override it. Raw mixer names/values need not be shared for distribution testing.
