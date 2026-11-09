import { mountShell } from "./shell.js";
import { createEmptyLiveProvider } from "./live-provider.js";
import { mountReadOnlyView } from "./live-view.js";
import { prepareEntryOffline } from "./entry-offline.js";
const root = mountShell(document.getElementById("iem-root"), "live");
const provider = createEmptyLiveProvider(),
  view = mountReadOnlyView(root);
view.render(provider.snapshot());
const clear = () => {
  provider.clear();
  view.clear();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clear();
});
window.addEventListener("pagehide", clear);
prepareEntryOffline(root.querySelector(".mm-offline-state"));
