# Changelog

Newest first. Every story PR that changes shipped app files bumps the version and adds an entry (see [orchestration](docs/orchestration.md#versioning-policy-f07-s05)).

## 0.7.0 — 2026-11-21 — F07-S03 (this PR)

- Multitrack recording: the header Record button starts recording in one tap and shows the desk's own elapsed time while recording; tapping it then offers Stop multitrack recording?. The button is disabled with a reason when no USB drive is in the desk, the desk is locked or busy, or the state is unknown. Outcomes appear in the footer and the Diagnostics log, which gains a Recording section. Automatic updates wait while a recording is active.

## 0.6.1 — 2026-11-21 — F07-S06 ([#64](https://github.com/johnsherlock/mixmate/pull/64))

- Install prompt fallback: when the browser has not offered installation 3 s after load (Brave never does; Chrome only when it deems the page installable), the install strip shows menu instructions (Android: browser menu → Install app or Add to Home screen). A later browser offer switches it to the Install button.

## 0.6.0 — 2026-11-21 — F07-S05

Summarises everything since 0.5.0, plus automatic updates and the install prompt.

- F09-S05..S10 ([#51](https://github.com/johnsherlock/mixmate/pull/51)–[#56](https://github.com/johnsherlock/mixmate/pull/56)): live throttled level/group/pan/GEQ writes, dB-linear level scale with a −70 dB floor, groups to −∞, persistent GEQ points, clean EQ/pan panels, touch fixes.
- F02-S05 ([#58](https://github.com/johnsherlock/mixmate/pull/58)): rigs named by the desk's current snapshot, known addresses and automatic connection.
- F09-S11 ([#59](https://github.com/johnsherlock/mixmate/pull/59)): Diagnostics modal, footer connection status, build commit and time.
- F07-S01 ([#60](https://github.com/johnsherlock/mixmate/pull/60)) and F07-S02 ([#61](https://github.com/johnsherlock/mixmate/pull/61)): snapshot contract and live Recall / Save snapshot dialogs.
- F07-S05: automatic online updates (applied only when no desk session, gesture or dialog is active), Install MixMate prompt, visible version and this changelog, clearer dev-server offline message.
