import { validateSettings, settingsStatusText, promoteKnownAddress } from './settings.js';
import { mixerURL } from './protocol.js';

const LEGACY_ADDRESS = 'mixmate-address';
const DEFAULT_ADDRESS = '192.168.0.60';
function privateAddress(value) {
  const address = value.trim();
  mixerURL(address);
  return address;
}

// Connection-test settings (F02-S05, v3): known private addresses as address
// suggestions plus the IEM display preferences. Rigs are named by the desk's
// current snapshot in the live IEM app, so this page has no rig editor. Delayed
// storage work never changes a connection target or connects; only explicit
// user actions do. This page never records addresses (it does not verify Ui24
// AUX readiness) and never auto-connects.
export function mountRigSettings({ repository, $, onTargetChange, isConnected, storage, makeOption }) {
  let settings, ready = false, touched = false, revision = 0, pending = Promise.resolve();
  function setAddress(address) {
    $('address').value = address;
    $('address').setCustomValidity('');
  }
  let legacy;
  try { const value = storage?.getItem(LEGACY_ADDRESS); if (value) legacy = privateAddress(value); } catch { /* Optional legacy source. */ }
  // Resolve legacy migration only after knowing whether a durable record exists.
  setAddress(DEFAULT_ADDRESS);
  const controls = ['preferred-orientation', 'show-meters'];
  const feedback = message => { $('rig-feedback').textContent = message; };
  function cleanLegacy(status) {
    if (status.mode === 'persistent' && status.state === 'saved') {
      try { storage?.removeItem(LEGACY_ADDRESS); } catch { /* Never write to the old key again. */ }
    }
  }
  repository.subscribe(({ status }) => {
    $('settings-status').textContent = settingsStatusText(status);
    $('settings-status').dataset.state = status.state;
    $('settings-status').dataset.mode = status.mode;
    cleanLegacy(status);
  });
  function render() {
    for (const id of controls) $(id).disabled = !ready;
    if (!ready) return;
    const list = $('rig-address-suggestions');
    if (list && makeOption) {
      const options = settings.knownAddresses.length ? settings.knownAddresses : [DEFAULT_ADDRESS];
      list.replaceChildren(...options.map(value => makeOption('', value)));
    }
    $('preferred-orientation').value = settings.preferences.orientation;
    $('show-meters').checked = settings.preferences.showMeters;
  }
  function save(change, token = revision) {
    pending = repository.update(change).catch(error => {
      if (token === revision) feedback(`Settings were not saved. ${error.message}`);
    });
    return pending;
  }
  function commit(change) {
    const draft = structuredClone(settings);
    change(draft);
    settings = validateSettings(draft);
    render();
    return save(change);
  }
  function targetChanged() { touched = true; revision++; onTargetChange(); }
  $('connect-form').addEventListener('submit', () => { touched = true; revision++; });
  $('address').addEventListener('input', () => { targetChanged(); feedback(''); });
  function preferenceChanged() {
    if (!ready) return;
    revision++;
    try {
      const orientation = $('preferred-orientation').value, showMeters = $('show-meters').checked;
      commit(draft => { draft.preferences = { orientation, showMeters }; });
    } catch (error) { feedback(`Preference not saved. ${error.message}`); }
  }
  $('preferred-orientation').addEventListener('change', preferenceChanged);
  $('show-meters').addEventListener('change', preferenceChanged);
  render();
  const initialization = repository.initialize().then(result => {
    settings = result.settings;
    const applyTarget = !touched && !isConnected();
    if (!settings.knownAddresses.length && !result.hasStoredSettings && legacy && !['corrupt-data', 'unsupported-version'].includes(result.status.reason)) {
      settings.knownAddresses = [legacy];
      if (applyTarget) setAddress(legacy);
      ready = true; render();
      return save(draft => { if (!draft.knownAddresses.length) draft.knownAddresses = promoteKnownAddress(draft.knownAddresses, legacy); });
    }
    // A stored (even deliberately empty) record never revives the legacy address.
    if (applyTarget) setAddress(settings.knownAddresses[0] || DEFAULT_ADDRESS);
    ready = true; render();
  });
  return {
    ready: initialization,
    revision: () => revision,
    snapshot: () => ready ? validateSettings(settings) : undefined,
    async whenIdle() { await initialization; await pending; },
    // Apply target changes synchronously. Promise completion may report
    // persistence only; it must never overwrite a later user draft or socket.
    replaceSettings(value) {
      if (!ready) throw new Error('Local settings are still loading.');
      const candidate = validateSettings(value);
      targetChanged();
      const token = revision;
      settings = candidate;
      setAddress(candidate.knownAddresses[0] || DEFAULT_ADDRESS);
      feedback('');
      render();
      const completion = repository.replace(candidate);
      pending = completion.catch(error => {
        if (token === revision) feedback(`Settings were not saved. ${error.message}`);
      });
      return { revision: token, completion };
    },
  };
}
