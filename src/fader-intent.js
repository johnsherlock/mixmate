// Keep successive user adjustments independent of delayed desk feedback.
export class FaderIntent {
  request(channel, value) { this.pending = { channel, value }; }
  position(channel, reported) {
    return this.pending?.channel === channel ? this.pending.value : reported;
  }
  confirm(channel, value) {
    if (this.pending?.channel === channel && Math.abs(this.pending.value - value) < 0.000001) this.clear();
  }
  clear() { this.pending = null; }
}
