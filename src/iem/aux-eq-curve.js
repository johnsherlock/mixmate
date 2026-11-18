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

// Point intent: three user shape points (log-frequency position 0..1 over the
// display range, requested gain and normalized narrowness 0..1). Their smooth
// sum is sampled ONLY at the 31 native display centres. It is a requested-curve
// drawing aid, not three parametric hardware filters; results outside ±15 dB are
// rejected whole by mapRequestedAuxEqCurve rather than clipped.
export const AUX_EQ_POINT_COUNT = 3;
export const auxEqCentreX = frequencyHz => Math.log(frequencyHz / 20) / Math.log(1000);
const unitNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function auxEqPointWidth(q) { return 0.13 / Math.sqrt(0.1 * Math.pow(100, q)); }
export function auxEqPointGain(points, x) {
  return points.reduce((total, point) => total + point.gainDb * Math.exp(-0.5 * Math.pow((x - point.x) / auxEqPointWidth(point.q), 2)), 0);
}
export function requestedPointSamples(input) {
  const points = eqArray(input, AUX_EQ_POINT_COUNT).map(item => {
    const point = eqDataFields(item, ['x', 'gainDb', 'q']);
    if (!unitNumber(point.x) || !unitNumber(point.q) || typeof point.gainDb !== 'number' || !Number.isFinite(point.gainDb) || Math.abs(point.gainDb) > 15) throw Error('Invalid requested EQ point.');
    return point;
  });
  return Object.freeze({ mode: 'points', samples: Object.freeze(AUX_EQ_DISPLAY_CENTRES.map(frequencyHz => Object.freeze({ frequencyHz, gainDb: auxEqPointGain(points, auxEqCentreX(frequencyHz)) }))) });
}
// Draw intent: one requested gain per native display centre, in index order.
export function requestedDrawSamples(input) {
  const gains = eqArray(input, AUX_EQ_DISPLAY_CENTRES.length);
  return Object.freeze({ mode: 'draw', samples: Object.freeze(gains.map((gainDb, index) => Object.freeze({ frequencyHz: AUX_EQ_DISPLAY_CENTRES[index], gainDb }))) });
}
