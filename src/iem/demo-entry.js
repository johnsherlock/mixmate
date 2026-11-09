import { mountShell } from "./shell.js";
import { mountDemo } from "./demo-view.js";
import { prepareEntryOffline } from "./entry-offline.js";
const root = mountShell(document.getElementById("iem-root"), "demo");
mountDemo(root);
prepareEntryOffline(root.querySelector(".mm-offline-state"));
