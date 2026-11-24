import { FADER_SCALE_FLOOR_DB, FADER_SCALE_MIN, FADER_SCALE_TOP_DB } from './fader-scale.js';

// The ONE place to tweak the nudge buttons (F09-S12, user decision 2026-11-22).
// Every live level fader (group, source send, AUX master) has an up arrow and a
// down arrow: one press raises the level by NUDGE_UP_DB or lowers it by
// NUDGE_DOWN_DB, in the dB-linear display scale (src/iem/fader-scale.js). A group
// applies the same amount to every member. Edit only these two numbers (positive
// dB, finite); the buttons, accessible names, tests' expectations and docs derive
// from them. Nothing here is a protocol value.
export const NUDGE_UP_DB = 3;
export const NUDGE_DOWN_DB = 1.5;

export function nextNudgeScale(current, up, group) {
  const step = up ? NUDGE_UP_DB : -NUDGE_DOWN_DB;
  if (group) return Math.max(FADER_SCALE_MIN, Math.min(FADER_SCALE_TOP_DB, current + step));
  if (up) return current < FADER_SCALE_FLOOR_DB ? FADER_SCALE_FLOOR_DB : Math.min(FADER_SCALE_TOP_DB, current + step);
  return current + step < FADER_SCALE_FLOOR_DB ? FADER_SCALE_MIN : current + step;
}
