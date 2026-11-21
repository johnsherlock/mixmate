// F09-S11 (user decision 2026-11-21): the live entry has no banner under the
// header. Routine status keeps its existing text nodes (the live view writes
// them) inside a hidden sink that only the Diagnostics modal reads; the footer
// is the connection status button, one actionable message slot and the
// Diagnostics button. Demo keeps the full banner and footer.
export function tidyLive(root) {
  const $ = selector => root.querySelector(selector), make = (tag, className, text = "") => {
    const node = root.ownerDocument.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  const sink = make("div", "mm-diag-sink");
  sink.hidden = true;
  sink.append($(".mm-mode-label"), $(".mm-feedback"), $(".mm-offline-state"), $(".mm-dirty"), $(".mm-rec-state"), $(".mm-page-state"));
  $(".mm-preview").remove();
  // F07-S04: the live entry never shows the Demo's simulated native screen; the header Native button opens the desk's own web app in a new tab.
  $(".mm-native-layer")?.remove();
  const message = make("span", "mm-message");
  message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
  const diagnostics = make("button", "mm-diagnostics-open", "Diagnostics");
  diagnostics.type = "button";
  const desk = $(".mm-desk");
  desk.textContent = "Not connected"; desk.dataset.state = "idle";
  $(".mm-bottom").append(message, diagnostics, sink);
}
