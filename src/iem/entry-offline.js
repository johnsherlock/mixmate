import {
  verifyOfflineCopy,
  currentEntryRequirements,
  observeOfflineUpdates,
  createOfflineVersionHistory,
  isOfflineVersion,
} from "../offline.js";
import { APP_VERSION } from "../app-version.js";

export const DEV_OFFLINE_TEXT = "Offline copy isn't available on the dev server (use npm run build + npm run preview)";
export function prepareEntryOffline(element, {
  document = globalThis.document,
  navigator = globalThis.navigator,
  storage,
  verify = verifyOfflineCopy,
  onPaint = () => {},
  updates,
  dev = import.meta.env?.DEV === true,
} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { /* Optional metadata only. */ }
  }
  const recordVersion = createOfflineVersionHistory(storage);
  let attempt = 0, stop = () => {}, waiting = false, updated = false, pending;
  let current = "Offline copy not verified";
  const paint = () => {
    element.textContent = `v${APP_VERSION} · ${current}${waiting ? updates ? " · Update ready" : " · Update waiting" : ""}`;
    element.title = waiting
      ? updates ? "Update downloaded. It applies automatically when no desk session, gesture, snapshot operation or dialog is active."
      : "Update downloaded. Close all MixMate windows/tabs when finished to activate it."
      : updated ? "MixMate updated. The current page and every offline asset are verified."
      : "The app version and verified offline asset version are separate.";
    try { onPaint(); } catch { /* Display observer only. */ }
  };
  async function prepare() {
    const token = ++attempt;
    stop(); waiting = false;
    if (dev) {
      // The Vite dev server has no generated worker; say so instead of a raw registration error.
      current = DEV_OFFLINE_TEXT;
      paint(); return;
    }
    if (!navigator.serviceWorker) {
      current = "Offline saving unavailable in this browser";
      paint(); return;
    }
    try {
      const result = await verify({
        serviceWorker: navigator.serviceWorker,
        baseURI: document.baseURI,
        required: currentEntryRequirements(document),
        onRegistration: registration => {
          if (token !== attempt) return;
          try { updates?.attach(registration); } catch { /* Update manager is optional. */ }
          stop = observeOfflineUpdates(registration, value => {
            if (token === attempt) { waiting = value; paint(); try { updates?.waiting(value); } catch { /* Optional. */ } }
          });
        },
      });
      if (token !== attempt) return;
      if (result.ready && isOfflineVersion(result.version)) {
        updated = recordVersion(result.version) || updated;
        current = `${updated ? "Updated" : "Offline ready"} · ${result.version}`;
      } else {
        updated = false;
        current = "Offline copy not ready; reopen online to repair/update";
      }
    } catch (error) {
      if (token !== attempt) return;
      updated = false;
      current = `Offline copy not verified · ${error.message}`;
    }
    paint();
  }
  const prepareCurrent = () => { pending = prepare(); };
  navigator.serviceWorker?.addEventListener("controllerchange", prepareCurrent);
  paint(); prepareCurrent();
  return {
    whenIdle: () => pending,
    destroy() { attempt++; stop(); navigator.serviceWorker?.removeEventListener("controllerchange", prepareCurrent); },
  };
}
