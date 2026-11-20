// F09-S09 (user decision 2026-11-20): pan display text in the prototype/Demo
// convention (demo-view.js panLabel: "CENTRE", "L 30", "R 30"). Display only:
// wire 0 = "L 100", 0.5 = "CENTRE", 1 = "R 100", linear, rounded to an integer
// (symmetric about centre). Wire values and pan write semantics are unchanged;
// the physical direction is verified on the desk by root, not by this mapping.
const validPan = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function panDisplayAmount(wire) {
  if (!validPan(wire)) return null;
  const offset = (wire - 0.5) * 200, amount = Math.round(Math.abs(offset));
  return amount === 0 ? 0 : Math.sign(offset) * amount;
}
export function panDisplayText(wire) {
  const amount = panDisplayAmount(wire);
  return amount === null ? null : amount === 0 ? 'CENTRE' : `${amount < 0 ? 'L' : 'R'} ${Math.abs(amount)}`;
}
// One shared value for the strip button: every known side exactly equal.
export function commonPanWire(values) {
  return values.length > 0 && values.every(value => validPan(value) && value === values[0]) ? values[0] : undefined;
}
