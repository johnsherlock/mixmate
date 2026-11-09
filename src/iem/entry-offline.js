import {
  verifyOfflineCopy,
  currentEntryRequirements,
  observeOfflineUpdates,
} from "../offline.js";
export function prepareEntryOffline(element) {
  let attempt = 0,
    stop = () => {},
    waiting = false;
  let current = "Offline copy not verified";
  const paint = () => {
    element.textContent =
      current +
      (waiting
        ? " · Update downloaded; close all MixMate windows when finished."
        : "");
  };
  async function prepare() {
    const token = ++attempt;
    stop();
    if (!navigator.serviceWorker) {
      current = "Offline saving unavailable in this browser";
      paint();
      return;
    }
    try {
      const result = await verifyOfflineCopy({
        serviceWorker: navigator.serviceWorker,
        baseURI: document.baseURI,
        required: currentEntryRequirements(document),
        onRegistration: (registration) => {
          if (token !== attempt) return;
          stop = observeOfflineUpdates(registration, (value) => {
            if (token === attempt) {
              waiting = value;
              paint();
            }
          });
        },
      });
      if (token !== attempt) return;
      current = result.ready
        ? `Offline assets verified · ${result.version}`
        : "Offline copy not ready; reopen online to repair/update";
    } catch (error) {
      if (token !== attempt) return;
      current = `Offline copy not verified · ${error.message}`;
    }
    paint();
  }
  navigator.serviceWorker?.addEventListener("controllerchange", prepare);
  prepare();
}
