# Orchestrator handoff — F09 user-feedback batch complete, 2026-11-20

Before new work, read:
- [AGENTS](../AGENTS.md);
- the [lifecycle](orchestration.md);
- the [backlog](backlog.md);
- the assigned story and its feature;
- the current contracts.

**The F09-S05 → F09-S10 user-feedback batch is complete and merged. Stop here.** Each story fixed issues the user reported while testing on the live desk (screen recordings, screenshots, messages) and was explicitly authorized in conversation. Backlog priority does not authorize further implementation. **F07 is not started.** This closing delivery is identified by its containing PR and history, not by a commit hash, because the PR cannot name its own hash. The last verified story baseline on main is **`8d3095554c4d56ee15bb9e579eec10da3e5e3204`**.

## Review gate substitution (user direction, still in force)

Codex reviews are unavailable because Codex is out of usage. The user explicitly told root to replace `@codex review` with **independent fresh-context agent reviews**.

Each story below was merged only when all of these held:
- a reviewer approved the exact final head;
- CI passed on that head;
- every P1 and P2 finding was resolved;
- root completed live desk acceptance.

The review rounds and live results are recorded in a comment on each PR. Accepted P3s are in [follow-ups](user-follow-up.md).

A future orchestrator should go back to `@codex review` once it is available, unless the user directs otherwise.

## Confirmed deliveries

