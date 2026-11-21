// F07-S05 (user decision 2026-11-21): ask to install MixMate as an app as soon as
// the browser offers it. A small non-modal strip (never a dialog, so automatic
// connection is not paused) in normal flow under the header: it takes a line of
// height and never overlays faders or the footer. Browsers require a user tap to
// call prompt(), so the event is only captured here and prompted from a click.
export const INSTALL_DISMISSED_KEY = 'mixmate-install-dismissed';
export const IOS_INSTRUCTION = 'To install: Share → Add to Home Screen';

export const ANDROID_INSTRUCTION = 'To install: open your browser menu (⋮) → Install app or Add to Home screen';
export const GENERIC_INSTRUCTION = "To install, use your browser's install or Add to Home screen option, if it has one";
// F07-S06: wait this long for beforeinstallprompt before showing menu instructions.
export const FALLBACK_DELAY_MS = 3000;

export function isInstalled({ window, navigator }) {
  try {
    if (navigator?.standalone === true) return true;
    const query = window?.matchMedia;
    return Boolean(query && (query.call(window, '(display-mode: standalone)').matches || query.call(window, '(display-mode: fullscreen)').matches));
  } catch { return false; }
}
export function isIOS({ navigator }) {
  const agent = String(navigator?.userAgent || '');
  // F07-S06 review: an Android agent is never iOS (Chrome device emulation on a Mac reports MacIntel + touch).
  if (/Android/.test(agent) || navigator?.userAgentData?.platform === 'Android') return false;
  return /iPad|iPhone|iPod/.test(agent) || (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1);
}

export function createInstallPrompt({ container, before = null, window = globalThis.window, navigator = globalThis.navigator, storage, onState = () => {}, timers = globalThis, fallbackDelay = FALLBACK_DELAY_MS }) {
  const document = container.ownerDocument;
  const make = (tag, className, text = '') => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node; };
  const strip = make('div', 'mm-install'), label = make('span', 'mm-install-text'), go = make('button', 'mm-install-go', 'Install MixMate'), dismissButton = make('button', 'mm-install-dismiss', '×');
  strip.hidden = true; strip.setAttribute('role', 'status'); go.type = 'button'; dismissButton.type = 'button'; go.dataset.action = 'install'; dismissButton.dataset.action = 'dismiss-install';
  // data-action keeps them enabled when the live view disables the buttons present at mount.
  dismissButton.setAttribute('aria-label', 'Dismiss install prompt'); dismissButton.setAttribute('title', 'Dismiss');
  strip.append(label, go, dismissButton);
  container.insertBefore(strip, before);
  const read = () => { try { return storage?.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch { return false; } };
  const write = value => { try { if (value) storage?.setItem(INSTALL_DISMISSED_KEY, '1'); else storage?.removeItem(INSTALL_DISMISSED_KEY); } catch { /* Per-device convenience only. */ } };
  let deferred = null, waited = false, prompted = false, timer = null, installed = isInstalled({ window, navigator }), dismissed = read(), destroyed = false, session = false;
  const ios = !installed && isIOS({ navigator });
  // F07-S06: Chrome fires beforeinstallprompt only when it deems the page installable and Brave never does,
  // so after the wait show menu instructions: Android text, a generic line on other touch devices, nothing
  // on a plain desktop (phone/tablet app; desktop browsers show their own install affordance).
  const menuText = (() => { const agent = String(navigator?.userAgent || ''); return (/Android/.test(agent) || navigator?.userAgentData?.platform === 'Android') ? ANDROID_INSTRUCTION : Number(navigator?.maxTouchPoints) > 0 ? GENERIC_INSTRUCTION : ''; })();
  // installed / installable / instructions (iOS) / menu (fallback) / unsupported
  const kind = () => installed ? 'installed' : deferred ? 'installable' : ios ? 'instructions' : waited && !prompted && menuText ? 'menu' : 'unsupported';
  const description = () => ({
    installed: 'Installed (running as an app)',
    installable: dismissed ? 'Installable (prompt dismissed)' : 'Installable',
    instructions: `Instructions: ${IOS_INSTRUCTION}${dismissed ? ' (dismissed)' : ''}`,
    menu: `Menu instructions: ${menuText}${dismissed ? ' (dismissed)' : ''}`,
    unsupported: 'Not offered by this browser (or already installed)',
  })[kind()];
  const paint = () => {
    const current = kind();
    const showing = !destroyed && !dismissed && !session && (current === 'installable' || current === 'instructions' || current === 'menu');
    strip.hidden = !showing; go.hidden = current !== 'installable'; go.disabled = false; dismissButton.disabled = false;
    label.textContent = current === 'installable' ? 'Install MixMate as an app' : current === 'instructions' ? IOS_INSTRUCTION : current === 'menu' ? menuText : '';
    try { onState({ kind: current, text: description(), dismissed, canShow: dismissed && (current === 'installable' || current === 'instructions' || current === 'menu') }); } catch { /* Display observer only. */ }
  };
  const stop = () => { if (timer !== null) { try { timers.clearTimeout(timer); } catch { /* Timer already gone. */ } timer = null; } };
  const onBefore = event => { event.preventDefault?.(); stop(); deferred = event; paint(); };
  const onInstalled = () => { stop(); deferred = null; installed = true; paint(); };
  const onGo = async () => {
    const event = deferred;
    if (!event || session) return;
    session = true; prompted = true; deferred = null; paint(); // A captured event can be prompted only once.
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome !== 'accepted') { dismissed = true; write(true); }
    } catch { /* Prompt refused; the page may offer it again on a later event. */ }
    session = false; paint();
  };
  const onDismiss = () => { dismissed = true; write(true); paint(); };
  window?.addEventListener?.('beforeinstallprompt', onBefore);
  window?.addEventListener?.('appinstalled', onInstalled);
  go.addEventListener('click', onGo); dismissButton.addEventListener('click', onDismiss);
  // One single timeout, no polling; not started when installed or on iOS (which already has instructions).
  if (!installed && !ios && menuText) { try { timer = timers.setTimeout(() => { timer = null; waited = true; paint(); }, fallbackDelay); } catch { timer = null; } }
  paint();
  return {
    strip, go, dismissButton, kind, description, refresh: paint,
    // Diagnostics "Show install prompt": forget the dismissal on this device.
    reshow() { dismissed = false; write(false); paint(); },
    destroy() { destroyed = true; stop(); window?.removeEventListener?.('beforeinstallprompt', onBefore); window?.removeEventListener?.('appinstalled', onInstalled); go.removeEventListener('click', onGo); dismissButton.removeEventListener('click', onDismiss); strip.remove(); },
  };
}
