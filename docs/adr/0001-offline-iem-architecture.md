# ADR-0001: Offline IEM architecture and sequential delivery

Date: 2026-11-08
Status: Accepted direction by user; amended by [ADR-0002](0002-deferred-qualification-and-authorized-controls.md) (2026-11-09) and [ADR-0003](0003-default-iem-entrypoint.md) default-entry correction (2026-11-10).

## Context

MixMate must be installed from HTTPS while online, then run on Android/iOS phones/tablets connected directly through a mixer router without internet, accounts or a Mac. The accepted `mockups/iem.html` defines the intended responsive/touch experience. It contains synthetic state and is not a protocol implementation. The existing live connection/input-fader experiment must remain available.

## Decisions

1. Keep the current vanilla JavaScript/Vite foundation. Extract presentation and gesture modules incrementally; no framework migration. Preserve the standalone mockup as the design reference.
2. Keep the existing connection test, isolated demo and read-only live IEM as explicit destinations. Demo data has a distinct provider and visible label; live never inherits demo values. Leaving live disconnects and clears state.
3. Use a narrowly capable read-only transport for IEM, sending only `3:::INIT`, `3:::ALIVE` and heartbeat `2::`. It exposes neither generic parameter sends nor the existing input-fader writer. Shared framing/lifecycle code must not grant IEM write capability.
4. Separate socket-open, received input state, partial AUX readiness, per-field unknowns and meter freshness. Store only observations from the current socket session, with provenance. Missing stereo metadata does not imply mono; conflicting stereo members are not averaged.
5. Validate bounded receive schemas against evidence. AUX source inventory includes every verified category rather than native View 1 or the mock's fixed list. Identify AUX/matrix mode. Accept five stereo pairs only when received relationships establish them.
6. Decode meters independently, validate packet lengths/counts and label actual tap points. Unknown/expired is not silence. Never synthesize a live group meter or present an input meter as measured AUX-send contribution.
7. Bundle all runtime assets locally and precache every emitted asset under relative `/mixmate/` paths/scope. Declare offline readiness only after complete cache verification. Waiting updates activate between sessions, never replace an active session.
8. Connect only after explicit user action; initially select a rig address or enter a private IPv4 address. No automatic reconnect, startup probing or post-sleep reconnect. Disconnect/clear/disarm on hiding and navigation. Connection faults and stale sessions require deliberate recovery.
9. Persist device-local user settings in a versioned IndexedDB repository: rig profile IDs/names/addresses, display/navigation preferences and ordered source-ID group definitions. Use validation, migrations, visible save failures, memory fallback and export/import. Request persistent storage where supported. Do not assume browser and installed-app storage are shared.
10. Live mixer values, meters, arming, gesture baselines and pending operations remain memory-only. An IP is not mixer identity. Missing source IDs remain unresolved; groups are not silently assigned to replacement sources. Never queue/retry/replay writes or restore an armed session.
11. Retain accepted layout and gestures: three strips across phone portrait; wider tablet grids; landscape viewport fit/horizontal banks; portrait/fullscreen vertical scroll; wrapping shortcuts; identifiable expanded group master without AUX master. Demo sliders drag from caps and jump on double track taps; single taps/swipes scroll. Live controls stay disabled until their already-authorized feature has verified protocol/guards and reviewed implementation; browsing/fullscreen/local clock may work.
12. Deliver features and stories sequentially through one story agent at a time. Each story receives a PR, tests/build, requested `@codex review`, fixes and affirmative Codex review before merge and the next story.

## Compatibility gate

Offline launch and local mixer transport are independent capabilities. Installed HTTPS origin does not bypass browser mixed-content or local-network policy. Actual Android Chrome, iPhone Safari and iPad Safari testing is required before support claims. If direct WebSocket access fails, bring an explicit deployment/transport decision to the user; do not weaken browser security or change mixer/router settings. Under ADR-0002, F01/S03 may close as an implementation/evidence checkpoint; unresolved physical qualification is carried explicitly into F08-S01 and remains a release gate, not a blocker for all independent development.

## Permissions and deferred decisions

ADR-0002 records the user's 2026-11-09 authorization for planned AUX masters/sends, pan, output EQ mapping, snapshots and recording. The active implemented allowlist still contains only connection messages and the existing explicitly armed input `.mix` experiment. No AUX action may invoke that input writer. Each feature must verify and document exact allowlists and typed guards before enabling its approved operation; no repeated feature-class permission request is needed. Other prohibitions remain.

The feature-specific verified write contracts, under ADR-0002, must define current-socket metadata prerequisites, arming and disarming, both stereo dimensions, normalized/dB/silence mappings, native edits during gestures, whole-group clamping, and non-atomic partial/disconnect behavior.

The user has accepted mapping requested point/drawn EQ curves onto actual output graphic-EQ bands and supported low/high shelves under ADR-0002; exact protocol, band centres/ranges and user-reported shelf support still require verification, without claiming new hardware processing or overwriting unrelated settings. Snapshot/record semantics and native UI iframe feasibility require individual evidence. Provide a direct-link alternative if embedding is unsupported.

## Consequences

No backend or internet is required at a gig. Settings are installation-local and can be lost if site data is cleared; export/import supplies a portable backup. Mobile transport feasibility remains a release-qualification gate in F08-S01; ADR-0002 permits independent implementation to continue while it is unresolved. Read-only delivery can proceed without AUX permission changes, while later controls may require explicit product decisions where the hardware cannot match the prototype exactly.

## References

- [Feature backlog](../backlog.md)
- [Accepted mockup](../../mockups/iem.html)
- [Repository rules](../../AGENTS.md)
- [Chrome local-network guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Soundcraft manual](https://adn.harmanpro.com/product_documents/documents/5503_1492037684/ui24r_Manual_V1.0_Web_original.pdf)
- [Protocol library documentation](https://fmalcher.github.io/soundcraft-ui/more/howitworks)
