# F01 distribution baseline

Date: 2026-11-08. Source baseline: `0886db1` (application unchanged by F01-S01). Story: [F01-S01](stories/F01-S01.md).

## Target topology

Install MixMate from `https://johnsherlock.github.io/mixmate/` while online. Launch the installed app on a phone/tablet connected to the external mixer router, with internet and mobile data unavailable. Connect explicitly to the selected mixer at `192.168.0.60` or `192.168.1.60`. No Mac, internet service, account, runtime CDN or mixer/router configuration change is required by the intended design. Actual browser transport feasibility remains unverified.

Offline launch and mixer transport are separate acceptance gates. A cached interface or open socket does not prove received mixer state.

## Existing implementation audit

| Area | Source evidence at baseline | Limit / follow-up |
| --- | --- | --- |
| Installation | Baseline manifest has `id: "./"`, relative start URL/scope, standalone display and 192/512 PNG icons. `index.html` links manifest and Apple touch icon. | Correction discovered in S03: ID resolves against the start URL origin, so baseline ID is the origin root, not `/mixmate/`. See S02A below. Real Chrome install and Safari Add to Home Screen still require device checks. |
| Relative deployment | Vite `base: './'`; manifest paths relative; worker registered as `./sw.js` with scope `./`. | No automated production subpath test currently proves `/mixmate/` resolution. Add in S02. |
| Bundled assets | Build runs Vite, copies standalone mockup, then enumerates all emitted files except `sw.js`. | Current build emits eight precached assets: HTML, JS, CSS, manifest, SVG, two PNGs and mockup. Add an exact emitted-file inventory check, including future nested assets. |
| Cache version | `scripts/build-sw.js` hashes paths and contents into a 16-character version. | Add deterministic generation/content-change tests. |
| Install | Worker precaches all asset URLs through `cache.addAll`. Rejection prevents successful installation. | Add failure/incomplete-cache tests and assert old active worker remains usable after a failed update. |
| Readiness | App sends `VERIFY_OFFLINE`; worker checks every precache URL. Missing controller/error or missing assets does not produce readiness. | No automated worker/message tests. Verification checks presence, not per-entry content hashes. `navigator.serviceWorker.ready` has no deadline before the separate 8-second message timeout; registration/activation stalls can leave UI preparing indefinitely. Verify and address in S02. |
| Fetch | Cache-first only for known emitted assets within scope; root navigation maps to cached `index.html`. Mixer/external traffic is not proxied. | Test cold root/index/mockup navigation at `/mixmate/`, ignored methods/out-of-scope requests, and missing asset behavior. |
| Cache recovery | Missing entries fall through to network, but responses are not inserted into the cache. | Merely reopening online does not repair an evicted entry when the worker version is unchanged, despite current recovery guidance. Reproduce and define repair behavior in S02; never silently declare readiness. |
| Update lifecycle | No `skipWaiting`; new worker waits for existing clients to close. Activation removes old caches within this exact scope and claims clients. | Test that a pending update does not reload or interrupt an open session and that failed new precache leaves old cache intact. Actual two-release installed-app check remains manual. |
| Connection lifecycle | `src/main.js` connects only on form submit, disconnects/disarms on hidden/pagehide, and clears displayed state on terminal statuses. `src/protocol.js` has a 15-second initial-state deadline and ignores obsolete socket callbacks. | App lifecycle events lack automated coverage. No post-initialization liveness timeout detects a silently dead socket if no close/hide event fires. S02 should test lifecycle; S03 device sleep evidence determines whether additional stale-session protection is required. |
| Stored settings | Only last mixer address currently uses `localStorage`, with read/write failures tolerated. Live channel state and fader intent are memory-only. | Versioned rig/group/preferences storage and export/import belong to F02. Clearing site data removes cache and settings. |
| Demo isolation | Mockup is separately copied HTML with `connect-src 'none'`; its values/meters/actions are simulated. | Do not remove CSP and wire the simulated controls to the desk. F03 introduces separate live data provider. |
| CI / release | PR CI runs `npm ci`, `npm test`, `npm run build`; main deploys built `dist` through Pages. | Story PRs require affirmative Codex review and passing checks before merge. Deployment success is independent of device qualification. |

## Automated baseline

