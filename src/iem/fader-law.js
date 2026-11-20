// Desk fader law: received/requested AUX level position 0..1 <-> continuous dB.
// Amplitude profile derived from soundcraft-ui-connection 7.1.0 (MIT),
// Copyright 2020 Ferdinand Malcher. Full notice is bundled at
// public/third-party/soundcraft-ui-connection-LICENSE.txt.
// Provenance and finite capability policy: docs/iem-relative-groups.md.
// Kept separate (F09-S08) so the display scale and the group model can both use
// it without a module cycle.
const amplitude = position => (position < 0.055 ? Math.sin(28.559933214452666 * position) : 1) *
  Math.exp((23.90844819639692 + (-26.23877598214595 + (12.195249692570245 - 0.4878099877028098 * position) * position) * position) * position) * 0.0002676529517952372;
export const GROUP_MIN_DB = -199;
export const GROUP_MAX_DB = 20 * Math.log10(amplitude(1));
export function continuousFaderDB(position) {
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) throw Error('Invalid received fader position.');
  const value = amplitude(position);
  return value < 1e-10 ? -Infinity : 20 * Math.log10(value);
}
export function continuousDBToFader(db) {
  if (typeof db !== 'number' || !Number.isFinite(db) || db < GROUP_MIN_DB || db > GROUP_MAX_DB) throw Error('Outside finite group capability window.');
  if (db === GROUP_MAX_DB) return 1;
  const target = 10 ** (db / 20);
  let low = 0, high = 1;
  for (let n = 0; n < 72; n++) {
    const middle = (low + high) / 2;
    if (amplitude(middle) < target) low = middle; else high = middle;
  }
  return high;
}
