import template from "./shell.html?raw";
import "./iem.css";
export function mountShell(container, mode) {
  container.innerHTML = template; // Trusted static shell only; never provider strings.
  const root = container.firstElementChild;
  root.dataset.mode = mode;
  root.querySelector(".mm-mode-label").textContent =
    mode === "demo"
      ? "DEMO · SIMULATED · NO MIXER CONNECTION"
      : "LIVE IEM · LEVELS OFF";
  return root;
}
