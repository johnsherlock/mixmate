// F02-S05 (user decision 2026-11-20): one bounded automatic connection pass
// over the known private addresses, most recently successful first. Each
// attempt has a short deadline and succeeds only on received Ui24 AUX
// readiness (session phase `live`), never on socket-open. Attempts never
// overlap; a pass ends at the first success, on cancel, or after the last
// address. This module owns no socket and sends nothing itself: it only calls
// the explicit connect/disconnect functions it is given.
export const AUTO_CONNECT_ATTEMPT_MS = 5000;
const FAILED = new Set(['error', 'closed', 'timeout', 'blocked', 'unsupported', 'invalid', 'disconnected']);

export function createAutoConnect({ connect, disconnect, timers = globalThis, attemptMs = AUTO_CONNECT_ATTEMPT_MS,
  onSuccess = () => {}, onExhausted = () => {}, onProgress = () => {} }) {
  let pass = null, attempts = 0;
  function finishAttempt(attempt) {
    timers.clearTimeout(attempt.timer); attempt.timer = undefined;
    timers.clearTimeout(attempt.advance); attempt.advance = undefined;
  }
  function next(current) {
    if (pass !== current) return;
    if (current.attempt) finishAttempt(current.attempt);
    const index = current.attempt ? current.attempt.index + 1 : 0;
    if (index >= current.addresses.length) { pass = null; current.attempt = null; onExhausted({ reason: current.reason, tried: current.addresses.length }); return; }
    const attempt = { id: ++attempts, index, address: current.addresses[index], failed: false };
    current.attempt = attempt;
    onProgress({ reason: current.reason, address: attempt.address, index, total: current.addresses.length });
    attempt.timer = timers.setTimeout(() => {
      if (pass !== current || current.attempt !== attempt) return;
      attempt.failed = true; attempt.timer = undefined;
      disconnect(); // Retire the slow attempt before trying the next address.
      next(current);
    }, attemptMs);
    let started = false;
    try { started = connect(attempt.address) === true; } catch { started = false; }
    if (!started) fail(current, attempt);
  }
  // Failure is handled after the current call stack so a synchronous session
  // emission inside connect() can never advance (or nest) the pass twice.
  function fail(current, attempt) {
    if (attempt.failed || pass !== current || current.attempt !== attempt) return;
    attempt.failed = true;
    attempt.advance = timers.setTimeout(() => { attempt.advance = undefined; if (pass === current && current.attempt === attempt) next(current); }, 0);
  }
  return Object.freeze({
    // Starts one pass over a copy of the given list; false when one is running.
    start(addresses, reason = 'open') {
      if (pass) return false;
      const list = [...new Set(addresses || [])];
      pass = { reason, addresses: list, attempt: null };
      next(pass);
      return true;
    },
    // Fed every session snapshot phase by the owner.
    observe(phase) {
      const current = pass, attempt = current?.attempt;
      if (!attempt || attempt.failed) return;
      if (phase === 'live') { finishAttempt(attempt); pass = null; onSuccess({ reason: current.reason, address: attempt.address, index: attempt.index }); return; }
      if (FAILED.has(phase)) fail(current, attempt);
    },
    cancel() {
      if (!pass) return false;
      if (pass.attempt) finishAttempt(pass.attempt);
      pass = null; return true;
    },
    running: () => Boolean(pass),
    current: () => pass?.attempt ? { address: pass.attempt.address, index: pass.attempt.index, total: pass.addresses.length, reason: pass.reason } : null,
  });
}
