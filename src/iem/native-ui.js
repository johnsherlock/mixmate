import { validPrivateAddress } from '../settings.js';

// F07-S04 (root decision 2026-11-21): the desk's own web UI cannot be embedded
// (MixMate's CSP blocks the frame and the HTTPS app would block HTTP content),
// so the header Native button is a user-triggered navigation to
// http://<validated private address>/ in a new tab. It sends nothing to the
// desk and never runs on load. The URL is built only from a validated private
// IPv4 address, never from free text.
export const NATIVE_NO_ADDRESS_REASON = 'Connect to the desk once so MixMate knows its address';
export function nativeUiUrl(address) {
  const valid = typeof address === 'string' ? validPrivateAddress(address) : null;
  return valid ? `http://${valid}/` : null;
}

export function mountNativeUi({ root, ui, window = globalThis.window }) {
  const button = root.querySelector('[data-action="native"]');
  let address = null, destroyed = false;
  const say = text => { if (ui.message) ui.message(text); else ui.log?.(text); };
  function paint() {
    const url = nativeUiUrl(address);
    if (button) {
      button.disabled = !url;
      button.setAttribute('title', url ? `Open the desk's own web app (${address}) in a new tab` : NATIVE_NO_ADDRESS_REASON);
    }
    ui.diagnostics?.nativeTarget?.(url);
  }
  function click() {
    if (destroyed) return;
    const url = nativeUiUrl(address);
    if (!url) return;
    let opened = null;
    try { opened = window.open(url, '_blank', 'noopener'); } catch { opened = null; }
    // The HTML spec makes a successful noopener open return null too, so null cannot mean blocked: hedge and always give the address.
    if (opened === null || opened === undefined) say(`Opened the desk's web app in a new tab. If it didn't appear, open ${url} yourself.`);
    else ui.log?.(`Opened the desk's web app at ${url}`);
  }
  button?.addEventListener('click', click);
  paint();
  return {
    setAddress(value) { const next = nativeUiUrl(value) ? value : null; if (next === address) return; address = next; paint(); },
    target: () => nativeUiUrl(address),
    destroy() { destroyed = true; button?.removeEventListener('click', click); },
  };
}
