// The ONE place to tweak the nudge buttons (F09-S12, user decision 2026-11-22).
// Every live level fader (group, source send, AUX master) has an up arrow and a
// down arrow: one press raises the level by NUDGE_UP_DB or lowers it by
// NUDGE_DOWN_DB, in the dB-linear display scale (src/iem/fader-scale.js). A group
// applies the same amount to every member. Edit only these two numbers (positive
// dB, finite); the buttons, accessible names, tests' expectations and docs derive
// from them. Nothing here is a protocol value.
export const NUDGE_UP_DB = 3;
export const NUDGE_DOWN_DB = 1.5;
