import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vuValueToDB } from 'soundcraft-ui-connection';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { decodeVu2Frame, decodeVu2Packet, UI24_VU_LAYOUT, VU_BYTE_SCALE, MAX_VU_PACKET_BYTES } from '../src/iem/meters.js';
// The library does not publicly export this pure parser. Execute only its exact
// pinned function body as a reference; never instantiate a connection/facade.
const pinned = await readFile(new URL('../node_modules/soundcraft-ui-connection/index.mjs', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(pinned).digest('hex'), 'ff42aa71e8429b6fe8224656448124c00018bc3c510e0c8a790992b8ab83ff94');
const parserStart = pinned.indexOf('function yi(e) {', pinned.indexOf('//#region src/lib/vu/vu.utils.ts'));
const parserEnd = pinned.indexOf('\n}\n', parserStart) + 2;
const parseVuMessageArray = vm.runInNewContext('(' + pinned.slice(parserStart, parserEnd) + ')');
const fixture = JSON.parse(await readFile(new URL('./fixtures/iem-vu2.json', import.meta.url)));
const bytes = () => new Uint8Array(Buffer.from(fixture.frame.slice(8), 'base64'));
const frame = packet => '3:::VU2^' + Buffer.from(packet).toString('base64');

test('synthetic full profile fixture matches every pinned 7.1.0 decoded field without treating reserved bytes as flags', () => {
  assert.match(fixture.provenance, /SYNTHETIC.*not a real mixer capture/);
  assert.equal(bytes().length, 306); assert.equal(MAX_VU_PACKET_BYTES, 306);
  assert.equal(bytes()[7], 197);
  const actual = decodeVu2Frame(fixture.frame, 'ui24');
  const reference = parseVuMessageArray(bytes());
  const keys = ['input', 'player', 'sub', 'fx', 'aux', 'master', 'line'];
  UI24_VU_LAYOUT.forEach((group, groupIndex) => reference[keys[groupIndex]].forEach((values, channel) => {
    assert.deepEqual(actual.get(`${group.family}.${channel}`), { ...values });
    assert.ok(Object.isFrozen(actual.get(`${group.family}.${channel}`)));
    assert.ok(!('clip' in actual.get(`${group.family}.${channel}`)));
  }));
  assert.equal(actual.size, fixture.counts.reduce((sum, count) => sum + count, 0));
  assert.equal(actual.get('i.0').vuPostFader, 120 * VU_BYTE_SCALE);
  assert.ok(actual.get('i.1').vuPostFader > 1); // Preserve byte-derived quantity; only the display saturates.
  assert.equal(vuValueToDB(actual.get('i.1').vuPostFader), 0);
  assert.equal(actual.get('p.0').vuPostFader, 0);
  assert.equal(vuValueToDB(0), -80); // Encoded meter floor, not proof of physical silence.
  assert.notEqual(actual.get('f.0').vuPostFaderL, actual.get('f.0').vuPostFaderR);
  assert.notEqual(actual.get('a.0').vuPostFader, actual.get('a.1').vuPostFader);
});

test('base64 accepts atob-compatible optional padding and bounded ASCII whitespace', () => {
  const partial = new Uint8Array(14); partial[0] = 1; partial[7] = 255; partial[10] = 0;
  const padded = frame(partial);
  assert.ok(padded.endsWith('='));
  assert.deepEqual(decodeVu2Frame(padded, 'ui24'), decodeVu2Frame(padded.replace(/=+$/, ''), 'ui24'));
  assert.deepEqual(decodeVu2Frame('3:::VU2^ \t' + padded.slice(8, 16) + '\n' + padded.slice(16) + '\r ', 'ui24'), decodeVu2Frame(padded, 'ui24'));
  assert.equal(decodeVu2Packet(new Uint8Array(8), 'ui24').size, 0);
  assert.deepEqual([...decodeVu2Frame(padded, 'ui24').keys()], ['i.0']);
});

test('unsupported model/type/nonfinite/invalid base64/oversize/truncation/trailers are rejected before indexing', () => {
  for (const model of [undefined, null, 'ui16', 'ui12', 'UI24', 'unknown']) assert.equal(decodeVu2Frame(fixture.frame, model), null);
  for (const packet of [undefined, [], [NaN], new Float64Array([NaN]), new DataView(new ArrayBuffer(8)), new Uint8Array(7), new Uint8Array(307)]) assert.equal(decodeVu2Packet(packet, 'ui24'), null);
  for (const text of [null, {}, fixture.frame.replace('3:::', ''), '3:::VU2^!!!!', '3:::VU2^A', '3:::VU2^====', fixture.frame + '^junk', fixture.frame + '=', '3:::VU2^' + 'A'.repeat(2000)]) assert.equal(decodeVu2Frame(text, 'ui24'), null);
  for (let index = 0; index < UI24_VU_LAYOUT.length; index++) {
    const invalid = bytes(); invalid[index] = UI24_VU_LAYOUT[index].count + 1;
    assert.equal(decodeVu2Packet(invalid, 'ui24'), null);
  }
  assert.equal(decodeVu2Packet(bytes().slice(0, -1), 'ui24'), null);
  assert.equal(decodeVu2Packet(new Uint8Array([...bytes(), 0]), 'ui24'), null);
  const emptyHeader = new Uint8Array(9); assert.equal(decodeVu2Packet(emptyHeader, 'ui24'), null);
});
