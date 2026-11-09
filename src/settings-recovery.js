import { emptySettings, validateSettings, SettingsVersionError } from './settings.js';

export const MAX_SETTINGS_BYTES = 8 * 1024 * 1024;
function boundedText(text) {
  if (typeof text !== 'string' || text.length > MAX_SETTINGS_BYTES || new TextEncoder().encode(text).length > MAX_SETTINGS_BYTES) {
    throw new Error('Settings backup must be 8 MiB or smaller.');
  }
  return text;
}
export function parseSettingsBackup(text) { return validateSettings(JSON.parse(boundedText(text))); }
export function settingsBackupText(settings) { return boundedText(JSON.stringify(validateSettings(settings), null, 2) + '\n'); }

function downloadBackup(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'mixmate-settings-v1.json';
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function summary(settings) {
  const groups = settings.profiles.reduce((count, profile) => count + profile.groups.length, 0);
  const selected = settings.profiles.find(profile => profile.id === settings.selectedProfileId);
  return `${settings.profiles.length} rigs · ${groups} groups\nSelected rig: ${selected?.name || 'None'}\nOrientation: ${settings.preferences.orientation} · Meters: ${settings.preferences.showMeters ? 'shown' : 'hidden'}\n` +
    settings.profiles.map(profile => `• ${profile.name} (${profile.address}) · ${profile.groups.length} groups`).join('\n');
}

// Local files only. Parsed settings cannot reach mixer state or a write facade.
export function mountSettingsRecovery({ repository, rigs, $, storageManager, download = downloadBackup }) {
  let ready = false, reading = false, attempt = 0, preview, pending = Promise.resolve(), protectionAttempt = 0;
  const feedback = text => { $('recovery-feedback').textContent = text; };
  function clearPreview() {
    preview = undefined;
    $('settings-preview').hidden = true;
    $('settings-preview-text').textContent = '';
    $('confirm-settings').disabled = true;
    $('import-settings-file').value = '';
  }
  function invalidate() {
    attempt++;
    if (preview || reading) { reading = false; clearPreview(); feedback('Settings changed. Choose a backup or Reset again to review the latest replacement.'); }
  }
  for (const [id, event] of [
    ['address', 'input'], ['rig-name', 'input'], ['rig-profile', 'change'],
    ['preferred-orientation', 'change'], ['show-meters', 'change'], ['new-rig', 'click'],
    ['save-rig', 'click'], ['delete-rig', 'click'], ['connect-form', 'submit'],
  ]) $(id).addEventListener(event, invalidate);

  clearPreview();
  const controls = ['export-settings', 'import-settings-file', 'reset-settings'];
  controls.forEach(id => { $(id).disabled = true; });
  rigs.ready.then(() => { ready = true; controls.forEach(id => { $(id).disabled = false; }); });

  $('export-settings').addEventListener('click', () => {
    if (!ready) return;
    try {
      download(settingsBackupText(rigs.snapshot()));
      const temporary = repository.snapshot().status.mode === 'memory';
      feedback(`Backup download requested.${temporary ? ' Includes temporary settings that are not saved on this device.' : ''} Save rig first to include uncommitted name/address edits. Nothing was uploaded.`);
    } catch { feedback('Could not start the settings backup download. Try again in your browser.'); }
  });
  function showPreview(candidate, kind) {
    preview = { candidate, kind, revision: rigs.revision() };
    const previous = rigs.snapshot();
    const status = repository.snapshot().status;
    const temporary = status.mode === 'memory' ? '\nStorage is unavailable or protected from overwrite: this applies temporary settings only; the existing stored record stays untouched.' : '';
    $('settings-preview-text').textContent =
      `${kind === 'reset' ? 'Reset' : 'Replace'} local settings? This removes ${previous.profiles.length} current rigs and their group definitions. Unsaved editor changes will be discarded.\n` +
      (kind === 'reset' ? 'Use empty rig/group lists and default display preferences.\n' : `Backup to apply:\n${summary(candidate)}\n`) +
      'MixMate will disconnect. No mixer settings change. App files, offline version history and other apps are kept.' + temporary;
    $('confirm-settings').textContent = kind === 'reset' ? 'Reset local settings' : 'Replace local settings';
    $('confirm-settings').disabled = false;
    $('settings-preview').hidden = false;
    feedback('Review the replacement, then confirm or cancel.');
  }
  $('import-settings-file').addEventListener('change', () => {
    if (!ready) return;
    const file = $('import-settings-file').files?.[0];
    const token = ++attempt, revision = rigs.revision();
    clearPreview();
    if (!file) return;
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SETTINGS_BYTES) {
      feedback('Choose a nonempty settings JSON file no larger than 8 MiB.'); return;
    }
    reading = true; feedback('Reading local backup…');
    pending = (async () => {
      try {
        const text = await file.text();
        if (token !== attempt || revision !== rigs.revision()) return;
        reading = false; showPreview(parseSettingsBackup(text), 'import');
      } catch (error) {
        if (token !== attempt || revision !== rigs.revision()) return;
        reading = false; feedback(error instanceof SettingsVersionError ? 'This backup uses an unsupported settings version. Nothing was changed.' : 'This is not a valid MixMate settings backup (JSON, allowed fields and 8 MiB limit required). Nothing was changed.');
      }
    })();
  });
  $('reset-settings').addEventListener('click', () => {
    if (!ready) return;
    attempt++; reading = false; clearPreview(); showPreview(emptySettings(), 'reset');
  });
  $('cancel-settings').addEventListener('click', () => {
    attempt++; reading = false; clearPreview(); feedback('Replacement cancelled. Nothing was changed.');
  });
  $('confirm-settings').addEventListener('click', () => {
    if (!preview || preview.revision !== rigs.revision()) { invalidate(); return; }
    const { candidate, kind } = preview, token = ++attempt;
    clearPreview();
    // This call disconnects, disarms and applies the local target before its
    // first asynchronous persistence step. Only status is handled afterwards.
    const operation = rigs.replaceSettings(candidate);
    feedback('Applying local settings…');
    pending = operation.completion.then(result => {
      if (token !== attempt || operation.revision !== rigs.revision()) return;
      feedback(result.status.mode === 'persistent' && result.status.state === 'saved'
        ? `${kind === 'reset' ? 'Local settings reset' : 'Backup imported'} and saved on this device. Connect explicitly when ready.`
        : `${kind === 'reset' ? 'Temporary defaults applied' : 'Backup applied temporarily'}. The stored record was not replaced. Export your settings before closing; see storage status above.`);
    }).catch(() => {
      if (token === attempt && operation.revision === rigs.revision()) feedback('Could not save the replacement. Check storage status and export a backup before closing.');
    });
  });

  function protectionText(value) {
    return value === true
      ? 'Storage protection is granted. Clearing site data can still remove settings and app files; keep a backup.'
      : 'Storage is not protected from automatic removal. The app is usable; keep a settings backup.';
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
      $('storage-protection-status').textContent = 'Storage protection status is unavailable. The app is usable; keep a settings backup.';
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
          $('storage-protection-status').textContent = 'Storage protection could not be requested. The app is usable; keep a settings backup.';
          $('protect-storage').disabled = false;
        }
      }
    })();
  });
  return { async whenIdle() { await pending; }, async protectionIdle() { await protectionReady; await protectionPending; } };
}
