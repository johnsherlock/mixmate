import { installFaderGestures } from "./gestures.js";
import { observeIemLayout } from "./layout.js";
import { startLocalClock } from "./clock.js";

// Neutral, keyed strip renderer for later received-state projections. Data never
// becomes markup, and changing a readout preserves inputs/caps and scroll state.
export function mountReadOnlyView(root) {
  const $ = (selector) => root.querySelector(selector),
    document = root.ownerDocument;
  const content = $(".mm-content"),
    strips = new Map();
  const empty = document.createElement("div");
  empty.className = "mm-empty";
  const heading = document.createElement("h2");
  heading.textContent = "Waiting for received AUX state";
  const detail = document.createElement("p");
  detail.textContent =
    "This read-only view has no mixer session yet. Use the connection test for the existing input experiment, or open Demo for simulated controls.";
  empty.append(heading, detail);
  const grid = document.createElement("div");
  grid.className = "mm-strip-grid";
  content.replaceChildren(empty, grid);
  for (const button of root.querySelectorAll("button")) {
    if (!["fullscreen", "overview"].includes(button.dataset.action))
      button.disabled = true;
  }
  $(".mm-navigation").hidden = false;
  $(".mm-local-tabs").hidden = false;
  $(".mm-snapshot-name").textContent = "Unavailable";
  $(".mm-desk").textContent = "No socket connection";
  $(".mm-feedback").textContent =
    "No mixer session. Use the connection test to check your desk.";
  $(".mm-dirty").textContent = "Read-only · no parameter writes";
  $(".mm-rec-state").textContent = "Recording status unavailable";
  const gestures = installFaderGestures(root);
  const layout = observeIemLayout(root, gestures.sync);
  const stopClock = startLocalClock($(".mm-clock"));
  function createStrip() {
    const article = document.createElement("article");
    article.className = "mm-strip mm-master";
    const head = document.createElement("div");
    head.className = "mm-strip-head";
    const name = document.createElement("button");
    name.className = "mm-strip-name";
    name.disabled = true;
    const description = document.createElement("span");
    description.className = "mm-strip-detail";
    head.append(name, description);
    const output = document.createElement("output");
    output.className = "mm-value";
    const space = document.createElement("div");
    space.className = "mm-fader-space";
    const scale = document.createElement("span");
    scale.className = "mm-ruler";
    scale.textContent = "LEVEL";
    const input = document.createElement("input");
    input.type = "range";
    input.className = "mm-vertical";
    input.min = "0";
    input.max = "1";
    input.step = "0.001";
    input.dataset.master = "";
    input.disabled = true;
    const meter = document.createElement("span");
    meter.className = "mm-meter-pair";
    meter.textContent = "—";
    meter.setAttribute("aria-label", "Meter unavailable");
    space.append(scale, input, meter);
    article.append(head, output, space);
    return { article, name, description, output, input };
  }
  function render(model) {
    $(".mm-mode-label").textContent = "READ-ONLY IEM";
    $(".mm-feedback").textContent = model.status;
    const ids = new Set(model.mixes.map((mix) => mix.id));
    for (const [id, strip] of strips)
      if (!ids.has(id)) {
        strip.article.remove();
        strips.delete(id);
      }
    for (const [index, mix] of model.mixes.entries()) {
      let strip = strips.get(mix.id);
      if (!strip) {
        strip = createStrip();
        strips.set(mix.id, strip);
        grid.append(strip.article);
      }
      if (grid.children[index] !== strip.article) grid.insertBefore(strip.article, grid.children[index] || null);
      strip.name.textContent = mix.name;
      strip.description.textContent = mix.detail;
      strip.output.textContent = mix.levelText ?? "—";
      strip.input.setAttribute(
        "aria-label",
        `${mix.name} received AUX level, read-only`,
      );
      const known =
        typeof mix.position === "number" &&
        Number.isFinite(mix.position) &&
        mix.position >= 0 &&
        mix.position <= 1;
      strip.article.dataset.unknown = String(!known);
      if (known) strip.input.value = String(mix.position);
    }
    empty.hidden = model.mixes.length > 0;
    gestures.prepare();
  }
  root.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="fullscreen"]')) {
      const app = $(".mm-app");
      if (document.fullscreenElement) document.exitFullscreen?.();
      else
        app.requestFullscreen?.().catch(() => {
          $(".mm-feedback").textContent =
            "Fullscreen unavailable; use the installed app.";
        });
    }
  });
  return {
    render,
    clear() {
      gestures.cancel();
      render({ status: "Not connected — no received mixer state", mixes: [] });
    },
    destroy() {
      gestures.destroy();
      layout.destroy();
      stopClock();
    },
  };
}