On 2026-11-08, `npm test` passed 10 tests, all write tests using fake sockets. `npm run build` passed and generated eight precached assets, worker version `7fdbcc8d8ced85e1`. These checks establish existing protocol/unit/build behavior only. No browser offline, mobile install or live mixer test was performed for S01.

## Browser evidence and limits

Chrome's current guidance describes permission-gated local `ws://` WebSockets from HTTPS when addressed by a recognizable private IP literal. That supports testing our direct-IP topology; it is not a device result. Its generic advice to auto-connect after permission is granted is deliberately not adopted: MixMate always requires an explicit Connect action. [Chrome local-network guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) (checked 2026-11-08).

WebKit documents best-effort storage, eviction and persistent-storage requests, including Home Screen heuristics. This supports a local-settings design with backup/recovery; it does not establish Safari's ability to open the mixer's socket. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) (checked 2026-11-08).

No authoritative result collected here establishes direct Safari HTTPS-to-`ws://` support. Android Chrome, iPhone Safari and iPad Safari remain unverified until [the device matrix](device-checks.md) is executed. If any supported target blocks transport, S03 must record a blocker and bring a transport/distribution decision to the user. No insecure browser switches, mixer network changes or assumed PWA bypass.

## S02 implementation scope

1. Add production inventory/subpath and worker install/fetch/verify/update tests with local fixtures, no mixer access.
2. Reproduce and repair incomplete same-version caches while online, preserving complete caches and honest readiness.
3. Bound offline preparation, including registration/readiness phases, and expose recoverable failure rather than indefinite preparation.
4. Add fake-browser/fake-transport lifecycle coverage for hide/pagehide/reopen and no implicit connection. Preserve connection-test behavior and all mockup gestures.
5. Keep manual update/install/permission checks as S03 gates; tests cannot certify platform support.

## S02 implementation evidence

F01-S02 adds per-asset SHA-256 expectations to the generated worker and includes the worker template in its version hash. Installation validates all downloaded responses before caching. Fetch and offline verification validate cached bytes and attempt missing/corrupt-entry repair only with matching same-version network content, bypassing the HTTP cache. Changed HTML/manifest from a newer deployment cannot contaminate an older active cache; readiness remains false until a matching copy can be recovered or an update activates after all app windows close. Failed new installs do not delete the old active cache.

Offline preparation now has one 15-second deadline covering registration, activation and cache verification. Late attempts cannot override a newer controller verification, and diagnostics record the worker/cache version. This deadline bounds the user-facing result; it cannot cancel a browser-owned registration or worker download already in progress.

`npm test` passes 26 tests, including a real local Vite production build/inventory/subpath check, worker VM tests for install/repair/corruption/failure/waiting-update isolation and fake DOM/socket execution of the actual app entry for hide/pagehide/disarm/clear/reopen/no reconnect. `npm run build` passes with eight precached assets, worker version `79f112fe123a3681`. These are local automated evidence, not browser-engine or phone/tablet results. All S03 verdicts remain unverified.

## S02A manifest identity correction

Device checks exposed an incorrect audit/test assumption: manifest `id` does not resolve like `start_url` and `scope`. The [W3C ID processing algorithm](https://www.w3.org/TR/appmanifest/#id-member) resolves it against the start URL's origin (steps 4–5). The old `"./"` consequently identifies `https://johnsherlock.github.io/`. The S02 test wrongly resolved it against `/mixmate/`, masking this root-identity collision risk.

[F01-S02A](stories/F01-S02A.md) sets `id: "mixmate/"` and adds a specification-based regression. It leaves the relative start URL, scope and runtime asset paths intact. This intentionally changes the installed app identity to `https://johnsherlock.github.io/mixmate/`; browsers honoring ID may treat it as a separate app. Existing MixMate installations may need a targeted uninstall/reinstall after deployment, with installation-local data considered before removal. Never clear all browser data or uninstall an unrelated app to resolve a possible identity collision.

The user reports Pixel 6 Pro Chrome says already installed / Open, but no app can be found and Open does nothing; Lenovo 9-inch Chrome installs successfully. These are partial installation observations without version/offline/live results. The defect is confirmed; its connection to the Pixel failure remains a hypothesis pending retest and Android app/WebAPK identity evidence. All previous mobile support gates remain open.
