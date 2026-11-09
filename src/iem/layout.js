export function observeIemLayout(root, onLayout = () => {}) {
  function apply() {
    const portrait = matchMedia("(orientation:portrait)").matches;
    root.dataset.orientation = portrait ? "portrait" : "landscape";
    root.style.setProperty("--mm-height", innerHeight + "px");
    root.style.setProperty("--mm-travel", "220px");
    root.dataset.compact = String(!portrait && innerHeight <= 430);
    root.dataset.ultraCompact = String(!portrait && innerHeight < 320);
    onLayout();
  }
  const observer = new ResizeObserver(apply);
  observer.observe(root);
  window.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("resize", apply);
  document.addEventListener("fullscreenchange", apply);
  apply();
  return {
    apply,
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      document.removeEventListener("fullscreenchange", apply);
    },
  };
}
