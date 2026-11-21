import { APP_VERSION } from './app-version.js';
// F09-S11: injected by Vite `define` at build/dev time. Plain node (tests) and
// any context without the definitions fall back to "unknown"; `typeof` on an
// undeclared global never throws.
export function buildInfo({ commit, time } = {}) {
  const injectedCommit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown';
  const injectedTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown';
  return Object.freeze({ version: APP_VERSION, commit: commit || injectedCommit, time: time || injectedTime });
}
