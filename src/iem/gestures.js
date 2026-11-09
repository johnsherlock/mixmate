const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Reusable touch policy: track touches stay available for native scrolling.
// Only the cap captures a pointer; single track taps never change a value.
export function installFaderGestures(root, { onMasterEQ = () => {} } = {}) {
  const all = (selector) => [...root.querySelectorAll(selector)];
  let gesture = null,
    lastTap = null;
  const handlers = [];
  const listen = (type, callback) => {
    root.addEventListener(type, callback);
    handlers.push([type, callback]);
  };
  function cancel() {
    gesture = lastTap = null;
  }
  function sync() {
    for (const wrap of all(".mm-fader-control")) {
      const input = wrap.querySelector("input"),
        cap = wrap.querySelector(".mm-fader-hit");
      const ratio =
        (+input.value - +input.min) / (+input.max - +input.min || 1);
      if (input.classList.contains("mm-pan-large"))
        cap.style.left =
          8 +
          ratio * Math.max(0, input.getBoundingClientRect().width - 16) +
          "px";
      else {
        const thumb = input.dataset.eqParam ? 24 : 29;
        cap.style.top =
          thumb / 2 +
          (1 - ratio) *
            Math.max(0, input.getBoundingClientRect().height - thumb) +
          "px";
      }
    }
  }
  function prepare() {
    for (const input of all(
      "input.mm-vertical[data-channel],input.mm-vertical[data-group],input.mm-vertical[data-master],input.mm-vertical[data-eq-param],input.mm-pan-large",
    )) {
      if (input.parentElement.classList.contains("mm-fader-control")) continue;
      const wrap = root.ownerDocument.createElement("div");
      wrap.className =
        "mm-fader-control" +
        (input.classList.contains("mm-pan-large")
          ? " mm-fader-horizontal"
          : "");
      input.before(wrap);
      wrap.append(input);
      const cap = root.ownerDocument.createElement("span");
      cap.className = "mm-fader-hit";
      cap.setAttribute("aria-hidden", "true");
      wrap.append(cap);
    }
    sync();
  }
  function setValue(active, value) {
    const input = active.input,
      step = +input.step || 1;
    input.value = clamp(
      Math.round(value / step) * step,
      +input.min,
      +input.max,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sync();
  }
  listen("input", sync);
  listen("click", (event) => {
    if (event.target.closest(".mm-fader-control")) event.preventDefault();
  });
  listen("pointerdown", (event) => {
    const wrap = event.target.closest(".mm-fader-control");
    if (!wrap || event.button !== 0) {
      lastTap = null;
      return;
    }
    const input = wrap.querySelector("input");
    if (input.disabled) return;
    const cap = Boolean(event.target.closest(".mm-fader-hit"));
    gesture = {
      input,
      wrap,
      id: event.pointerId,
      cap,
      x: event.clientX,
      y: event.clientY,
      start: +input.value,
      time: performance.now(),
      moved: false,
    };
    if (cap) {
      wrap.setPointerCapture(event.pointerId);
      input.focus({ preventScroll: true });
      event.preventDefault();
    }
  });
  listen("pointermove", (event) => {
    const active = gesture;
    if (!active || active.id !== event.pointerId) return;
    if (
      !active.moved &&
      Math.hypot(event.clientX - active.x, event.clientY - active.y) < 8
    )
      return;
    active.moved = true;
    lastTap = null;
    if (!active.cap) return;
    const horizontal = active.input.classList.contains("mm-pan-large"),
      rect = active.input.getBoundingClientRect();
    const thumb = horizontal ? 16 : active.input.dataset.eqParam ? 24 : 29;
    const travel = Math.max(
      20,
      (horizontal ? rect.width : rect.height) - thumb,
    );
    setValue(
      active,
      active.start +
        ((horizontal ? event.clientX - active.x : active.y - event.clientY) /
          travel) *
          (+active.input.max - +active.input.min),
    );
  });
  listen("pointerup", (event) => {
    const active = gesture;
    if (!active || active.id !== event.pointerId) return;
    gesture = null;
    if (active.moved) {
      if (active.cap)
        active.input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (performance.now() - active.time > 450) {
      lastTap = null;
      return;
    }
    const now = performance.now(),
      previous = lastTap;
    if (
      previous &&
      previous.input === active.input &&
      previous.cap === active.cap &&
      now - previous.time < 380 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24
    ) {
      lastTap = null;
      if (active.cap && active.input.dataset.master !== undefined) {
        onMasterEQ(+active.input.dataset.master);
        return;
      }
      if (!active.cap) {
        const rect = active.input.getBoundingClientRect(),
          horizontal = active.input.classList.contains("mm-pan-large");
        const thumb = horizontal ? 16 : active.input.dataset.eqParam ? 24 : 29;
        const ratio = clamp(
          (horizontal
            ? event.clientX - rect.left - thumb / 2
            : rect.bottom - thumb / 2 - event.clientY) /
            Math.max(20, (horizontal ? rect.width : rect.height) - thumb),
          0,
          1,
        );
        setValue(
          active,
          +active.input.min + ratio * (+active.input.max - +active.input.min),
        );
        active.input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else
      lastTap = {
        input: active.input,
        cap: active.cap,
        time: now,
        x: event.clientX,
        y: event.clientY,
      };
  });
  listen("pointercancel", cancel);
  listen("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.target.disabled &&
      event.target.dataset?.master !== undefined
    ) {
      event.preventDefault();
      onMasterEQ(+event.target.dataset.master);
    }
  });
  return {
    prepare,
    sync,
    cancel,
    destroy() {
      cancel();
      for (const [type, callback] of handlers)
        root.removeEventListener(type, callback);
    },
  };
}
