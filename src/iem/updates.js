// F07-S05 (user decision 2026-11-21, replaces "no forced update/reload during a
// session"): the live entry updates itself whenever a new worker has finished
// installing, but only when nothing the user could lose is in progress. It sends
// no mixer message and owns no socket.
export const UPDATE_APPLIED_KEY = 'mixmate-update-applied';
export const UPDATE_NOTICE_KEY = 'mixmate-update-notice';
export const UPDATE_RELOAD_AT_KEY = 'mixmate-update-reload-at';
export const RELOAD_BACKSTOP_MS = 10000;
export const updatedMessage = info => `Updated to v${info.version} (${info.commit}).`;
export const READY_TEXT = 'Update ready — applies when you disconnect';

// Busy = anything an automatic reload could interrupt or discard:
// - a desk session past socket open (connected / partial / live, qualified or not);
// - an owned gesture or a pending/dispatching control send;
// - a snapshot operation (the desk is mid-request, or this UI is tracking one);
// - any dialog except the idle Connect dialog.
// An attempt that is still only `connecting` (for example an automatic pass whose
// address does not answer on this network) has no state to lose: reloading simply
// restarts the automatic pass in the new page, so it does not defer an update.
// The Connect dialog while no session is active holds only a typed address.
export function updateBusy({ session, dialogOwner, snapshotControls }) {
  const snapshot = session.snapshot();
  if (['connected', 'partial', 'live'].includes(snapshot.phase)) return true;
  const control = snapshot.control;
  if (control && (control.gestureActive || control.pending || control.dispatching)) return true;
  if (snapshot.snapshots?.operation?.status === 'pending') return true;
  if (snapshotControls?.pending?.()) return true;
  const lease = dialogOwner?.active?.();
  return Boolean(lease && lease.kind !== 'connection');
}

export function createUpdateManager({
  serviceWorker, window = globalThis.window, document = globalThis.document, storage, busy = () => false, reload, onState = () => {},
  MessageChannelClass = globalThis.MessageChannel, timers = globalThis, now = () => Date.now(), replyMs = 3000, applyMs = 10000,
}) {
  const reloadPage = reload || (() => window.location.reload());
  let registration = null, waiting = false, applying = false, activated = false, phase = 'none', destroyed = false, announced = false;
  let hadController = Boolean(serviceWorker?.controller), replyTimer, applyTimer, text = 'No update waiting';
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key, value) => { try { if (!storage) return false; storage.setItem(key, value); return true; } catch { return false; } };
  const emit = (nextPhase, nextText, extra = {}) => { phase = nextPhase; text = nextText; try { onState({ phase, text, ...extra }); } catch { /* Display observer only. */ } };
  const clearTimers = () => { timers.clearTimeout(replyTimer); timers.clearTimeout(applyTimer); replyTimer = applyTimer = undefined; };

  function check() {
    if (destroyed || !registration?.update) return;
    // No other network fetch: update() only revalidates the worker script.
    try { Promise.resolve(registration.update()).catch(() => {}); } catch { /* Offline or no registration. */ }
  }
  function doReload() {
    // Backstop beside the per-version guard: never reload twice within seconds.
    const last = Number(read(UPDATE_RELOAD_AT_KEY));
    if (Number.isFinite(last) && last > 0 && now() - last < RELOAD_BACKSTOP_MS) { activated = false; emit('manual', 'Update installed. Reload MixMate to use it.'); return; }
    if (!write(UPDATE_NOTICE_KEY, '1') || !write(UPDATE_RELOAD_AT_KEY, String(now()))) { activated = false; emit('manual', 'Update installed. Reload MixMate to use it.'); return; }
    activated = false; emit('applying', 'Updating…');
    reloadPage();
  }
  function apply() {
    const worker = registration?.waiting;
    if (!worker || applying) return;
    const previous = read(UPDATE_APPLIED_KEY);
    // Without working session storage the loop guard cannot be kept: stay manual.
    if (!write(UPDATE_RELOAD_AT_KEY, read(UPDATE_RELOAD_AT_KEY) || '0')) { emit('manual', 'Update ready — close all MixMate windows and reopen to apply'); return; }
    applying = true; emit('applying', 'Updating…');
    let channel;
    try { channel = new MessageChannelClass(); } catch { applying = false; emit('manual', 'Update ready — close all MixMate windows and reopen to apply'); return; }
    const finish = () => { channel.port1.onmessage = null; try { channel.port1.close(); } catch { /* Already closed. */ } };
    channel.port1.onmessage = ({ data }) => {
      timers.clearTimeout(replyTimer); finish();
      if (data?.applied === true && typeof data.version === 'string' && write(UPDATE_APPLIED_KEY, data.version)) {
        // The worker is skipping waiting; controllerchange then reloads once this page is idle.
        applyTimer = timers.setTimeout(() => { applyTimer = undefined; if (applying && !activated) { applying = false; emit('manual', 'Update ready — close all MixMate windows and reopen to apply'); } }, applyMs);
        applyTimer?.unref?.();
      } else { applying = false; emit('manual', 'Update installed but not applied automatically. Close all MixMate windows and reopen.'); }
    };
    replyTimer = timers.setTimeout(() => { replyTimer = undefined; finish(); applying = false; emit('manual', 'Update ready — close all MixMate windows and reopen to apply'); }, replyMs);
    replyTimer?.unref?.();
    try { worker.postMessage({ type: 'APPLY_UPDATE', previous }, [channel.port2]); }
    catch { timers.clearTimeout(replyTimer); finish(); applying = false; emit('manual', 'Update ready — close all MixMate windows and reopen to apply'); }
  }
  function evaluate() {
    if (destroyed || phase === 'manual') return;
    if (!activated && !(waiting && !applying)) return;
    if (busy()) {
      if (phase !== 'ready') { emit('ready', READY_TEXT, { announce: !announced }); announced = true; }
      return;
    }
    if (activated) doReload(); else apply();
  }
  const onControllerChange = () => {
    // A first install claiming this page is not an update; a replaced controller is.
    if (!hadController) { hadController = true; return; }
    clearTimers(); activated = true; applying = false; evaluate();
  };
  const onOnline = () => check();
  const onVisible = () => { if (document?.visibilityState === 'visible') check(); };
  serviceWorker?.addEventListener?.('controllerchange', onControllerChange);
  window?.addEventListener?.('online', onOnline);
  document?.addEventListener?.('visibilitychange', onVisible);
  return {
    // Called with each registration of the current page (initially and after
    // controllerchange re-preparation); an update check runs once per registration.
    attach(next) { const fresh = registration !== next; registration = next; if (fresh) check(); },
    waiting(value) { waiting = Boolean(value); if (waiting) evaluate(); else if (phase === 'ready' && !activated) emit('none', 'No update waiting'); },
    // Re-evaluate when the busy condition may have changed (session/dialog events).
    evaluate,
    check,
    // True once after an automatic update reload (sessionStorage flag).
    consumeNotice() { const value = read(UPDATE_NOTICE_KEY) === '1'; if (value) { try { storage.removeItem(UPDATE_NOTICE_KEY); } catch { /* Best effort. */ } } return value; },
    state: () => ({ phase, text }),
    destroy() { destroyed = true; clearTimers(); serviceWorker?.removeEventListener?.('controllerchange', onControllerChange); window?.removeEventListener?.('online', onOnline); document?.removeEventListener?.('visibilitychange', onVisible); },
  };
}
