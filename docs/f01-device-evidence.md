# F01-S03 device and transport evidence

Status: In progress; physical-device gate outstanding. Story: [F01-S03](stories/F01-S03.md). Device procedure and return template: [real-device checks](device-checks.md).

## Bounded desktop observation

- Date/time: 2026-11-08, starting 19:55:14 UTC (Europe/Dublin local time).
- Repository source: `3f93d3308e2da63a9bd3f307a99d8cf109ec74aa`, the reviewed F01-S02 merge. Desktop observation imported the existing `parseStateFrame` from `src/protocol.js`; no application code was changed.
- Environment: macOS (`darwin`), ARM64, Node.js `v26.13.0`, built-in WebSocket. This was not Safari, Chrome, a browser tab or an installed PWA, and had no HTTPS page origin.
- Network: the agent host's current LAN. Internet availability was not controlled; mobile data was not applicable. No mixer/router settings were changed. Mixer firmware/model identity was not collected.
- Authorization: user explicitly made the live mixer available for verification. The observation opened only the two known private addresses, sequentially, once each; no address scan, retry, background discovery or reconnect.
- Deadline: seven seconds per address, followed by explicit connection closure.
- Outbound application frames: immutable literal `3:::INIT`, `3:::ALIVE` and `2::` only. No `SETD`, `SETS`, input-fader or AUX control frame was sent. No general parameter sender or control facade was used.
- Privacy/state: incoming data was processed in memory and discarded. Only the aggregate counts below were retained; no raw frame, name, channel value, routing state, snapshot or meter value was written to disk.

| Known target | Socket opened | Existing input parser accepted state | Observation duration | Result |
| --- | --- | --- | --- | --- |
| `192.168.0.60` | Yes | Yes: 192 accepted updates | 7,016 ms | Node transport and received input-state evidence on this LAN |
| `192.168.1.60` | No | No | 7,004 ms | Connection timed out; no application frames sent; other-rig reachability remains unverified |

For `192.168.0.60`, the seven-second window received 468 text frames and no non-text frames. Batched records included 1,280 `SETS`, 12,050 `SETD`, 155 `VU2`, and 205 records outside the small counted type set. Outbound counts were one INIT, six ALIVE messages, and 101 heartbeat responses. Received `SETD`/`SETS` counts describe incoming state only and are not outbound commands. Counts include repeated/batched updates and do not imply a source inventory or full initialization guarantee.

`VU2` was observed as a message type only; meter layout, tap points, numeric mappings and AUX semantics were not validated in this distribution story. Those belong to F03 evidence work. The `.1.60` timeout says nothing about the other rig when attached to its own router.

## Reviewed deployment for physical checks

[GitHub Pages deployment](https://github.com/johnsherlock/mixmate/actions/runs/42517375756) succeeded for commit `3f93d3308e2da63a9bd3f307a99d8cf109ec74aa`, offline worker/cache version `79f112fe123a3681`. This is the current reviewed target build for the user checklist. Deployment success is not a device result.

## Automated evidence

F01-S02's reviewed suite covers asset inventory/subpath, integrity and repair, failed/waiting updates, bounded readiness, and actual app-entry lifecycle using fake browser objects and mixer transports. It does not substitute for browser-engine or physical-device observations. For this documentation draft, `npm test` passed all 26 tests and `npm run build` passed with eight precached assets and the unchanged worker version `79f112fe123a3681`. No test command connected to a real mixer.

## Outstanding physical-device gate

All Android Chrome, iPhone Safari and iPad Safari verdicts remain unverified. The user must run the linked checklist on actual devices and return versions plus results for installation, installed cold offline launch, explicit connection with actual received state, local-network permission, disconnect/sleep/reopen, and update/recovery. Record both rigs separately when available.

Do not merge F01-S03 or mark F01 complete merely because this Node check succeeded or the draft PR passes review. If a browser blocks direct HTTPS-to-local-WebSocket transport, document the exact result and bring an explicit distribution/transport decision to the user. Do not weaken browser security, change mixer/router settings or silently drop a support target.