| Story / PR | Merge commit / UTC time | Final approved head | Passing CI |
| --- | --- | --- | --- |
| [F09-S05 / #51](https://github.com/johnsherlock/mixmate/pull/51) | `7d8a8cbc61974a98847e44c4c1b97c5d36bfcbee` / 2026-11-19 19:29:57 | `74c2cd2` | [44598792229](https://github.com/johnsherlock/mixmate/actions/runs/44598792229) |
| [F09-S06 / #52](https://github.com/johnsherlock/mixmate/pull/52) | `50e24d540150e492278acb9fc1d07ac627c9b61b` / 2026-11-20 09:19:56 | `413024f` | [44709492251](https://github.com/johnsherlock/mixmate/actions/runs/44709492251) |
| [F09-S07 / #53](https://github.com/johnsherlock/mixmate/pull/53) | `dc371cb09c4973c8910393b722d7d98d571ed07f` / 2026-11-20 11:25:45 | `54c50cd` | [44727228263](https://github.com/johnsherlock/mixmate/actions/runs/44727228263) |
| [F09-S08 / #54](https://github.com/johnsherlock/mixmate/pull/54) | `9527f91e6f00fdaaa0fc4f3f34471f312501c47e` / 2026-11-20 12:48:55 | `c978c5c` | [44738699601](https://github.com/johnsherlock/mixmate/actions/runs/44738699601) |
| [F09-S09 / #55](https://github.com/johnsherlock/mixmate/pull/55) | `c4acb380c24be56afa9b87dd402d6f27673ad755` / 2026-11-20 14:50:09 | `bc050e0` | [44757021401](https://github.com/johnsherlock/mixmate/actions/runs/44757021401) |
| [F09-S10 / #56](https://github.com/johnsherlock/mixmate/pull/56) | `8d3095554c4d56ee15bb9e579eec10da3e5e3204` / 2026-11-20 16:19:07 | `b1d6ae3` | [44771985983](https://github.com/johnsherlock/mixmate/actions/runs/44771985983) |

- **Implementation:** one sequential fresh-context story agent per story, each in its own worktree and `codex/` branch.
- **Root's role:** reproducing on the desk before writing each brief, opening PRs, orchestrating reviews, live acceptance and merges.
- **Interruption:** an account usage limit stopped the F09-S09 agent once. It resumed from its preserved state after the reset.

## Delivered behavior: current user decisions

These supersede older wording wherever the two conflict. Each is recorded in its story, the contracts and AGENTS.

### Live writes (F09-S05, user decision 2026-11-18)
- Level, group, pan and GEQ stream throttled, sparse, latest-wins steps during an owned deliberate gesture. Release sends the final exact value only if it differs.
- Own echoes never cancel a gesture. Any other changed value is a native edit: it stops the stream, with no rollback or replay.

### Fader feel and level scale (F09-S06 to S08)
- Drag geometry is fixed for the whole gesture and rendering is batched per frame, so the UI no longer jumps mid-drag.
- Level faders use a dB-linear display scale: +10 to −70 dB is linear, with a short bottom segment down to −∞. The wire value is still the desk position.
- **Relative groups (F09-S08, user decision 2026-11-20):** one common delta in display-scale units, so equal on-screen travel for every member.
  - Up stops when the loudest member reaches +10. Down stops when the quietest reaches −∞ (position 0).
  - Silent members are valid fresh anchors.
  - The group cap follows the loudest member's displayed position and never flickers to "Level unavailable".

### GEQ (F09-S06 to S10)
- **Points (F09-S07):** points are persistent Demo-style parametric drawing aids (frequency, width, gain) over an in-memory anchored base.
  - The base re-anchors at 0 dB gain on open, after a draw or reset, or on any outside change, including between gestures.
  - Bands saturate at ±15 dB and the points request is never rejected whole. Draw requests and the session still reject out-of-range values whole.
- **Handles (F09-S08):**
  - The halo or an r=24 hit circle grabs a handle. A near-miss grab within 24 px works for the mouse only.
  - Arrow keys move the focused point.
  - Since F09-S10 the graph is `touch-action:none` in every mode, as in the prototype. Chrome ignores touch-action on SVG children.
- **Reset (F09-S09, user decision 2026-11-20):** an immediate, deliberate, sparse one-shot with no confirmation.
- **Echo timeout (F09-S06):** the desk drops echoes for equal re-sends and sub-5 ms reversals, so GEQ and group basis waits expire 2.5 s after the newest write.

### Presentation (F09-S07 to S09, matching the prototype)
- These have been removed from the default UI:
  - the strip state lines;
  - the strip Details button;
  - all text under the EQ graph;
  - the pan diagnostics.
- That diagnostic output is available only with `?debug`.
- A read-only reason appears on one line in the EQ header or the footer.
- Group and All Channels buttons are right-aligned before Mix EQ and Edit Groups.
- Export and Import settings are removed. The settings v1→v2 migration is unchanged.

### Pan (F09-S09, user decision 2026-11-20)
- The dialog has LEFT/CENTRE/RIGHT labels, an L n / CENTRE / R n readout and Hard L / Centre / Hard R buttons.
- Strip buttons read `PAN · L 30`, or plain `Pan` when the value is unknown or the two sides differ.
- Wire 0 = left was verified against the native app on the desk.
- Requested values are shown only while a live preview or an own send is pending, and gestures start from the value on screen.

`mockups/iem.html` is unchanged and remains the visual reference, not protocol evidence.

## Verification and resources

- **Final application:** version 0.5.0, 18 precached assets, offline worker `71185f60b38efb02`. **437/437 fake tests** pass. Local Node is 26.13.1; CI uses Node 24.
- **Live desk acceptance:** firmware 3.0.7865-ui24, desk 192.168.0.60. Root ran headless Playwright Chromium against production builds, plus the desktop app's browser pane for real-browser checks. Each PR comment records the scripts' outcomes:
  - fader and group geometry at 1280×800, 844×390 and 390×844;
  - group endpoints;
  - member-drag strip stability;
  - GEQ points, sliders, keys, near-grab and draw;
  - an emulated touch drag before and after F09-S10;
  - the pan direction and presets;
  - immediate sparse reset.
- **Desk state:**
  - SPARE (AUX 9/10) sends, pans and GEQ are at test values; the GEQ was last flattened by the reset test.
  - JOHN'S MIX GEQ was edited during diagnosis and restored exactly (62 values verified).
  - SPARE BASS L pan was restored to 0.5714285714.
  - No snapshot was saved, recalled or deleted.
- **Cleanup:** all story worktrees and branches are removed and the root-owned 4174 servers are stopped. The QA scripts stay in the session scratchpad and are not part of the repository.
- **Untracked file:** preserve the unrelated untracked **`docs/iem-integration-handoff.md`** (SHA256 **`0ac783556d5660ec29e95652c1871628f70c84f45ebb9c4a479e409399dd5bac`**) and never stage it.
- **Prototype hash:** the prototype SHA256 remains **`d004af78c3ae59491dca09f4202d1697e95d1411c07334e6e292da0ec3a266a9`**.

## Remaining work and next orchestration

- **Physical qualification:** [F08-S01](stories/F08-S01.md) still owns physical Android/iOS testing, both rigs, installation/offline, sleep/recovery, real touch feel and storage retention. Neither desktop emulation nor one desk certifies these. Items added by this batch:
  - real-device GEQ handle touch and graph no-scroll;
  - pan and fader touch feel;
  - phone layouts of the cleaned panels.
- **Accepted P3 follow-ups** (see [follow-ups](user-follow-up.md)):
  - On touch, a dot can grab its neighbour's r=24 hit circle.
  - The `.mm-feedback` status is not a live region.
  - A held pan grab that spans the expiry of the 2.5 s window makes the readout jump.
  - The pre-existing level cap shows the retained request after the window, although it is labelled separately from received.
  - The F09-S10 CSS test scans only `.mm-live-eq` rules.
- **Accepted P3s later fixed:** the F09-S07 `anchor.interrupted` hint wording (fixed in F09-S08) and the F09-S08 docs leftovers (fixed in F09-S09).
- **Parked:**
  - the unknown tablet group-save issue (no device evidence yet);
  - the dependency audit (development-chain advisories only).
- **User-raised future direction:** tie groups and layout to the desk's current snapshot. This depends on F07.
- **Next backlog candidate:** [F07](features/F07.md) (snapshot contract, operations, recording, native access). It is **unstarted and outside any authorization**.

A fresh orchestration run should:
1. verify this closing delivery on remote main;
2. read AGENTS and this handoff;
3. get the next explicit batch from the user.

Stop here. No sidebar chat or automatic responsibility transfer has been created.
