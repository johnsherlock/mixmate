import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../docs/fixtures/f09-s04-recorder.js', import.meta.url), 'utf8');

function fixture() {
  let mono = 100, wall = 1_800_000_000_000, nextTimer = 1;
  const timers = new Map(), sockets = [], documentListeners = new Map();
  const returnValue = Object.freeze({ returned: true });
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; this.calls = []; this.delivered = []; this.closes = []; this.listeners = new Map(); sockets.push(this); }
    send(message) {
      this.calls.push(message);
      if (this.failure) throw this.failure;
      if (this.readyState === 1) this.delivered.push(message);
      return returnValue;
    }
    close(code, reason) { this.closes.push({ code, reason }); this.readyState = 2; }
    addEventListener(type, listener) { const list = this.listeners.get(type) ?? new Set(); list.add(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type, data) { for (const listener of this.listeners.get(type) ?? []) listener(data); }
  }
  const originalSend = FakeSocket.prototype.send;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const document = {
    body: {}, hidden: false, querySelector: () => null,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) { if (documentListeners.get(type) === listener) documentListeners.delete(type); },
  };
  let disconnected = false;
  const context = vm.createContext({
    window: {}, navigator: { userAgent: 'strict fake — no hardware' }, location: { href: 'http://fake.invalid/' },
    WebSocket: FakeSocket, Date: FakeDate, performance: { now: () => mono }, TextEncoder, document,
    MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context);
  return {
    context, diagnostic: context.window.__mmS04, FakeSocket, originalSend, returnValue, timers, documentListeners,
    clocks(nextMono, nextWall) { mono = nextMono; wall = nextWall; }, wall, mono,
    disconnected: () => disconnected,
  };
}

test('S04 recorder constructs no socket/send and forwards each owned call unchanged exactly once', () => {
  const f = fixture();
  assert.equal(f.diagnostic.sockets.length, 0);
  assert.equal(f.timers.size, 0);
  const socket = new f.FakeSocket('ws://fake.invalid/');
  assert.equal(socket.send('3:::INIT'), f.returnValue);
  const command = '3:::SETD^a.0.mix^0.3951953345';
  assert.equal(socket.send(command), f.returnValue);
  assert.deepEqual(socket.calls, ['3:::INIT', command]);
  assert.deepEqual(socket.delivered, socket.calls);
  assert.equal(f.diagnostic.dump().sockets[0].counts.parameter, 1);
  const failure = new Error('fake throw, delivery unknown');
  socket.failure = failure;
  assert.throws(() => socket.send(command), error => error === failure);
  assert.equal(socket.calls.length, 3);
  assert.equal(f.diagnostic.dump().events.filter(event => event.type === 'threw').length, 1);
});

test('S04 recorder captures real caret/newline framing and rejects oversized UTF-8 frames', () => {
  const f = fixture(), socket = new f.FakeSocket('ws://fake.invalid/');
  socket.send('3:::INIT');
  socket.emit('message', { data: '3:::SETS^model^ui24\nSETD^a.0.mix^0.3961953345\nSETD^i.1.aux.1.pan^0.7609890109' });
  assert.deepEqual(Array.from(f.diagnostic.dump().receipts, row => [row.path, row.raw]), [
    ['model', 'ui24'], ['a.0.mix', '0.3961953345'], ['i.1.aux.1.pan', '0.7609890109'],
  ]);
  socket.emit('message', { data: '😀'.repeat(32_769) });
  assert.equal(f.diagnostic.dump().skipped, 1);
  assert.equal(f.diagnostic.dump().receipts.length, 3);
  for (let index = 0; index < 1000; index++) socket.emit('message', { data: '3:::SETD^a.0.mix^0.4' });
  assert.equal(f.diagnostic.dump().receipts.length, 1000);
  assert.equal(f.diagnostic.dump().overflow, 3);
});

test('S04 watchdog keeps the first deadline across sockets and closes without manufacturing sends', () => {
  const f = fixture(), first = new f.FakeSocket('ws://fake.invalid/');
  first.send('3:::INIT');
  const deadline = f.diagnostic.deadline;
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 180_000);
  first.readyState = 3;
  f.clocks(f.mono + 20_000, f.wall + 20_000);
  const second = new f.FakeSocket('ws://fake.invalid/');
  second.send('3:::INIT');
  assert.equal(f.diagnostic.deadline, deadline);
  assert.equal(f.timers.size, 1);
  f.clocks(deadline, f.wall + 180_000);
  [...f.timers.values()][0].callback();
  assert.equal(second.closes.length, 1);
  assert.equal(second.closes[0].code, 1000);
  assert.deepEqual(second.calls, ['3:::INIT']);
  assert.deepEqual(first.calls, ['3:::INIT']);
});

test('S04 send-entry elapsed guard closes before forwarding a late owned call unchanged', () => {
  for (const wallExpired of [false, true]) {
    const f = fixture(), socket = new f.FakeSocket('ws://fake.invalid/');
    socket.send('3:::INIT');
    f.clocks(wallExpired ? f.mono : f.diagnostic.deadline, wallExpired ? f.wall + 180_000 : f.wall);
    const command = '3:::SETD^a.0.mix^0.395';
    socket.send(command);
    assert.equal(socket.closes.length, 1);
    assert.deepEqual(socket.calls, ['3:::INIT', command]);
    assert.deepEqual(socket.delivered, ['3:::INIT']);
    assert.equal(f.diagnostic.dump().sockets[0].counts.parameter, 1); // Count is attempted forwarding, not network application.
  }
});

test('S04 cleanup restores instrumentation after explicit owned socket closure without reconnecting', () => {
  const f = fixture(), socket = new f.FakeSocket('ws://fake.invalid/');
  socket.send('3:::INIT');
  socket.close(1000, 'explicit fake cleanup'); socket.readyState = 3;
  const dump = f.diagnostic.cleanup();
  assert.equal(dump.sockets[0].readyState, 3);
  assert.equal(f.FakeSocket.prototype.send, f.originalSend);
  assert.equal(f.timers.size, 0);
  assert.equal(f.documentListeners.size, 0);
  assert.equal(f.disconnected(), true);
  assert.equal([...socket.listeners.values()].every(list => list.size === 0), true);
  assert.deepEqual(socket.calls, ['3:::INIT']);
});
