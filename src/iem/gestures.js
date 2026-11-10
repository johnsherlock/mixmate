const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Reusable touch policy: track touches stay available for native scrolling.
// Only the cap captures a pointer; single track taps never change a value.
export function installFaderGestures(root, { onMasterEQ = () => {}, onBegin, onCommit = () => {}, onCancel = () => {} } = {}) {
  const all = (selector) => [...root.querySelectorAll(selector)];
  let gesture = null,
    lastTap = null;
  const handlers = [];
  const listen = (type, callback) => {
    root.addEventListener(type, callback);
    handlers.push([type, callback]);
  };
  function cancel() {
    const active = gesture;
    gesture = lastTap = null;
    if (active?.cap) active.wrap.releasePointerCapture?.(active.id);
    if (active?.token) onCancel(active.input, active.token);
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
    if (gesture) cancel();
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
      gesture.token = onBegin ? onBegin(input) : true;
      if (!gesture?.token) { gesture = null; return; }
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
    if (active.cap) active.wrap.releasePointerCapture?.(active.id);
    if (active.input.disabled) { if (active.token) onCancel(active.input, active.token); return; }
    if (active.moved) {
      if (active.cap) {
        onCommit(active.input, active.token);
        active.input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (active.cap && active.token) onCancel(active.input, active.token);
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
        const token = onBegin ? onBegin(active.input) : true;
        if (!token) return;
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
        onCommit(active.input, token);
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
  listen("lostpointercapture", event => {
    // Normal pointerup releases capture after completing the gesture. Its loss
    // must preserve tap history for the accepted double-master-cap EQ action.
    if (gesture?.cap && gesture.id === event.pointerId) cancel();
  });
  listen("keydown", (event) => {
    if (onBegin && event.target.closest?.('.mm-fader-control')) {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
      const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
      if (!(event.key in direction) && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const input = event.target.closest('.mm-fader-control').querySelector('input');
      if (input.disabled) return;
      if (!gesture) {
        const token = onBegin(input);
        if (!token) return;
        gesture = { input, token, keyboard: true, cap: false };
      }
      if (!gesture.keyboard || gesture.input !== input) return;
      const value = event.key === 'Home' ? +input.min : event.key === 'End' ? +input.max : +input.value + direction[event.key] * (+input.step || 0.001);
      setValue(gesture, value);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.target.disabled &&
      event.target.dataset?.master !== undefined
    ) {
      event.preventDefault();
      onMasterEQ(+event.target.dataset.master);
    }
  });
  listen('keyup', event => {
    if (!gesture?.keyboard || gesture.input !== event.target) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const active = gesture; gesture = null;
    if (!active.input.disabled) { onCommit(active.input, active.token); active.input.dispatchEvent(new Event('change', { bubbles: true })); }
    else onCancel(active.input, active.token);
  });
  listen('focusout', event => { if (gesture?.input === event.target) cancel(); });
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
