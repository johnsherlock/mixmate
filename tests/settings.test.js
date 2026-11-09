import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SettingsRepository, SETTINGS_DB, emptySettings, validateSettings, SettingsValidationError, SettingsVersionError, settingsStatusText } from '../src/settings.js';

function fixture() {
  return { version: 1, selectedProfileId: 'rig-a', preferences: { orientation: 'portrait', showMeters: true }, profiles: [
    { id: 'rig-a', name: 'Rehearsal', address: '192.168.0.60', groups: [
      { id: 'guitars', name: 'Guitars', members: ['i.5', 'i.3', 'f.0', 'l.0', 'p.1'] },
    ], navigation: { mixId: 'a.0', view: 'groups', expandedGroupId: 'guitars' } },
  ] };
}
function open(factory, version = 1, upgrade = db => db.createObjectStore('settings')) {
  return new Promise((resolve, reject) => {
    const request = factory.open(SETTINGS_DB, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function seed(factory, data, version = 1) {
  const db = await open(factory, version);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(data, 'current');
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function stored(factory, version = 1) {
  const db = await open(factory, version);
  const data = await new Promise((resolve, reject) => {
    const tx = db.transaction('settings');
    const request = tx.objectStore('settings').get('current');
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  });
  db.close(); return data;
}
// Fault injection keeps real IDB requests/transactions; only a selected write is
// aborted or denied. No mixer transport or browser globals are installed.
function faultFactory(factory, fail) {
  return { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result, original = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = original(...args);
        if (args[1] === 'readwrite') fail(tx);
        return tx;
      };
    });
    return request;
  } };
}

test('first-open schema upgrade starts empty without writes; committed settings survive reopen', async () => {
  const factory = new IDBFactory(), repo = new SettingsRepository({ indexedDB: factory });
  const events = [];
  repo.subscribe(value => events.push(value.status.state));
  try {
    assert.deepEqual((await repo.initialize()).settings, emptySettings());
    assert.equal(await stored(factory), undefined); // Initialization does not invent rig/group definitions.
    const saved = await repo.replace(fixture());
    assert.deepEqual(saved.status, { mode: 'persistent', state: 'saved', reason: null });
    assert.deepEqual(events, ['loading', 'ready', 'saving', 'saved']);
  } finally { await repo.close(); }
  const reopened = new SettingsRepository({ indexedDB: factory });
  try {
    const result = await reopened.initialize();
    assert.deepEqual(result.settings, fixture());
    assert.equal(result.status.mode, 'persistent');
    assert.deepEqual(result.settings.profiles[0].groups[0].members, ['i.5', 'i.3', 'f.0', 'l.0', 'p.1']);
  } finally { await reopened.close(); }
});

test('read/replace/update/subscription boundaries do not expose mutable internal references', async () => {
  const factory = new IDBFactory(), repo = new SettingsRepository({ indexedDB: factory });
  try {
    const input = fixture(), pending = repo.replace(input);
    input.profiles[0].name = 'Changed outside';
    const output = await pending;
    output.settings.profiles[0].groups[0].members.reverse();
    repo.snapshot().settings.profiles.length = 0;
    repo.subscribe(event => { event.settings.profiles.length = 0; event.status.state = 'fake'; });
    let captured;
    await repo.update(draft => { captured = draft; draft.preferences.showMeters = false; });
    captured.profiles[0].name = 'Changed after update';
    const expected = fixture(); expected.preferences.showMeters = false;
    assert.deepEqual(repo.snapshot().settings, expected);
    assert.deepEqual(await stored(factory), expected);
    assert.equal(repo.snapshot().status.state, 'saved');
  } finally { await repo.close(); }
});

test('queued updates preserve the latest prior revision and recover after validation/updater rejection', async () => {
  const factory = new IDBFactory(), repo = new SettingsRepository({ indexedDB: factory });
  try {
    const first = repo.replace(fixture());
    const bad = repo.update(draft => { draft.liveLevel = 0.5; });
    const second = repo.update(draft => { draft.profiles[0].name += ' two'; });
    const third = repo.update(draft => { draft.profiles[0].name += ' three'; draft.preferences.showMeters = false; });
    await first; await assert.rejects(bad, SettingsValidationError); await second; await third;
    assert.equal((await stored(factory)).profiles[0].name, 'Rehearsal two three');
    assert.equal(repo.snapshot().settings.preferences.showMeters, false);
    await assert.rejects(repo.update(() => { throw new Error('editor cancelled'); }), /cancelled/);
    await assert.rejects(repo.update(async draft => { draft.profiles[0].name = 'Not accepted'; }), /synchronous/);
    assert.equal(repo.snapshot().status.state, 'saved');
  } finally { await repo.close(); }
});

test('whitelist rejects live state, unknown fields, invalid addresses, duplicates and unsafe object shapes', () => {
  const cases = [
    value => { value.state = { 'i.0.mix': 0.8 }; },
    value => { value.profiles[0].levels = [0.8]; },
    value => { value.profiles[0].groups[0].meter = 0.5; },
    value => { value.preferences.armed = true; },
    value => { value.profiles[0].address = '8.8.8.8'; },
    value => { value.profiles[0].address = '192.168.0.60\n'; },
    value => { value.profiles[0].groups[0].members[0] = 'i.5\n'; },
    value => { value.profiles[0].address = '192.168.00.60'; },
    value => { value.profiles[0].address = '192.168.0.60/path'; },
    value => { value.profiles[0].address = '172.32.0.1'; },
    value => { value.profiles[0].address = '10.256.0.1'; },
    value => { value.profiles.push(value.profiles[0]); },
    value => { value.profiles[0].groups[0].members.push('i.5'); },
    value => { value.profiles[0].groups[0].members.push('i.0.mix'); },
    value => { value.selectedProfileId = 'missing'; },
    value => { value.profiles[0].navigation.expandedGroupId = 'missing'; },
    value => { value.preferences.showMeters = 'true'; },
    value => { value.profiles[0].name = ' '; },
    value => { value.profiles[0].name = 'x'.repeat(81); },
    value => { value.profiles[0].groups[0].members = Array(2); },
    value => { value.profiles[0].groups[0].members.extra = 'oops'; },
    value => { Object.setPrototypeOf(value.preferences, { hidden: true }); },
  ];
  for (const change of cases) { const value = fixture(); change(value); assert.throws(() => validateSettings(value), SettingsValidationError); }
  let getterCalls = 0;
  const accessor = fixture(); Object.defineProperty(accessor.preferences, 'showMeters', { enumerable: true, get() { getterCalls++; return true; } });
  assert.throws(() => validateSettings(accessor), SettingsValidationError);
  const arrayAccessor = fixture(); Object.defineProperty(arrayAccessor.profiles, '0', { get() { getterCalls++; return fixture().profiles[0]; } });
  assert.throws(() => validateSettings(arrayAccessor), SettingsValidationError);
  assert.equal(getterCalls, 0);
  const injected = JSON.parse(JSON.stringify(fixture()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}'));
  assert.throws(() => validateSettings(injected), SettingsValidationError);
  assert.equal({}.polluted, undefined);
});

test('valid settings preserve user text as inert data and only private IPv4 profiles are accepted', () => {
  for (const address of ['10.0.0.1', '172.16.0.60', '172.31.255.255', '192.168.1.60']) {
    const data = fixture(); data.profiles[0].address = address;
    data.profiles[0].name = '<img src=x onerror=alert(1)>';
    assert.deepEqual(validateSettings(data), data);
  }
});

test('corrupt or unsupported stored schemas remain untouched; fallback changes stay memory-only', async () => {
  for (const data of [{ version: 9, secretFutureState: true }, { ...fixture(), version: 2 }, { ...fixture(), version: 0 }, { ...fixture(), profiles: 'corrupt' }]) {
    const factory = new IDBFactory(); await seed(factory, data);
    const repo = new SettingsRepository({ indexedDB: factory });
    try {
      const result = await repo.initialize();
      assert.equal(result.status.mode, 'memory');
      assert.equal(result.status.reason, data.profiles === 'corrupt' ? 'corrupt-data' : 'unsupported-version');
      assert.deepEqual(result.settings, emptySettings());
      const changed = await repo.replace(fixture());
      assert.equal(changed.status.state, 'unsaved');
      assert.match(settingsStatusText(changed.status), /left untouched.*temporary/);
      assert.deepEqual(await stored(factory), data);
    } finally { await repo.close(); }
  }
});

test('unknown database versions are preserved rather than deleted or downgraded', async () => {
  const factory = new IDBFactory(); await seed(factory, fixture(), 2);
  const repo = new SettingsRepository({ indexedDB: factory });
  try {
    const result = await repo.initialize();
    assert.equal(result.status.reason, 'unsupported-version');
    await repo.replace(emptySettings());
    assert.deepEqual(await stored(factory, 2), fixture());
  } finally { await repo.close(); }
});

test('missing/denied IndexedDB, blocked opens and timed-out opens are observable without claiming saved', async () => {
  for (const options of [
    { indexedDB: undefined },
    { indexedDB: { open() { throw new DOMException('Denied', 'SecurityError'); } } },
    { indexedDB: { open() { const request = {}; queueMicrotask(() => request.onblocked()); return request; } } },
    { indexedDB: { open() { return {}; } }, timeoutMs: 5 },
  ]) {
    const repo = new SettingsRepository(options), states = [];
    repo.subscribe(value => states.push(value.status.state));
    try {
      assert.equal((await repo.initialize()).status.mode, 'memory');
      await repo.replace(fixture());
      assert.equal(repo.snapshot().settings.selectedProfileId, 'rig-a');
      assert.equal(repo.snapshot().status.state, 'unsaved');
      assert.ok(!states.includes('saved'));
      assert.match(settingsStatusText(repo.snapshot().status), /temporary/);
    } finally { await repo.close(); }
  }
});

test('transaction abort after request success never reports saved and leaves last committed data intact', async () => {
  const factory = new IDBFactory(); await seed(factory, fixture());
  const injected = faultFactory(factory, tx => {
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = (...args) => {
      const store = objectStore(...args), put = store.put.bind(store);
      store.put = (...args) => { const request = put(...args); request.addEventListener('success', () => tx.abort()); return request; };
      return store;
    };
  });
  const repo = new SettingsRepository({ indexedDB: injected }), states = [];
  repo.subscribe(value => states.push(value.status.state));
  try {
    await repo.initialize();
    await repo.update(draft => { draft.profiles[0].name = 'Unsaved change'; });
    assert.equal(repo.snapshot().settings.profiles[0].name, 'Unsaved change');
    assert.equal(repo.snapshot().status.state, 'unsaved');
    assert.deepEqual(states, ['loading', 'ready', 'saving', 'unsaved']);
    assert.deepEqual(await stored(factory), fixture());
  } finally { await repo.close(); }
});

test('quota failures surface an actionable temporary-state message and never overwrite committed settings', async () => {
  const factory = new IDBFactory(); await seed(factory, fixture());
  const injected = faultFactory(factory, tx => {
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = (...args) => {
      const store = objectStore(...args);
      store.put = () => { throw new DOMException('Full', 'QuotaExceededError'); };
      return store;
    };
  });
  const repo = new SettingsRepository({ indexedDB: injected });
  try {
    await repo.initialize();
    const result = await repo.update(draft => { draft.preferences.showMeters = false; });
    assert.equal(result.status.reason, 'quota');
    assert.match(settingsStatusText(result.status), /storage is full.*temporary/);
    assert.deepEqual(await stored(factory), fixture());
    await repo.update(draft => { draft.profiles[0].name = 'Still usable'; });
    assert.equal(repo.snapshot().settings.profiles[0].name, 'Still usable');
  } finally { await repo.close(); }
});

test('database version changes close the repository connection and disallow future persistent saves', async () => {
  const factory = new IDBFactory(), repo = new SettingsRepository({ indexedDB: factory });
  try {
    await repo.replace(fixture());
    const upgraded = await open(factory, 2, () => {}); upgraded.close();
    assert.equal(repo.snapshot().status.mode, 'memory');
    await repo.update(draft => { draft.profiles[0].name = 'Temporary'; });
    assert.deepEqual(await stored(factory, 2), fixture());
    assert.equal(repo.snapshot().status.state, 'unsaved');
  } finally { await repo.close(); }
});

test('closing rejects further mutations and initialization; unsupported import versions are explicit', async () => {
  const repo = new SettingsRepository({ indexedDB: new IDBFactory() });
  await repo.initialize(); await repo.close();
  await assert.rejects(repo.update(() => {}), /closed/);
  await assert.rejects(repo.initialize(), /closed/);
  assert.throws(() => validateSettings({ ...emptySettings(), version: 2 }), SettingsVersionError);
});


test('memory fallback subscribers receive each edit and can unsubscribe without affecting storage', async () => {
  const repo = new SettingsRepository({ indexedDB: null }), names = [];
  const unsubscribe = repo.subscribe(({ settings, status }) => {
    if (settings.profiles.length) names.push([settings.profiles[0].name, status.state]);
  });
  try {
    await repo.replace(fixture());
    await repo.update(draft => { draft.profiles[0].name = 'Temporary edit'; });
    unsubscribe();
    await repo.update(draft => { draft.profiles[0].name = 'Unobserved'; });
    assert.deepEqual(names, [['Rehearsal', 'unsaved'], ['Temporary edit', 'unsaved']]);
  } finally { await repo.close(); }
});

test('connection invalidation between request success and transaction completion cannot announce ready or saved', async () => {
  for (const phase of ['readonly', 'readwrite']) {
    const factory = new IDBFactory(); await seed(factory, fixture());
    const wrapped = { open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const db = request.result, transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
          if (args[1] === phase) tx.objectStore = (...args) => {
            const store = objectStore(...args), operation = phase === 'readonly' ? 'get' : 'put', original = store[operation].bind(store);
            store[operation] = (...args) => {
              const request = original(...args);
              request.addEventListener('success', () => db.onversionchange());
              return request;
            };
            return store;
          };
          return tx;
        };
      });
      return request;
    } };
    const repo = new SettingsRepository({ indexedDB: wrapped }), states = [];
    repo.subscribe(({ status }) => states.push(status.state));
    try {
      await repo.initialize();
      await repo.update(draft => { draft.preferences.showMeters = false; });
      assert.equal(repo.snapshot().status.mode, 'memory');
      assert.equal(repo.snapshot().status.state, 'unsaved');
      if (phase === 'readonly') assert.ok(!states.includes('ready'));
      assert.ok(!states.includes('saved'));
    } finally { await repo.close(); }
  }
});


