// Device-local definitions only. No mixer state or transport capability belongs here.
export const SETTINGS_VERSION = 1;
export const SETTINGS_DB = 'mixmate-settings';
const STORE = 'settings';
const KEY = 'current';
const clone = value => structuredClone(value);

export class SettingsValidationError extends Error {}
export class SettingsVersionError extends SettingsValidationError {}
class SettingsConflictError extends Error {}
const invalid = message => { throw new SettingsValidationError(message); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected a settings object.');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) invalid('Unknown or missing settings field.');
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('Settings must contain data, not accessors.');
    result[key] = descriptor.value;
  }
  return result;
}
function list(value, limit, map) {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) invalid('Invalid settings list.');
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) invalid('Settings lists must contain data.');
    result.push(map(descriptor.value));
  }
  return result;
}
function text(value, pattern, label) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !pattern.test(value)) invalid(`Invalid ${label}.`);
  return value;
}
const id = value => text(value, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'local ID');
const name = value => text(value, /^(?=.{1,80}$)[^\x00-\x1f\x7f]+$/u, 'name').trim() || invalid('Empty name.');
const sourceID = value => text(value, /^(?:i|l|p|f)\.(?:0|[1-9]\d{0,2})$/, 'source ID');
const mixID = value => value === null ? null : text(value, /^a\.(?:0|[1-9]\d{0,2})$/, 'mix ID');
function choice(value, choices) { if (!choices.includes(value)) invalid('Invalid preference.'); return value; }
function unique(items, key = item => item) {
  if (new Set(items.map(key)).size !== items.length) invalid('Duplicate settings identity.');
  return items;
}
function address(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) invalid('Invalid private IPv4 address.');
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(?:0|[1-9]\d{0,2})$/.test(part) || +part > 255)) invalid('Invalid private IPv4 address.');
  const [a, b] = parts.map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) invalid('Address must be private IPv4.');
  return value;
}
export function emptySettings() {
  return { version: SETTINGS_VERSION, profiles: [], selectedProfileId: null, preferences: { orientation: 'auto', showMeters: true } };
}

// Also the import/migration boundary for S03. There was no prior repository
// schema: absent data starts empty; unsupported old/new versions are preserved.
export function validateSettings(value) {
  // Recognize an unsupported envelope before checking fields from this version.
  const version = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'version') : null;
  if (version && 'value' in version && Number.isInteger(version.value) && version.value !== SETTINGS_VERSION) throw new SettingsVersionError('Unsupported settings version.');
  const data = record(value, ['version', 'profiles', 'selectedProfileId', 'preferences']);
  if (data.version !== SETTINGS_VERSION) throw new SettingsVersionError('Unsupported settings version.');
  const profiles = unique(list(data.profiles, 32, raw => {
    const profile = record(raw, ['id', 'name', 'address', 'groups', 'navigation']);
    const groups = unique(list(profile.groups, 64, rawGroup => {
      const group = record(rawGroup, ['id', 'name', 'members']);
      return { id: id(group.id), name: name(group.name), members: unique(list(group.members, 128, sourceID)) };
    }), group => group.id);
    const nav = record(profile.navigation, ['mixId', 'view', 'expandedGroupId']);
    const expandedGroupId = nav.expandedGroupId === null ? null : id(nav.expandedGroupId);
    if (expandedGroupId !== null && !groups.some(group => group.id === expandedGroupId)) invalid('Selected group does not exist.');
    return { id: id(profile.id), name: name(profile.name), address: address(profile.address), groups,
      navigation: { mixId: mixID(nav.mixId), view: choice(nav.view, ['groups', 'channels', 'eq']), expandedGroupId } };
  }), profile => profile.id);
  const selectedProfileId = data.selectedProfileId === null ? null : id(data.selectedProfileId);
  if (selectedProfileId !== null && !profiles.some(profile => profile.id === selectedProfileId)) invalid('Selected profile does not exist.');
  const preferences = record(data.preferences, ['orientation', 'showMeters']);
  if (typeof preferences.showMeters !== 'boolean') invalid('Invalid meter preference.');
  return { version: SETTINGS_VERSION, profiles, selectedProfileId,
    preferences: { orientation: choice(preferences.orientation, ['auto', 'portrait', 'landscape']), showMeters: preferences.showMeters } };
}

function openDatabase(factory, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    };
    const timer = setTimeout(() => finish(new DOMException('Storage timed out.', 'TimeoutError')), timeoutMs);
    let request;
    try { request = factory.open(SETTINGS_DB, 1); }
    catch (error) { finish(error); return; }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction.abort(); return; }
      request.result.createObjectStore(STORE);
    };
    request.onblocked = () => finish(new DOMException('Storage upgrade is blocked.', 'InvalidStateError'));
    request.onerror = () => finish(request.error);
    request.onsuccess = () => finish(null, request.result);
  });
}
function transaction(db, mode, value, timeoutMs, baseline) {
  return new Promise((resolve, reject) => {
    let tx, result, failure, settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      try { tx?.abort(); } catch { /* A committed transaction may no longer abort. */ }
      finish(new DOMException('Storage timed out.', 'TimeoutError'));
    }, timeoutMs);
    try {
      tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      request.onsuccess = () => {
        result = request.result;
        if (mode === 'readonly') return;
        try {
          const current = result === undefined ? undefined : validateSettings(result);
          if (JSON.stringify(current) !== JSON.stringify(baseline)) throw new SettingsConflictError('Settings changed in another window.');
          store.put(value, KEY);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => finish(); // Request success alone is not a saved commit.
      tx.onabort = () => finish(failure || tx.error || new DOMException('Storage transaction aborted.', 'AbortError'));
      tx.onerror = () => { /* The default abort reports the final failure above. */ };
    } catch (error) { finish(error); }
  });
}
function failureReason(error) {
  if (error instanceof SettingsConflictError) return 'conflict';
  if (error instanceof SettingsVersionError || error?.name === 'VersionError') return 'unsupported-version';
  if (error instanceof SettingsValidationError) return 'corrupt-data';
  if (error?.name === 'QuotaExceededError') return 'quota';
  if (error?.name === 'TimeoutError') return 'timeout';
  return 'unavailable';
}

