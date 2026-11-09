// Source: pinned soundcraft-ui-connection 7.1.0, vu/vu.utils.ts.
// Profile evidence, not a native capture/calibration. No sender or live defaults.
import { UI24_SOURCE_FAMILIES, UI24_AUX_COUNT } from './protocol.js';
export const VU_BYTE_SCALE = 0.004167508166392142;
export const UI24_VU_LAYOUT = Object.freeze([
  Object.freeze({ family: 'i', count: UI24_SOURCE_FAMILIES.i.count, stride: 6, fields: Object.freeze(['vuPre', 'vuPost', 'vuPostFader']) }),
  Object.freeze({ family: 'p', count: UI24_SOURCE_FAMILIES.p.count, stride: 6, fields: Object.freeze(['vuPre', 'vuPost', 'vuPostFader']) }),
  Object.freeze({ family: 's', count: 6, stride: 7, fields: Object.freeze(['vuPostL', 'vuPostR', 'vuPostFaderL', 'vuPostFaderR']) }),
  Object.freeze({ family: 'f', count: UI24_SOURCE_FAMILIES.f.count, stride: 7, fields: Object.freeze(['vuPostL', 'vuPostR', 'vuPostFaderL', 'vuPostFaderR']) }),
  Object.freeze({ family: 'a', count: UI24_AUX_COUNT, stride: 5, fields: Object.freeze(['vuPost', 'vuPostFader']) }),
  Object.freeze({ family: 'm', count: 2, stride: 5, fields: Object.freeze(['vuPost', 'vuPostFader']) }),
  Object.freeze({ family: 'l', count: UI24_SOURCE_FAMILIES.l.count, stride: 6, fields: Object.freeze(['vuPre', 'vuPost', 'vuPostFader']) }),
]);
export const MAX_VU_PACKET_BYTES = 8 + UI24_VU_LAYOUT.reduce((total, group) => total + group.count * group.stride, 0);

export function decodeVu2Packet(bytes, model) {
  if (model !== 'ui24' || !(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_VU_PACKET_BYTES) return null;
  let expected = 8;
  for (const [index, group] of UI24_VU_LAYOUT.entries()) {
    if (bytes[index] > group.count) return null;
    expected += bytes[index] * group.stride;
  }
  if (bytes.length !== expected) return null;
  const observations = new Map();
  let offset = 8;
  // Byte 7 and unread block bytes have no semantics in the pinned decoder.
  // Retain neither invented clipping flags nor an assumed reserved-zero rule.
  for (const [index, group] of UI24_VU_LAYOUT.entries()) {
    for (let channel = 0; channel < bytes[index]; channel++, offset += group.stride) {
      const values = {};
      for (const [fieldOffset, field] of group.fields.entries()) {
        const value = bytes[offset + fieldOffset] * VU_BYTE_SCALE;
        if (!Number.isFinite(value)) return null;
        values[field] = value;
      }
      observations.set(`${group.family}.${channel}`, Object.freeze(values));
    }
  }
  return observations;
}
export function decodeVu2Frame(frame, model) {
  if (model !== 'ui24' || typeof frame !== 'string' || frame.length > 1024 || !frame.startsWith('3:::VU2^')) return null;
  // Match atob's standard alphabet/ASCII whitespace and optional padding policy.
  const payload = frame.slice(8).replace(/[\t\n\f\r ]/g, '');
  if (!payload || payload.length > Math.ceil(MAX_VU_PACKET_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  try {
    const binary = atob(payload);
    return decodeVu2Packet(Uint8Array.from(binary, character => character.charCodeAt(0)), model);
  } catch { return null; }
}