test('atomic stale-baseline guard preserves another window commit and retains the conflicting local draft', async () => {
  for (const replacement of [false, true]) {
    const factory = new IDBFactory(); await seed(factory, fixture());
    const a = new SettingsRepository({ indexedDB: factory }), b = new SettingsRepository({ indexedDB: factory });
    try {
      await Promise.all([a.initialize(), b.initialize()]);
      const saved = await a.update(draft => { draft.profiles[0].name = 'Saved in A'; });
      assert.equal(saved.status.state, 'saved');
      let conflict;
      if (replacement) {
        const imported = fixture(); imported.profiles[0].name = 'Imported in B';
        conflict = await b.replace(imported);
      } else conflict = await b.update(draft => { draft.profiles[0].name = 'Edited in B'; });
      assert.equal(conflict.status.mode, 'memory');
      assert.equal(conflict.status.state, 'unsaved');
      assert.equal(conflict.status.reason, 'conflict');
      assert.equal(conflict.settings.profiles[0].name, replacement ? 'Imported in B' : 'Edited in B');
      assert.match(settingsStatusText(conflict.status), /another window.*left untouched.*temporary/);
      assert.equal((await stored(factory)).profiles[0].name, 'Saved in A');
      await b.update(draft => { draft.profiles[0].name = 'Still temporary'; });
      assert.equal((await stored(factory)).profiles[0].name, 'Saved in A');
      await a.update(draft => { draft.preferences.showMeters = false; });
      assert.equal(a.snapshot().status.state, 'saved'); // Its own durable baseline advances on commit.
    } finally { await a.close(); await b.close(); }
    const reopened = new SettingsRepository({ indexedDB: factory });
    try {
      assert.equal((await reopened.initialize()).settings.profiles[0].name, 'Saved in A');
    } finally { await reopened.close(); }
  }
});

test('simultaneous first-save repositories cannot both replace the same empty baseline', async () => {
  const factory = new IDBFactory(), a = new SettingsRepository({ indexedDB: factory }), b = new SettingsRepository({ indexedDB: factory });
  try {
    await Promise.all([a.initialize(), b.initialize()]);
    const other = fixture(); other.profiles[0].name = 'Other';
    const results = await Promise.all([a.replace(fixture()), b.replace(other)]);
    assert.equal(results.filter(result => result.status.state === 'saved').length, 1);
    assert.equal(results.filter(result => result.status.reason === 'conflict').length, 1);
  } finally { await a.close(); await b.close(); }
});
