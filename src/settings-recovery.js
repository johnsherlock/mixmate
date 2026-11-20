import { emptySettings } from './settings.js';

// F09-S08 (user decision 2026-11-20): settings export/import (backup files)
// was removed from every MixMate surface. Reset and storage protection remain;
// the settings repository's schema and v1 -> v2 read migration are unchanged.

// Local reset only. Replacement settings cannot reach mixer state or a write facade.
export function mountSettingsRecovery({ repository, rigs, $, storageManager }) {
  let ready = false, attempt = 0, preview, pending = Promise.resolve(), protectionAttempt = 0;
  const feedback = text => { $('recovery-feedback').textContent = text; };
  function clearPreview() {
    preview = undefined;
    $('settings-preview').hidden = true;
    $('settings-preview-text').textContent = '';
    $('confirm-settings').disabled = true;
  }
  function invalidate() {
    attempt++;
    if (preview) { clearPreview(); feedback('Settings changed. Choose Reset again to review the latest replacement.'); }
  }
  for (const [id, event] of [
    ['address', 'input'], ['rig-name', 'input'], ['rig-profile', 'change'],
    ['preferred-orientation', 'change'], ['show-meters', 'change'], ['new-rig', 'click'],
    ['save-rig', 'click'], ['delete-rig', 'click'], ['connect-form', 'submit'],
  ]) $(id).addEventListener(event, invalidate);

  clearPreview();
  const controls = ['reset-settings'];
  controls.forEach(id => { $(id).disabled = true; });
  rigs.ready.then(() => { ready = true; controls.forEach(id => { $(id).disabled = false; }); });

  function showPreview(candidate) {
    preview = { candidate, revision: rigs.revision() };
    const previous = rigs.snapshot();
    const status = repository.snapshot().status;
    const temporary = status.mode === 'memory' ? '\nStorage is unavailable or protected from overwrite: this applies temporary settings only; the existing stored record stays untouched.' : '';
    $('settings-preview-text').textContent =
      `Reset local settings? This removes ${previous.profiles.length} current rigs and all local group definitions. Unsaved editor changes will be discarded.\n` +
      'Use empty rig/group lists and default display preferences.\n' +
      'MixMate will disconnect. No mixer settings change. App files, offline version history and other apps are kept.' + temporary;
    $('confirm-settings').textContent = 'Reset local settings';
    $('confirm-settings').disabled = false;
    $('settings-preview').hidden = false;
    feedback('Review the replacement, then confirm or cancel.');
  }
  $('reset-settings').addEventListener('click', () => {
    if (!ready) return;
    attempt++; clearPreview(); showPreview(emptySettings());
  });
  $('cancel-settings').addEventListener('click', () => {
    attempt++; clearPreview(); feedback('Reset cancelled. Nothing was changed.');
  });
  $('confirm-settings').addEventListener('click', () => {
    if (!preview || preview.revision !== rigs.revision()) { invalidate(); return; }
    const { candidate } = preview, token = ++attempt;
    clearPreview();
    // This call disconnects, disarms and applies the local target before its
    // first asynchronous persistence step. Only status is handled afterwards.
    const operation = rigs.replaceSettings(candidate);
    feedback('Applying local settings…');
    pending = operation.completion.then(result => {
      if (token !== attempt || operation.revision !== rigs.revision()) return;
      feedback(result.status.mode === 'persistent' && result.status.state === 'saved'
        ? 'Local settings reset and saved on this device. Connect explicitly when ready.'
        : 'Temporary defaults applied. The stored record was not replaced; see storage status above.');
    }).catch(() => {
      if (token === attempt && operation.revision === rigs.revision()) feedback('Could not save the reset. Check storage status above.');
    });
  });

  function protectionText(value) {
    return value === true
      ? 'Storage protection is granted. Clearing site data can still remove settings and app files.'
      : 'Storage is not protected from automatic removal. The app is usable.';
  }
  async function checkProtection() {
    const token = ++protectionAttempt;
    try {
      if (typeof storageManager?.persisted !== 'function') throw new Error('Unavailable');
      const value = await storageManager.persisted();
      if (token !== protectionAttempt) return;
      $('storage-protection-status').textContent = protectionText(value);
      $('protect-storage').disabled = value === true || typeof storageManager?.persist !== 'function';
    } catch {
      if (token !== protectionAttempt) return;
      $('storage-protection-status').textContent = 'Storage protection status is unavailable. The app is usable.';
      $('protect-storage').disabled = typeof storageManager?.persist !== 'function';
    }
  }
  $('protect-storage').disabled = typeof storageManager?.persist !== 'function';
  const protectionReady = checkProtection(); // Read only; never request permission on startup.
  let protectionPending = Promise.resolve();
  $('protect-storage').addEventListener('click', () => {
    if (typeof storageManager?.persist !== 'function') return;
    const token = ++protectionAttempt;
    $('protect-storage').disabled = true;
    $('storage-protection-status').textContent = 'Requesting storage protection…';
    protectionPending = (async () => {
      try {
        const granted = await storageManager.persist();
        if (token === protectionAttempt) {
          $('storage-protection-status').textContent = protectionText(granted);
          $('protect-storage').disabled = granted === true;
        }
      } catch {
        if (token === protectionAttempt) {
          $('storage-protection-status').textContent = 'Storage protection could not be requested. The app is usable.';
          $('protect-storage').disabled = false;
        }
      }
    })();
  });
  return { async whenIdle() { await pending; }, async protectionIdle() { await protectionReady; await protectionPending; } };
}
