import { AUX_EQ_DISPLAY_CENTRES, auxEqDbToPosition, eqArray, eqDataFields } from './aux-eq-protocol.js';

// A requested response, not a claim about parametric filters or actual DSP.
// Draw and point intents stay distinct; native bands are never inverse-fitted.
export function mapRequestedAuxEqCurve(input) {
  const { mode, samples } = eqDataFields(input, ['mode', 'samples']);
  if (!['points', 'draw'].includes(mode)) throw Error('Choose one requested EQ curve mode.');
  const points = eqArray(samples, 2, 257).map(sample => {
    const point = eqDataFields(sample, ['frequencyHz', 'gainDb']);
    if (typeof point.frequencyHz !== 'number' || !Number.isFinite(point.frequencyHz) || point.frequencyHz < 20 || point.frequencyHz > 20000) throw Error('EQ samples must cover only 20 Hz through 20 kHz.');
    auxEqDbToPosition(point.gainDb); // Reject, never independently clip.
    return point;
  });
  if (points[0].frequencyHz !== 20 || points.at(-1).frequencyHz !== 20000 || points.some((point, index) => index && point.frequencyHz <= points[index - 1].frequencyHz)) throw Error('EQ samples require ascending full frequency coverage.');
  let index = 0;
  const values = AUX_EQ_DISPLAY_CENTRES.map(frequencyHz => {
    while (index + 1 < points.length - 1 && points[index + 1].frequencyHz < frequencyHz) index++;
    const left = points[index], right = points[index + 1];
    if (frequencyHz === left.frequencyHz) return auxEqDbToPosition(left.gainDb);
    if (frequencyHz === right.frequencyHz) return auxEqDbToPosition(right.gainDb);
    const fraction = Math.log(frequencyHz / left.frequencyHz) / Math.log(right.frequencyHz / left.frequencyHz);
    const gainDb = left.gainDb * (1 - fraction) + right.gainDb * fraction;
    const minimum = Math.min(left.gainDb, right.gainDb), maximum = Math.max(left.gainDb, right.gainDb);
    // Inputs were strictly validated first. A convex result is mathematically
    // inside its endpoints: correct only floating-point roundoff at that envelope,
    // never clip an out-of-range requested curve into the hardware's gain range.
    const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(minimum), Math.abs(maximum));
    if (gainDb < minimum - tolerance || gainDb > maximum + tolerance) throw Error('EQ interpolation exceeded its numerical envelope.');
    return auxEqDbToPosition(Math.max(minimum, Math.min(maximum, gainDb)));
  });
  return Object.freeze({ mode, basis: 'native-display-centres', values: Object.freeze(values) });
}
