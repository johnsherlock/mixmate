# Changelog

Newest first. Every story PR that changes shipped app files bumps the version and adds an entry (see [orchestration](docs/orchestration.md#versioning-policy-f07-s05)).

## 0.12.0 — 2026-11-24 — F08-S07

- Nudge cards now adjust the current AUX master, group masters and the expanded group's channels. They use the existing level steps, stereo qualification and group limits. Unavailable cards explain why their buttons are disabled, and **Faders** returns to the originating view.

## 0.11.0 — 2026-11-24 — F08-S06

- Added an in-app Nudge design preview with large level buttons for the AUX master, groups and the expanded group’s channels. Preview taps leave desk levels unchanged.

## 0.10.1 — 2026-11-22 — F09-S13 (this PR)

- Navigation order: **Create Group / Edit Group** now sits immediately right of **All Groups** (All Mixes, All Groups, Create/Edit Group, All Channels, Mix EQ). Behaviour is unchanged and nothing new is sent to the desk.

## 0.10.0 — 2026-11-22 — F09-S12 ([#69](https://github.com/johnsherlock/mixmate/pull/69))

- UI tweaks: an **All Groups** button next to All Channels returns to the group faders; **Create Group** (opens a new group) becomes **Edit Group** (opens that group) when a group is expanded; the group fader's dB readout shows the loudest member's level instead of an always-0.0 delta; every level fader (groups, sends, AUX masters) has ▲/▼ nudge buttons that raise by 3 dB / lower by 1.5 dB (edit `src/iem/nudge-config.js` to change them; a group nudges every member); unnamed FX returns show their desk type ("FX1 Reverb"); fader tracks are filled from the bottom to the cap (yellow, light blue for FX); the header snapshot name box is about 50% wider (on a phone held upright it has its own row). No new message is sent to the desk.

## 0.9.0 — 2026-11-21 — F06-S05 ([#68](https://github.com/johnsherlock/mixmate/pull/68))

- EQ filters: the AUX EQ screen gains Low cut and High cut toggles (high-pass / low-pass, as in the Demo). When a cut is on, a draggable LC / HC handle with its frequency and a dashed line appears on the graph; drag it with mouse, finger or arrow keys (changes are sent live, throttled). Turning a cut on uses the last value you used (else 35 Hz / 16 kHz); off sends the desk's OFF position. A pair of stereo AUX outputs gets both sides changed equally; unequal sides stay read-only. The ↺ reset now also turns both cuts off. Cut frequencies shown are the desk's own (20 Hz to 20 kHz); the roll-off drawn on the curve is an approximation.

## 0.8.0 — 2026-11-21 — F07-S04 ([#66](https://github.com/johnsherlock/mixmate/pull/66))

- Native app button: the header Native button opens the desk's own web app (`http://<desk address>/`) in a new browser tab when you tap it. It uses the connected address, else the most recently connected one, and is disabled until MixMate has connected to a desk once. The fake "Simulated native screen" is gone from the live app (the Demo keeps its own). Diagnostics shows the Native UI target. Leaving MixMate for the other tab disconnects as before; returning reconnects automatically.

## 0.7.0 — 2026-11-21 — F07-S03 ([#65](https://github.com/johnsherlock/mixmate/pull/65))

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
