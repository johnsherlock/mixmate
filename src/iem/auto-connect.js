// F02-S05 (user decision 2026-11-20): one bounded automatic connection pass
// over the known private addresses, most recently successful first. Each
// attempt has a short deadline and succeeds only on full received Ui24
// readiness (the owner reports `ready`), never on socket-open or a partially
// opened control session. Attempts never overlap; a pass ends at the first
// success, on cancel, or after the last address. While `canAdvance()` is false
// (for example another dialog is open) the pass pauses instead of starting,
// retiring or replacing an attempt, and `resume()` continues it. This module
// owns no socket and sends nothing itself: it only calls the explicit
// connect/disconnect functions it is given.
export const AUTO_CONNECT_ATTEMPT_MS = 5000;
const FAILED = new Set(['error', 'closed', 'timeout', 'blocked', 'unsupported', 'invalid', 'disconnected']);

export function createAutoConnect({ connect, disconnect, timers = globalThis, attemptMs = AUTO_CONNECT_ATTEMPT_MS,
  canAdvance = () => true, onSuccess = () => {}, onExhausted = () => {}, onProgress = () => {} }) {
  let pass = null, attempts = 0;
  function finishAttempt(attempt) {
    timers.clearTimeout(attempt.timer); attempt.timer = undefined;
    timers.clearTimeout(attempt.advance); attempt.advance = undefined;
  }
  function next(current) {
    if (pass !== current) return;
    if (!canAdvance()) { current.paused = current.paused || 'advance'; return; }
    current.paused = null;
    if (current.attempt) finishAttempt(current.attempt);
    const index = current.attempt ? current.attempt.index + 1 : 0;
    if (index >= current.addresses.length) { pass = null; current.attempt = null; onExhausted({ reason: current.reason, tried: current.addresses.length }); return; }
    const attempt = { id: ++attempts, index, address: current.addresses[index], failed: false };
    current.attempt = attempt;
    onProgress({ reason: current.reason, address: attempt.address, index, total: current.addresses.length });
    attempt.timer = timers.setTimeout(() => {
      if (pass !== current || current.attempt !== attempt) return;
      attempt.failed = true; attempt.timer = undefined;
      // Never retire an attempt behind an open dialog; resume() does it later.
      if (!canAdvance()) { current.paused = 'timeout'; return; }
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
      pass = { reason, addresses: list, attempt: null, paused: null };
      next(pass);
      return true;
    },
    // Fed by the owner with the current phase and whether the session is fully ready.
    observe(phase, ready = phase === 'live') {
      const current = pass, attempt = current?.attempt;
      if (!attempt) return;
      if (ready && (!attempt.failed || current.paused === 'timeout')) { finishAttempt(attempt); pass = null; onSuccess({ reason: current.reason, address: attempt.address, index: attempt.index }); return; }
      if (!attempt.failed && FAILED.has(phase)) fail(current, attempt);
    },
    // Continue a paused pass once advancing is allowed again.
    resume() {
      const current = pass;
      if (!current?.paused || !canAdvance()) return false;
      const reason = current.paused; current.paused = null;
      if (reason === 'timeout') disconnect();
      next(current);
      return true;
    },
    cancel() {
      if (!pass) return false;
      if (pass.attempt) finishAttempt(pass.attempt);
      pass = null; return true;
    },
    running: () => Boolean(pass),
    paused: () => Boolean(pass?.paused),
    current: () => pass?.attempt ? { address: pass.attempt.address, index: pass.attempt.index, total: pass.addresses.length, reason: pass.reason } : null,
  });
}
