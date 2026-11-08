// Socket.IO v0.9 framing. Writes are limited to validated input fader levels.
export const OUTBOUND = Object.freeze({ init: '3:::INIT', alive: '3:::ALIVE', heartbeat: '2::' });

export function mixerURL(address) {
  const parts = address.trim().split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || +p > 255 || String(+p) !== p)) {
    throw new Error('Enter an IPv4 address, for example 192.168.0.60.');
  }
  const [a, b] = parts.map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
    throw new Error('Use a private LAN address (10.x.x.x, 172.16–31.x.x or 192.168.x.x).');
  }
  return `ws://${parts.join('.')}/`;
}

export function parseStateFrame(frame) {
  if (typeof frame !== 'string' || !frame.startsWith('3:::')) return [];
  const updates = [];
  for (const line of frame.slice(4).split('\n')) {
    const match = /^(SETD|SETS)\^(i\.(?:[0-9]|1[0-9]|2[0-3])\.(?:name|mix|mute|stereoIndex))\^(.*)$/.exec(line);
    if (!match) continue;
    const [, command, key, raw] = match;
    const value = command === 'SETD' ? Number(raw) : raw;
    if (command === 'SETD' && (!raw.trim() || !Number.isFinite(value))) continue;
    if (key.endsWith('.mix') && (command !== 'SETD' || value < 0 || value > 1)) continue;
    if (key.endsWith('.mute') && (command !== 'SETD' || (value !== 0 && value !== 1))) continue;
    if (key.endsWith('.stereoIndex') && (command !== 'SETD' || ![-1, 0, 1].includes(value))) continue;
    if (key.endsWith('.name') && command !== 'SETS') continue;
    updates.push([key, value]);
  }
  return updates;
}

export class MixerConnection {
  constructor({ onStatus, onUpdates, WebSocketClass = globalThis.WebSocket, timeoutMs = 15000 }) {
    this.channelState = new Map();
    this.onStatus = onStatus;
    this.onUpdates = onUpdates;
    this.WebSocketClass = WebSocketClass;
    this.timeoutMs = timeoutMs;
  }
  connect(address) {
    const url = mixerURL(address);
    this.disconnect();
    this.onStatus('connecting');
    let socket;
    try { socket = new this.WebSocketClass(url); }
    catch (error) { this.onStatus('blocked', error.message); return; }
    this.socket = socket;
    let receivedState = false;
    this.timeout = setTimeout(() => {
      if (this.socket !== socket) return;
      this.stop('timeout');
    }, this.timeoutMs);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.onStatus('connected');
      socket.send(OUTBOUND.init);
      this.keepalive = setInterval(() => {
        if (this.socket === socket && socket.readyState === 1) socket.send(OUTBOUND.alive);
      }, 1000);
    };
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return;
      if (data === OUTBOUND.heartbeat) { socket.send(OUTBOUND.heartbeat); return; }
      const updates = parseStateFrame(data);
      if (!updates.length) return;
      if (!receivedState) {
        receivedState = true;
        clearTimeout(this.timeout);
        this.onStatus('live');
      }
      for (const [key, value] of updates) this.channelState.set(key, value);
      this.onUpdates(updates);
    };
    socket.onerror = () => { if (this.socket === socket) this.stop('error'); };
    socket.onclose = () => { if (this.socket === socket) this.stop('closed'); };
  }
  faderTargets(channel) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 24) return [];
    const index = channel - 1;
    if (!this.channelState.has(`i.${index}.mix`)) return [];
    const stereo = this.channelState.get(`i.${index}.stereoIndex`);
    if (stereo === -1) return [index];
    if (stereo !== 0 && stereo !== 1) return [];
    const partner = index + (stereo === 0 ? 1 : -1);
    if (partner < 0 || partner > 23 || !this.channelState.has(`i.${partner}.mix`) ||
        this.channelState.get(`i.${partner}.stereoIndex`) !== 1 - stereo) return [];
    return [index, partner];
  }
  setInputFader(channel, value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Fader level must be a number from 0 to 1.');
    }
    const targets = this.faderTargets(channel);
    if (!targets.length || this.socket?.readyState !== 1) return false;
    // Never queue or retry writes. Only act on this live connection and known channel state.
    try {
      for (const index of targets) this.socket.send(`3:::SETD^i.${index}.mix^${value}`);
      return true;
    } catch {
      this.stop('error');
      return false;
    }
  }
  stop(status) {
    this.disconnect();
    this.onStatus(status);
  }
  disconnect() {
    this.channelState.clear();
    clearTimeout(this.timeout);
    clearInterval(this.keepalive);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }
}
