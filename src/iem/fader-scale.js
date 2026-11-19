import { continuousFaderDB, continuousDBToFader, GROUP_MAX_DB, GROUP_MIN_DB } from './relative-groups.js';

// F09-S06 display scale for live level faders (user decision 2026-11-19,
// docs/iem-aux-level-controls.md). Presentation only: the wire value stays the
// desk fader position 0..1 and passes through the same typed guards.
//
// Scale units are dB. From the -60 dB floor to the +10 dB top the travel is
// linear in dB (equal dB = equal distance, like the Demo). Below the floor a
// short "off" segment (5 scale units, about 7% of travel) maps desk position
// linearly from the -60 dB position down to 0 (-inf), so an individual fader
// can still reach silence and received levels below -60 dB display near the
// bottom without being rewritten. Groups never use that segment for writes:
// their downward travel stops when the quietest member reaches -60 dB.
export const FADER_SCALE_TOP_DB = 10;
export const FADER_SCALE_FLOOR_DB = -60;
export const FADER_SCALE_MIN = -65;
export const FADER_SCALE_POINTER_STEP_DB = 0.1;
export const FADER_SCALE_KEY_STEP_DB = 0.5;
export const FADER_SCALE_TICKS = Object.freeze([10, 0, -12, -24, -40, -60]);
export const FADER_FLOOR_POSITION = continuousDBToFader(FADER_SCALE_FLOOR_DB);
const OFF_SPAN = FADER_SCALE_FLOOR_DB - FADER_SCALE_MIN;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function positionToScale(position) {
  if (!unit(position)) throw Error('Fader position must be finite from zero to one.');
  if (position === 1) return FADER_SCALE_TOP_DB;
  if (position >= FADER_FLOOR_POSITION) return Math.max(FADER_SCALE_FLOOR_DB, Math.min(FADER_SCALE_TOP_DB, continuousFaderDB(position)));
  return FADER_SCALE_MIN + OFF_SPAN * position / FADER_FLOOR_POSITION;
}
export function scaleToPosition(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) throw Error('Finite fader scale value required.');
  const value = Math.max(FADER_SCALE_MIN, Math.min(FADER_SCALE_TOP_DB, scale));
  if (value >= GROUP_MAX_DB) return 1;
  if (value >= FADER_SCALE_FLOOR_DB) return continuousDBToFader(value);
  return Math.max(0, Math.min(FADER_FLOOR_POSITION, FADER_FLOOR_POSITION * (value - FADER_SCALE_MIN) / OFF_SPAN));
}
// dB (finite or -inf) to the same scale; used for display-only text/ticks.
export function dbToScale(db) {
  if (db === -Infinity) return FADER_SCALE_MIN;
  if (typeof db !== 'number' || Number.isNaN(db)) throw Error('dB value required.');
  if (db >= FADER_SCALE_FLOOR_DB) return Math.min(FADER_SCALE_TOP_DB, db);
  return positionToScale(continuousDBToFader(Math.max(GROUP_MIN_DB, db)));
}
export const scaleTickPercent = value => (FADER_SCALE_TOP_DB - value) / (FADER_SCALE_TOP_DB - FADER_SCALE_MIN) * 100;
// Strip/readout text: one decimal, never the raw full-precision position.
export function positionDbText(position) {
  if (!unit(position)) return '—';
  const db = continuousFaderDB(position);
  if (db === -Infinity) return '−∞ dB';
  // Same style as the received level text (live-provider.js).
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}
