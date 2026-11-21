import { AUX_EQ_FILTERS, auxEqPosition, eqDataFields } from './aux-eq-protocol.js';

// F06-S05 (user request 2026-11-21): AUX output high-pass ("Low cut", hpf) and
// low-pass ("High cut", lpf) requested-position rules. Pure; no transport.
// Desk semantics (3.0.7865 mixer.html, docs/iem-aux-eq-contract.md): the stored
// position v in 0..1 maps to round(20 x 1000^v) Hz; hpf exactly 0 and lpf
// exactly 1 mean OFF. The slope is unverified and never written.
export const AUX_EQ_FILTER_OFF = Object.freeze({ hpf: 0, lpf: 1 });
// While enabled, a requested position stays strictly inside (0, 1) so a drag can
// never silently turn the filter off (~20.9 Hz .. ~19.1 kHz).
export const AUX_EQ_FILTER_MIN = 0.01;
export const AUX_EQ_FILTER_MAX = 0.99;
// Minimum hpf-to-lpf distance in position units: 0.1 = one decade/10, about one
// octave (1000^0.1 ~ 2x), so the pass band never collapses or crosses.
export const AUX_EQ_FILTER_GAP = 0.1;
export const auxEqFilterHz = position => Math.round(20 * Math.pow(1000, position));
export const auxEqFilterPosition = hz => Math.log(hz / 20) / Math.log(1000);
// Demo defaults (Low cut 35 Hz, High cut 16 kHz) used when a cut is first
// switched on in a session.
export const AUX_EQ_FILTER_DEFAULT = Object.freeze({ hpf: auxEqFilterPosition(35), lpf: auxEqFilterPosition(16000) });
export const auxEqFilterOn = (filter, position) => filter === 'hpf' ? position !== 0 : position !== 1;
export const auxEqFilterOff = (filter, position) => !auxEqFilterOn(filter, position);

// intent: exactly { filter: 'hpf'|'lpf', enabled: boolean, value: 0..1 }. Disabled
// ignores `value` and requests the exact off position. Enabled clamps `value`
// into the allowed span given the OTHER filter's current requested position;
// when the gap leaves no room the request is rejected, never moved elsewhere.
export function mapRequestedAuxEqFilter(input, current) {
  const { filter, enabled, value } = eqDataFields(input, ['filter', 'enabled', 'value']);
  if (!AUX_EQ_FILTERS.includes(filter) || typeof enabled !== 'boolean' || !auxEqPosition(value)) throw Error('Invalid EQ filter request.');
  if (!enabled) return Object.freeze({ filter, enabled, value: AUX_EQ_FILTER_OFF[filter] });
  const other = filter === 'hpf' ? current?.lpf : current?.hpf;
  if (!auxEqPosition(other)) throw Error('A current EQ filter pair is required.');
  const otherOn = auxEqFilterOn(filter === 'hpf' ? 'lpf' : 'hpf', other);
  const low = filter === 'hpf' ? AUX_EQ_FILTER_MIN : otherOn ? Math.max(AUX_EQ_FILTER_MIN, other + AUX_EQ_FILTER_GAP) : AUX_EQ_FILTER_MIN;
  const high = filter === 'lpf' ? AUX_EQ_FILTER_MAX : otherOn ? Math.min(AUX_EQ_FILTER_MAX, other - AUX_EQ_FILTER_GAP) : AUX_EQ_FILTER_MAX;
  if (low > high) throw Error('No room for this filter beside the other cut.');
  return Object.freeze({ filter, enabled, value: Math.max(low, Math.min(high, value)) });
}

// Display-only approximation (the Demo's -12 dB/oct, per cut) of how the
// RECEIVED filter positions bend a displayed band value. The native slope is
// unverified (docs/iem-aux-eq-contract.md); this never feeds a write.
export function auxEqFilterRolloffDb(hpf, lpf, frequencyHz) {
  let db = 0;
  if (auxEqPosition(hpf) && auxEqFilterOn('hpf', hpf)) { const cut = auxEqFilterHz(hpf); if (frequencyHz < cut) db -= 12 * Math.log2(cut / frequencyHz); }
  if (auxEqPosition(lpf) && auxEqFilterOn('lpf', lpf)) { const cut = auxEqFilterHz(lpf); if (frequencyHz > cut) db -= 12 * Math.log2(frequencyHz / cut); }
  return db;
}
