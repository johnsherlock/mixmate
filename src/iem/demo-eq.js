const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function sample(curve, x) {
  const k = clamp(x, 0, 1) * 160,
    i = Math.floor(k);
  return curve[i] + (curve[Math.min(160, i + 1)] - curve[i]) * (k - i);
}
export function freq(x) {
  return 20 * Math.pow(1000, x);
}
export function logFreq(f) {
  return clamp(Math.log(f / 20) / Math.log(1000), 0, 1);
}
export function hz(f) {
  return f >= 1000
    ? (f / 1000).toFixed(f < 10000 ? 2 : 1) + " kHz"
    : Math.round(f) + " Hz";
}
export function cuts(eq, x) {
  const f = freq(x);
  return (
    (eq.lowEnabled && f < eq.lowHz ? -12 * Math.log2(eq.lowHz / f) : 0) +
    (eq.highEnabled && f > eq.highHz ? -12 * Math.log2(f / eq.highHz) : 0)
  );
}
export function paramGain(eq, x, ignore = -1) {
  return eq.bands.reduce((total, b, i) => {
    if (i === ignore) return total;
    const width = 0.13 / Math.sqrt(b.q);
    return total + b.gain * Math.exp(-0.5 * Math.pow((x - b.x) / width, 2));
  }, 0);
}
