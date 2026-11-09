import { validateSettings, settingsStatusText } from './settings.js';
import { mixerURL } from './protocol.js';

const LEGACY_ADDRESS = 'mixmate-address';
const DEFAULT_ADDRESS = '192.168.0.60';
function privateAddress(value) {
  const address = value.trim();
  mixerURL(address);
  return address;
}

// Only device-local definitions live here. Delayed storage work never changes a
// connection target; only explicit user actions can select another rig/address.
export function mountRigSettings({ repository, $, makeOption, onTargetChange, isConnected,
  storage, createID = () => globalThis.crypto.randomUUID(), confirmDelete = () => true }) {
  let settings, selectedID = null, ready = false, touched = false, revision = 0, pending = Promise.resolve();
  function setAddress(address) {
    $('address').value = address;
    $('address').setCustomValidity('');
  }
  let legacy;
  try { const value = storage?.getItem(LEGACY_ADDRESS); if (value) legacy = privateAddress(value); } catch { /* Optional legacy source. */ }
  // Resolve legacy migration only after knowing whether a durable record exists.
  setAddress(DEFAULT_ADDRESS);
  const controls = ['rig-profile', 'rig-name', 'new-rig', 'save-rig', 'delete-rig', 'preferred-orientation', 'show-meters'];
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
    const select = $('rig-profile');
    select.replaceChildren();
    if (!selectedID) select.add(makeOption('Temporary address — not saved as a rig', ''));
    for (const profile of settings.profiles) select.add(makeOption(profile.name, profile.id));
    select.value = selectedID || '';
    $('new-rig').disabled = settings.profiles.length >= 32;
    $('delete-rig').disabled = !selectedID;
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
  $('address').addEventListener('input', () => {
    targetChanged();
    feedback('Unsaved address draft. Save rig to keep it on this device.');
  });
  $('rig-name').addEventListener('input', () => {
    revision++;
    feedback('Unsaved rig draft. Save rig to keep these changes.');
  });
  $('rig-profile').addEventListener('change', () => {
    if (!ready) return;
    const profile = settings.profiles.find(item => item.id === $('rig-profile').value);
    if (!profile) return;
    targetChanged();
    setAddress(profile.address);
    $('rig-name').value = profile.name;
    feedback('');
    selectedID = profile.id;
    commit(draft => { draft.selectedProfileId = profile.id; });
  });
  $('new-rig').addEventListener('click', () => {
    if (!ready || settings.profiles.length >= 32) return;
    targetChanged();
    selectedID = null;
    setAddress(DEFAULT_ADDRESS);
    $('rig-name').value = '';
    feedback('New rig draft. Enter a name and address, then Save rig.');
    render();
    $('rig-name').focus();
  });
  $('save-rig').addEventListener('click', () => {
    if (!ready) return;
    try {
      const address = privateAddress($('address').value), name = $('rig-name').value.trim();
      const id = selectedID || createID();
      const existing = selectedID !== null;
      const change = draft => {
        if (existing) {
          const profile = draft.profiles.find(item => item.id === id);
          profile.name = name; profile.address = address;
        } else draft.profiles.push({ id, name, address, groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } });
        draft.selectedProfileId = id;
      };
      // Validation happens before changing the accepted local definitions.
      const candidate = structuredClone(settings); change(candidate); validateSettings(candidate);
      if (settings.profiles.find(profile => profile.id === selectedID)?.address !== address) targetChanged();
      else revision++;
      setAddress(address);
      $('rig-name').value = name;
      feedback('');
      selectedID = id;
      commit(change);
    } catch (error) { feedback(`Rig not saved. ${error.message}`); }
  });
  $('delete-rig').addEventListener('click', () => {
    if (!ready || !selectedID) return;
    const id = selectedID, profile = settings.profiles.find(item => item.id === id);
    if (!confirmDelete(profile.name)) return;
    targetChanged();
    const next = settings.profiles.find(item => item.id !== id);
    setAddress(next?.address || DEFAULT_ADDRESS);
    $('rig-name').value = next?.name || '';
    feedback(next ? '' : 'No saved rigs. Enter a name and Save rig to create one.');
    selectedID = next?.id || null;
    commit(draft => { draft.profiles = draft.profiles.filter(item => item.id !== id); draft.selectedProfileId = next?.id || null; });
  });
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
    const previous = settings.profiles.find(profile => profile.id === settings.selectedProfileId);
    if (!settings.profiles.length && !result.hasStoredSettings && !['corrupt-data', 'unsupported-version'].includes(result.status.reason)) {
      let address = legacy || DEFAULT_ADDRESS;
      if (touched) {
        try { address = privateAddress($('address').value); } catch { /* Preserve invalid draft without saving it. */ }
      }
      const profile = { id: createID(), name: 'My rig', address, groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } };
      settings.profiles.push(profile); settings.selectedProfileId = profile.id;
      selectedID = !touched && !isConnected() ? profile.id : null;
      if (selectedID) setAddress(profile.address);
      $('rig-name').value = selectedID ? profile.name : '';
      ready = true; render();
      if (!selectedID) feedback('Temporary address. Save it as a new rig or select a saved rig.');
      return save(draft => {
        if (!draft.profiles.length) { draft.profiles.push(structuredClone(profile)); draft.selectedProfileId = profile.id; }
      });
    }
    const applyTarget = !touched && !isConnected();
    const profile = applyTarget ? previous : undefined;
    selectedID = profile?.id || null;
    if (applyTarget) setAddress(profile?.address || DEFAULT_ADDRESS);
    $('rig-name').value = profile?.name || '';
    ready = true; render();
    if (!selectedID) feedback('Temporary address. Save it as a new rig or select a saved rig.');
  });
  return {
    ready: initialization,
    revision: () => revision,
    snapshot: () => ready ? validateSettings(settings) : undefined,
    async whenIdle() { await initialization; await pending; },
    // Apply target/identity changes synchronously. Promise completion may report
    // persistence only; it must never overwrite a later user draft or socket.
    replaceSettings(value) {
      if (!ready) throw new Error('Local settings are still loading.');
      const candidate = validateSettings(value);
      targetChanged();
      const token = revision;
      settings = candidate;
      const profile = candidate.profiles.find(item => item.id === candidate.selectedProfileId);
      selectedID = profile?.id || null;
      setAddress(profile?.address || DEFAULT_ADDRESS);
      $('rig-name').value = profile?.name || '';
      feedback(profile ? '' : 'No selected rig. Enter a name and Save rig to create one, or select a saved rig.');
      render();
      const completion = repository.replace(candidate);
      pending = completion.catch(error => {
        if (token === revision) feedback(`Settings were not saved. ${error.message}`);
      });
      return { revision: token, completion };
    },
  };
}