export class SettingsRepository {
  #options; #db; #initialization; #queue = Promise.resolve(); #listeners = new Set(); #closed = false;
  #settings = emptySettings(); #baseline;
  #status = { mode: 'memory', state: 'loading', reason: null };
  constructor(options = {}) { this.#options = options; }
  snapshot() { return { settings: clone(this.#settings), status: { ...this.#status } }; }
  subscribe(listener) {
    this.#listeners.add(listener);
    this.#notify(listener);
    return () => this.#listeners.delete(listener);
  }
  #notify(listener) { try { listener(this.snapshot()); } catch { /* UI observers cannot fail a save. */ } }
  #emit(status) { this.#status = status; for (const listener of this.#listeners) this.#notify(listener); }
  #fallback(error) {
    this.#db?.close(); this.#db = null;
    this.#emit({ mode: 'memory', state: 'unsaved', reason: failureReason(error) });
  }
  initialize() {
    if (this.#closed) return Promise.reject(new Error('Settings repository closed.'));
    return this.#initialization ||= this.#initialize();
  }
  async #initialize() {
    try {
      const factory = Object.hasOwn(this.#options, 'indexedDB') ? this.#options.indexedDB : globalThis.indexedDB;
      if (!factory) throw new Error('IndexedDB unavailable.');
      const db = await openDatabase(factory, this.#options.timeoutMs ?? 3000);
      this.#db = db;
      db.onversionchange = () => this.#fallback(new DOMException('Storage version changed.', 'VersionError'));
      db.onclose = () => { if (this.#db === db) this.#fallback(new Error('Storage closed.')); };
      const stored = await transaction(db, 'readonly', undefined, this.#options.timeoutMs ?? 3000);
      if (stored !== undefined) {
        this.#settings = validateSettings(stored);
        this.#baseline = clone(this.#settings);
      }
      if (this.#db === db) this.#emit({ mode: 'persistent', state: 'ready', reason: null });
    } catch (error) { this.#fallback(error); }
    return this.snapshot();
  }
  // Every updater sees the previous queued result, not a stale UI snapshot.
  update(updater) {
    return this.#enqueue(async () => {
      await this.initialize();
      const draft = clone(this.#settings);
      const result = updater(draft);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        invalid('Settings updaters must be synchronous.');
      }
      return this.#save(validateSettings(draft));
    });
  }
  replace(value) {
    const validated = validateSettings(value); // Copy before caller can mutate it.
    return this.#enqueue(async () => { await this.initialize(); return this.#save(validated); });
  }
  #enqueue(work) {
    const next = this.#queue.then(() => {
      if (this.#closed) throw new Error('Settings repository closed.');
      return work();
    });
    this.#queue = next.catch(() => {});
    return next;
  }
  async #save(value) {
    this.#settings = value;
    if (!this.#db) {
      this.#emit({ ...this.#status }); // Notify memory changes, never claim saved.
      return this.snapshot();
    }
    this.#emit({ mode: 'persistent', state: 'saving', reason: null });
    try {
      const db = this.#db;
      await transaction(db, 'readwrite', value, this.#options.timeoutMs ?? 3000, this.#baseline);
      this.#baseline = clone(value);
      if (this.#db === db) this.#emit({ mode: 'persistent', state: 'saved', reason: null });
    } catch (error) { this.#fallback(error); }
    return this.snapshot();
  }
  async close() {
    await this.#queue;
    if (this.#initialization) await this.#initialization;
    this.#closed = true; this.#db?.close(); this.#db = null; this.#listeners.clear();
  }
}

export function settingsStatusText({ mode, state, reason }) {
  if (state === 'loading') return 'Checking local settings storage…';
  if (mode === 'memory') {
    const detail = { conflict: 'Settings changed in another window; its saved version was left untouched.', 'unsupported-version': 'Stored settings use an unsupported version and were left untouched.', 'corrupt-data': 'Stored settings could not be read and were left untouched.', quota: 'Device storage is full.', timeout: 'Device storage did not respond.' }[reason] || 'Device storage is unavailable.';
    return `${detail} Settings changes are temporary and will be lost when this app closes.`;
  }
  if (state === 'saving') return 'Saving settings on this device…';
  if (state === 'saved') return 'Settings saved on this device.';
  return 'Local settings storage is ready.';
}
