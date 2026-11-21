// F07-S05 (user decision 2026-11-21): ask to install MixMate as an app as soon as
// the browser offers it. A small non-modal strip (never a dialog, so automatic
// connection is not paused) in normal flow under the header: it takes a line of
// height and never overlays faders or the footer. Browsers require a user tap to
// call prompt(), so the event is only captured here and prompted from a click.
export const INSTALL_DISMISSED_KEY = 'mixmate-install-dismissed';
export const IOS_INSTRUCTION = 'To install: Share → Add to Home Screen';

export function isInstalled({ window, navigator }) {
  try {
    if (navigator?.standalone === true) return true;
    const query = window?.matchMedia;
    return Boolean(query && (query.call(window, '(display-mode: standalone)').matches || query.call(window, '(display-mode: fullscreen)').matches));
  } catch { return false; }
}
export function isIOS({ navigator }) {
  const agent = String(navigator?.userAgent || '');
  return /iPad|iPhone|iPod/.test(agent) || (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1);
}

export function createInstallPrompt({ container, before = null, window = globalThis.window, navigator = globalThis.navigator, storage, onState = () => {} }) {
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
  let deferred = null, installed = isInstalled({ window, navigator }), dismissed = read(), destroyed = false, session = false;
  const ios = !installed && isIOS({ navigator });
  // installed / installable / instructions / unsupported
  const kind = () => installed ? 'installed' : deferred ? 'installable' : ios ? 'instructions' : 'unsupported';
  const description = () => ({
    installed: 'Installed (running as an app)',
    installable: dismissed ? 'Installable (prompt dismissed)' : 'Installable',
    instructions: `Instructions: ${IOS_INSTRUCTION}${dismissed ? ' (dismissed)' : ''}`,
    unsupported: 'Not offered by this browser (or already installed)',
  })[kind()];
  const paint = () => {
    const current = kind();
    const showing = !destroyed && !dismissed && !session && (current === 'installable' || current === 'instructions');
    strip.hidden = !showing; go.hidden = current !== 'installable'; go.disabled = false; dismissButton.disabled = false;
    label.textContent = current === 'installable' ? 'Install MixMate as an app' : current === 'instructions' ? IOS_INSTRUCTION : '';
    try { onState({ kind: current, text: description(), dismissed, canShow: dismissed && (current === 'installable' || current === 'instructions') }); } catch { /* Display observer only. */ }
  };
  const onBefore = event => { event.preventDefault?.(); deferred = event; paint(); };
  const onInstalled = () => { deferred = null; installed = true; paint(); };
  const onGo = async () => {
    const event = deferred;
    if (!event || session) return;
    session = true; deferred = null; paint(); // A captured event can be prompted only once.
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
  paint();
  return {
    strip, go, dismissButton, kind, description, refresh: paint,
    // Diagnostics "Show install prompt": forget the dismissal on this device.
    reshow() { dismissed = false; write(false); paint(); },
    destroy() { destroyed = true; window?.removeEventListener?.('beforeinstallprompt', onBefore); window?.removeEventListener?.('appinstalled', onInstalled); go.removeEventListener('click', onGo); dismissButton.removeEventListener('click', onDismiss); strip.remove(); },
  };
}
