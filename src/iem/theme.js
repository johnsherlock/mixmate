// Application-owned display colours only, never mixer names/levels/availability.
const OUTPUT_COLOURS = Object.freeze(['#6bcbd1', '#b6a2ef', '#e8bb69', '#7aaef0', '#e494a7']);
export const overviewColour = '#e1d067';
export const outputColour = index => OUTPUT_COLOURS[index % OUTPUT_COLOURS.length];
