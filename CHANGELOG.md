# Changelog

Newest first. Every story PR that changes shipped app files bumps the version and adds an entry (see [orchestration](docs/orchestration.md#versioning-policy-f07-s05)).

## 0.6.0 — 2026-11-21 — F07-S05 (this PR)

Summarises everything since 0.5.0, plus automatic updates and the install prompt.

- F09-S05..S10 ([#51](https://github.com/johnsherlock/mixmate/pull/51)–[#56](https://github.com/johnsherlock/mixmate/pull/56)): live throttled level/group/pan/GEQ writes, dB-linear level scale with a −70 dB floor, groups to −∞, persistent GEQ points, clean EQ/pan panels, touch fixes.
- F02-S05 ([#58](https://github.com/johnsherlock/mixmate/pull/58)): rigs named by the desk's current snapshot, known addresses and automatic connection.
- F09-S11 ([#59](https://github.com/johnsherlock/mixmate/pull/59)): Diagnostics modal, footer connection status, build commit and time.
- F07-S01 ([#60](https://github.com/johnsherlock/mixmate/pull/60)) and F07-S02 ([#61](https://github.com/johnsherlock/mixmate/pull/61)): snapshot contract and live Recall / Save snapshot dialogs.
- F07-S05: automatic online updates (applied only when no desk session, gesture or dialog is active), Install MixMate prompt, visible version and this changelog, clearer dev-server offline message.
