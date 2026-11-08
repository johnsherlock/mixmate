# F01 real-device checks

Status: Partial user-reported Android installation observations; offline and transport checks outstanding. [Separate desktop transport observations](f01-device-evidence.md) are recorded and do not satisfy this matrix. Owner: user for physical-device operations; master agent for evidence recording and any permitted read-only desktop observations. Follow [F01-S03](stories/F01-S03.md). Record the tested app commit, deployment and worker/cache version; do not apply results from an older build to later behavior changes without a targeted retest.

## Current reviewed test build

The [Pages deployment](https://github.com/johnsherlock/mixmate/actions/runs/42517375756) of commit `3f93d3308e2da63a9bd3f307a99d8cf109ec74aa` succeeded. Its offline worker/cache version is `79f112fe123a3681`. Open online, allow any waiting update to download, close all MixMate windows/tabs and reopen the home-screen app before testing. Record the verified worker version from diagnostics when available; do not assume the icon launches the latest deployment.

## Safety and setup

Use the existing connection test and leave **Enable fader control unchecked throughout**. Do not touch live level controls or change mixer/router settings. No snapshot, record, routing, clock or other state changes are needed. The simulated IEM preview is for layout only; it cannot prove live AUX behavior. Permitted connection messages are INIT, ALIVE and heartbeat.

Have one Android phone/tablet with Chrome, one iPhone with Safari and one iPad with Safari. Record exact device model, OS and browser version. Repeat transport checks on both rigs when available: mixer `192.168.0.60` and mixer `192.168.1.60` (not router addresses). If a rig/device is unavailable, mark it not run; do not fabricate a pass.

## Test procedure

1. **Online browser launch.** Open `https://johnsherlock.github.io/mixmate/`. Wait for “Saved for offline use.” Record any permission prompt, error and diagnostics. App launch must not start a mixer connection.
2. **Install and installed launch.** Android Chrome: browser menu → Install app. iPhone/iPad Safari: Share → Add to Home Screen. Open the home-screen app while online and verify readiness there, reopening once if the worker is taking control. Record whether it opens standalone and whether the last address matches the browser; sharing is an observation, not a requirement.
3. **Cold offline launch.** Close all MixMate browser tabs and installed windows. Disable mobile data and disconnect internet; leave Wi-Fi enabled and join the mixer router. Keep the Wi-Fi connection if warned it has no internet. Launch from the home-screen icon. The complete interface and preview must load without internet. It must begin disconnected with blank received-state readouts and control unchecked. Record readiness and load errors.
4. **Explicit local connection.** Enter that rig's mixer address and tap Connect. Allow local-network access if asked. Record the progression separately: browser blocked/error, socket connected, actual channel state received. A “Socket connected” label alone is not a pass. Confirm at least a received name/level/mute readout and its timestamp; do not change it. Copy diagnostics after reviewing them for device/network details.
5. **Disconnect and reconnect.** Tap Disconnect; displayed received values must clear and control remain unchecked. Wait 20 seconds: no reconnection. Tap Connect explicitly and record received state again.
6. **Background and sleep.** With received state visible, switch away and return, then repeat with a screen lock/sleep of at least one minute. On return the app must be disconnected/cleared, never implicitly reconnected. Tap Connect to recover. Record if the browser kills/reloads the app. A separate long sleep can be recorded as additional evidence.
7. **Close/reopen and navigation.** Close/reopen offline and navigate from connection test to preview/back. No reconnect or restored live values/arming. Verify portrait/landscape and portrait fullscreen can scroll the preview. Preview gesture checks remain simulated.
8. **Permission denial/recovery.** Where the platform exposes an app/site local-network permission, deny access for a test, tap Connect and record visible failure/diagnostics. Restore normal permission through site/OS settings and retry explicitly. If there is no exposed permission UI, record not applicable rather than changing security flags.
9. **Second rig.** Repeat steps 3–6 at the other rig when available; record results separately. Do not infer reachability from the shared address pattern.
10. **Update between sessions.** This needs two reviewed deployments, A and B. Cache A and keep it open while B becomes available online. The open session must not reload. Allow B to download; close all MixMate windows/tabs, reopen online and confirm B, then repeat cold offline launch. Record which build actually served each launch. Until B exists, mark not run.
11. **Failed update and recovery.** Automated local tests cover a failed asset request. On a spare/test installation only, interrupt B's download: A should remain usable. Restore internet, allow download and close/reopen to recover. If deterministic failure cannot be produced, record not run and retain automated evidence separately.
12. **Cleared site data.** On a spare/test installation only, clear this site's data and verify the offline copy is gone; reopen online and prepare/install again. Record the reset of the last address. Do not erase a device's other sites or future saved settings without a backup. F02 will add settings export/import; it is not present yet.

## Result matrix

Use pass / fail / not run / not applicable, with evidence. No mobile support is claimed at baseline. Each installed device must pass offline launch and actual received state without internet; both rig transport rows remain separate.

| Device / browser | Browser online readiness | Installation / installed online launch | Installed offline cold launch | Rig .0.60 state | Rig .1.60 state | Hide/sleep/reopen | Permission recovery | Two-release update | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pixel 6 Pro / Chrome (OS/browser versions pending) | Not verified | Blocked: Chrome reports installed/Open; app not found in apps and Open does nothing | Not run | Not run | Not run | Not run | Not run | Not run | Install/launch blocker; cause unknown |
| Lenovo approximately 9-inch tablet / Chrome (exact model and versions pending) | Not verified | Installation success reported; installed launch not reported | Not run | Not run | Not run | Not run | Not run | Not run | Partial installation evidence only |
| iPhone / Safari | Not run — unavailable | Not run — unavailable | Not run | Not run | Not run | Not run | Not run | Not run | Unverified; support target unchanged |
| iPad / Safari | Not run — unavailable | Not run — unavailable | Not run | Not run | Not run | Not run | Not run | Not run | Unverified; support target unchanged |

User report dated 2026-11-08. The app commit and worker version actually running on either Android device have not been confirmed. See [evidence detail](f01-device-evidence.md#user-reported-android-installation-observations). Browser display of an Open action alone does not prove a working installed app. A separate manifest identity defect and follow-up F01-S02A are documented in the [evidence record](f01-device-evidence.md#manifest-identity-follow-up); its relationship to the Pixel symptoms is unproven. Device acceptance will need the reviewed identity-fix deployment before retesting.

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
