import {
  verifyOfflineCopy,
  currentEntryRequirements,
  observeOfflineUpdates,
  createOfflineVersionHistory,
  isOfflineVersion,
} from "../offline.js";
import { APP_VERSION } from "../app-version.js";

export function prepareEntryOffline(element, {
  document = globalThis.document,
  navigator = globalThis.navigator,
  storage,
  verify = verifyOfflineCopy,
} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { /* Optional metadata only. */ }
  }
  const recordVersion = createOfflineVersionHistory(storage);
  let attempt = 0, stop = () => {}, waiting = false, updated = false, pending;
  let current = "Offline copy not verified";
  const paint = () => {
    element.textContent = `v${APP_VERSION} · ${current}${waiting ? " · Update waiting" : ""}`;
    element.title = waiting
      ? "Update downloaded. Close all MixMate windows/tabs when finished to activate it."
      : updated ? "MixMate updated. The current page and every offline asset are verified."
      : "The app version and verified offline asset version are separate.";
  };
  async function prepare() {
    const token = ++attempt;
    stop(); waiting = false;
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
          stop = observeOfflineUpdates(registration, value => {
            if (token === attempt) { waiting = value; paint(); }
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
