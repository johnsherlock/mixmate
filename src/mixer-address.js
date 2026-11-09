// Neutral private-LAN address validation; no mixer transport capability.
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

