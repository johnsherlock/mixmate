// Socket.IO v0.9 framing used by the Ui24R. No parameter-write API exists here.
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
    const match = /^(SETD|SETS)\^(i\.(?:[0-9]|1[0-9]|2[0-3])\.(?:name|mix|mute))\^(.*)$/.exec(line);
    if (!match) continue;
    const [, command, key, raw] = match;
    const value = command === 'SETD' ? Number(raw) : raw;
    if (command === 'SETD' && (!raw.trim() || !Number.isFinite(value))) continue;
    if (key.endsWith('.mix') && (command !== 'SETD' || value < 0 || value > 1)) continue;
    if (key.endsWith('.mute') && (command !== 'SETD' || (value !== 0 && value !== 1))) continue;
    if (key.endsWith('.name') && command !== 'SETS') continue;
    updates.push([key, value]);
  }
  return updates;
}

export class ReadOnlyConnection {
  constructor({ onStatus, onUpdates, WebSocketClass = globalThis.WebSocket, timeoutMs = 15000 }) {
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
      this.onUpdates(updates);
    };
    socket.onerror = () => { if (this.socket === socket) this.stop('error'); };
    socket.onclose = () => { if (this.socket === socket) this.stop('closed'); };
  }
  stop(status) {
    this.disconnect();
    this.onStatus(status);
  }
  disconnect() {
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
