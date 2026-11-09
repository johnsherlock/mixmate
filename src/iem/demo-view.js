import { sample, freq, logFreq, hz, cuts, paramGain } from "./demo-eq.js";
import { createDemoProvider } from "./demo-provider.js";
import { installFaderGestures } from "./gestures.js";
import { startLocalClock } from "./clock.js";

// Accepted prototype interactions, isolated from all live/session modules.
export function mountDemo(root) {
  const listeners = [];
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push([target, type, callback]);
  };
  const $ = (s) => root.querySelector(s),
    $$ = (s) => [...root.querySelectorAll(s)];
  const provider = createDemoProvider();
  const {
    names,
    mixColours,
    channels,
    addresses,
    clone,
    clamp,
    smooth,
    desks,
  } = provider;
  let activeDesk = 0,
    availability = "Desk A",
    aux = -1,
    mode = "groups",
    expanded = null,
    drawMode = false,
    recording = false,
    recordSeconds = 0,
    dirty = false;
  let editor = null,
    panTarget = null,
    previousFocus = null,
    eqDrag = null,
    drawLast = null,
    selectedBand = 1,
    graphObserver = null;
  const design = {
    orientation: "Auto",
    landscapeHeight: 360,
    stripHeight: 220,
    showMeters: true,
    availableDesk: "Desk A",
  };
  function current() {
    return desks[activeDesk ?? 0];
  }
  function mix() {
    return current().mixes[aux < 0 ? 0 : aux];
  }
  function groups() {
    return current().groups;
  }
  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function db(v) {
    return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
  }
  function panLabel(v) {
    return v === 0
      ? "PAN · CENTRE"
      : `PAN · ${v < 0 ? "L" : "R"} ${Math.abs(v)}`;
  }
  function feedback(s) {
    $(".mm-feedback").textContent = s;
  }
  function modified() {
    dirty = true;
    $(".mm-dirty").textContent = "Snapshot · unsaved";
    $(".mm-snapshot").dataset.dirty = "true";
  }
  function remember() {} // Demo navigation is deliberately session-local.
  function meter(i, stereo = true) {
    return `<div class="mm-meter-pair" aria-label="Simulated signal level"><span class="mm-clip ${i === 7 ? "mm-hot" : ""}" aria-label="${i === 7 ? "Clipping held" : "No clipping"}"></span>${provider
      .meterLevels(i)
      .slice(0, stereo ? 2 : 1)
      .map((v) => `<div class="mm-meter"><i style="--level:${v}%"></i></div>`)
      .join("")}</div>`;
  }
  function ruler(min = -60, max = 10) {
    const values =
      min === -60 && max === 10 ? [10, 0, -12, -24, -40, -60] : [max, 0, min];
    return `<div class="mm-ruler">${values.map((v) => `<span style="top:${((max - v) / (max - min || 1)) * 100}%">${v > 0 ? "+" : ""}${Math.round(v)}</span>`).join("")}</div>`;
  }
  function masterStrip(i) {
    const m = current().mixes[i];
    return `<article class="mm-strip mm-master" style="--mm-strip-color:${mixColours[i]}"><div class="mm-strip-head"><button class="mm-strip-name" data-open-aux="${i}">${esc(m.name)}</button><span class="mm-strip-detail">AUX ${i * 2 + 1}/${i * 2 + 2} · STEREO</span></div><output class="mm-value" data-master-value="${i}">${db(m.master)}</output><div class="mm-fader-space">${ruler()}<input class="mm-vertical" type="range" min="-60" max="10" step="0.5" value="${m.master}" data-master="${i}" aria-keyshortcuts="Enter" aria-description="Drag to change level. Double tap or press Enter to open AUX EQ." aria-label="${esc(m.name)} AUX master level" />${meter(i)}</div></article>`;
  }
  function bounds(g) {
    const m = mix(),
      off = m.offsets[g] || 0,
      levels = groups()[g].members.map((i) => m.levels[i] - off);
    return levels.length
      ? {
          min: Math.max(...levels.map((v) => -60 - v)),
          max: Math.min(...levels.map((v) => 10 - v)),
        }
      : { min: 0, max: 0 };
  }
  function groupStrip(g) {
    const group = groups()[g],
      b = bounds(g),
      off = mix().offsets[g] || 0;
    return `<article class="mm-strip mm-group"><div class="mm-strip-head"><button class="mm-strip-name" data-expand="${g}">${esc(group.name)} ${expanded === g ? "−" : "+"}</button>${expanded === g ? '<span class="mm-group-master-label">GROUP MASTER</span>' : ""}<span class="mm-strip-detail">${group.members.length} send${group.members.length === 1 ? "" : "s"} · relative dB</span></div><output class="mm-value" data-group-value="${g}">${db(off)}</output><div class="mm-fader-space">${ruler(b.min, b.max)}<input class="mm-vertical" type="range" min="${b.min}" max="${b.max}" step="0.5" value="${off}" data-group="${g}" aria-label="${esc(group.name)} relative AUX send level" ${!group.members.length ? "disabled" : ""} />${meter(g, false)}</div><span class="mm-limit" data-group-limit="${g}">${off >= b.max - 0.05 ? "UPPER LIMIT" : off <= b.min + 0.05 ? "LOWER LIMIT" : ""}</span></article>`;
  }
  function channelStrip(i, native = false) {
    const m = mix();
    return `<article class="mm-strip mm-channel"><div class="mm-strip-head"><button class="mm-strip-name" data-pan="${i}" ${native ? "disabled" : ""}>${esc(channels[i])}</button><span class="mm-strip-detail">${i < 24 ? i + 1 : `FX ${i - 23}`} · AUX SEND</span></div><output class="mm-value" data-channel-value="${i}">${db(m.levels[i])}</output><div class="mm-fader-space">${ruler()}<input class="mm-vertical" type="range" min="-60" max="10" step="0.5" value="${m.levels[i]}" data-channel="${i}" aria-label="${esc(channels[i])} AUX send level" ${native ? "disabled" : ""} />${meter(i, i === 4 || i === 5)}</div><button class="mm-pan-button" data-pan="${i}" ${native ? "disabled" : ""}>${panLabel(m.pans[i])}</button></article>`;
  }
  function render() {
    gestures.cancel();
    graphObserver?.disconnect();
    root.dataset.auxView = String(aux >= 0);
    root.style.setProperty("--mm-mix-color", mixColours[aux] || "#e1d067");
    $(".mm-mix-tabs").innerHTML = "";
    $(".mm-navigation").hidden = aux < 0;
    $(".mm-group-switches").hidden = aux < 0;
    $(".mm-group-switches").innerHTML =
      aux >= 0
        ? groups()
            .map(
              (g, i) =>
                `<button data-jump-group="${i}" class="${mode === "groups" && i === expanded ? "mm-active" : ""}">${esc(g.name)}</button>`,
            )
            .join("") +
          `<button data-mode="channels" class="${mode === "channels" ? "mm-active" : ""}">All Channels</button>`
        : "";
    $(".mm-home").classList.toggle("mm-active", aux < 0);
    $(".mm-title").textContent = aux < 0 ? "" : names[aux];
    $(".mm-kicker").textContent =
      aux < 0 ? "FIVE STEREO PAIRS" : `AUX ${aux * 2 + 1}/${aux * 2 + 2}`;
    $(".mm-local-tabs").hidden = aux < 0;
    $(".mm-collapse").hidden = true;
    $$("[data-mode]").forEach((b) =>
      b.classList.toggle("mm-active", b.dataset.mode === mode),
    );
    $(".mm-page-state").textContent =
      aux < 0
        ? "Five stereo masters"
        : mode === "eq"
          ? "AUX output tone"
          : mode === "channels" || expanded !== null
            ? "Swipe channels ↔"
            : "";
    $(".mm-desk").textContent =
      activeDesk === null
        ? "○ No desk · connect"
        : `● Desk ${activeDesk ? "B" : "A"} · ${addresses[activeDesk]}`;
    if (aux < 0)
      $(".mm-content").innerHTML = `<div class="mm-strip-grid">${current()
        .mixes.map((m, i) => masterStrip(i))
        .join("")}</div>`;
    else if (mode === "eq") renderEQ();
    else {
      const strips =
        mode === "channels"
          ? channels.map((n, i) => channelStrip(i)).join("")
          : expanded === null
            ? groups()
                .map((g, i) => groupStrip(i))
                .join("")
            : groupStrip(expanded) +
              groups()
                [expanded].members.map((i) => channelStrip(i))
                .join("");
      $(".mm-content").innerHTML =
        `<div class="mm-sends-layout ${mode === "groups" && expanded !== null ? "mm-no-master" : ""}"><div class="mm-sends-main"><div class="mm-strip-scroll ${expanded !== null ? "mm-expanded" : ""}">${strips}</div></div>${mode === "groups" && expanded !== null ? "" : `<aside class="mm-pinned" aria-label="Current AUX master">${masterStrip(aux)}</aside>`}</div>`;
    }
    applyDesign();
    prepareFaders();
  }
  function applyDesign() {
    const portrait = matchMedia("(orientation:portrait)").matches;
    root.dataset.orientation = portrait ? "portrait" : "landscape";
    root.style.setProperty("--mm-height", innerHeight + "px");
    root.style.setProperty("--mm-travel", design.stripHeight + "px");
    root.dataset.compact = String(!portrait && innerHeight <= 430);
    root.dataset.ultraCompact = String(!portrait && innerHeight < 320);
    $$(".mm-meter-pair").forEach(
      (el) => (el.style.visibility = design.showMeters ? "visible" : "hidden"),
    );
    if (mode === "eq" && aux >= 0) requestAnimationFrame(paintEQ);
  }
  listen(window, "resize", applyDesign);
  if (window.visualViewport)
    listen(window.visualViewport, "resize", applyDesign);
  listen(window, "resize", () => requestAnimationFrame(syncFaderHandles));

  function openDialog(title, body, wide = false) {
    $(".mm-group-title-name")?.remove();
    previousFocus = document.activeElement;
    $("#mm-dialog-title").textContent = title;
    $(".mm-dialog").classList.toggle("mm-group-dialog", wide);
    $(".mm-dialog-body").innerHTML = body;
    $(".mm-layer").hidden = false;
    $(".mm-dialog-head button").focus();
  }
  function closeDialog() {
    $(".mm-group-title-name")?.remove();
    $(".mm-layer").hidden = true;
    editor = null;
    panTarget = null;
    previousFocus?.isConnected && previousFocus.focus();
  }
  function openPan(i) {
    panTarget = i;
    const m = mix();
    openDialog(
      `${m.name} · ${channels[i]} · PAN`,
      `<div class="mm-pan-labels"><span>LEFT</span><span>CENTRE</span><span>RIGHT</span></div><div class="mm-pan-value">${panLabel(m.pans[i]).replace("PAN · ", "")}</div><input class="mm-pan-large" type="range" min="-100" max="100" step="1" value="${m.pans[i]}" aria-label="Enlarged pan control" /><div class="mm-pan-presets"><button data-pan-preset="-100">Hard L</button><button data-pan-preset="0">Centre</button><button data-pan-preset="100">Hard R</button></div><div class="mm-pan-keys">Fine control · full-width travel</div>`,
    );
    prepareFaders();
  }
  function setPan(v) {
    if (panTarget === null) return;
    mix().pans[panTarget] = v;
    $(".mm-pan-large").value = v;
    $(".mm-pan-value").textContent = panLabel(v).replace("PAN · ", "");
    $$(`[data-pan="${panTarget}"]`)
      .filter((b) => b.classList.contains("mm-pan-button"))
      .forEach((b) => (b.textContent = panLabel(v)));
    syncFaderHandles();
    modified();
  }
  function openSnapshots() {
    openDialog(
      "Recall snapshot",
      `<label for="mm-snapshot-select">Snapshot</label><select id="mm-snapshot-select"><option>IMGL FIBBERS</option><option>FIBBERS · SOUNDCHECK</option><option>ACOUSTIC SET</option></select><p class="mm-warning">Recall changes desk settings for everyone.</p><div class="mm-dialog-actions"><button data-action="close-dialog">Cancel</button><button class="mm-primary" data-action="recall">Recall snapshot</button></div>`,
    );
  }
  function openEditor(index = 0) {
    editor = {
      index,
      name: index < 0 ? "" : groups()[index].name,
      members: index < 0 ? [] : [...groups()[index].members],
    };
    openDialog(
      index < 0 ? "Create group" : "Edit group",
      `<div class="mm-group-editor-bar"><div class="mm-group-picks" role="group" aria-label="Choose a group"></div><button data-action="clear-members">Clear</button></div><div class="mm-member-checks" aria-label="Toggle group membership"></div><div class="mm-dialog-actions"><span class="mm-editor-feedback" role="status">Tap order becomes fader order</span><button data-action="close-dialog">Cancel</button><button class="mm-primary" data-action="save-group">Save group</button></div>`,
      true,
    );
    $(".mm-dialog-head").insertAdjacentHTML(
      "beforeend",
      `<input id="mm-group-name" class="mm-group-title-name" maxlength="24" value="${esc(editor.name)}" placeholder="Group name" aria-label="Group name" />`,
    );
    renderEditor();
  }
  function renderEditor() {
    const e = editor;
    $(".mm-group-picks").innerHTML =
      groups()
        .map(
          (g, i) =>
            `<button data-edit-group="${i}" class="${e.index === i ? "mm-active" : ""}" aria-pressed="${e.index === i}">${esc(g.name)}</button>`,
        )
        .join("") +
      `<button data-edit-group="-1" class="${e.index < 0 ? "mm-active" : ""}" aria-pressed="${e.index < 0}">+ New</button>`;
    $(".mm-member-checks").innerHTML = channels
      .map((name, i) => {
        const n = e.members.indexOf(i);
        return `<button data-toggle-member="${i}" class="${n >= 0 ? "mm-picked" : ""}" aria-pressed="${n >= 0}" aria-label="${i < 24 ? "Input " + (i + 1) : "FX return " + (i - 23)} · ${esc(name)}${n >= 0 ? " · selected " + (n + 1) : ""}"><b>${n >= 0 ? n + 1 : "+"}</b><span>${esc(name)}</span></button>`;
      })
      .join("");
  }

  function available() {
    return availability === "Both desks"
      ? [0, 1]
      : availability === "No desks"
        ? []
        : [availability === "Desk B" ? 1 : 0];
  }
  function deskDialog() {
    const found = available();
    openDialog(
      "Desk connection · preview",
      `${[0, 1].map((i) => `<div class="mm-desk-choice"><div><strong>${addresses[i]}</strong><span>Desk ${i ? "B" : "A"} · ${found.includes(i) ? "available in this preview" : "not found"}</span></div><button data-connect-desk="${i}" ${!found.includes(i) ? "disabled" : ""}>${activeDesk === i ? "Selected" : "Connect"}</button></div>`).join("")}<label class="mm-network-label">Simulated network<select id="mm-network-scenario">${["Desk A", "Desk B", "Both desks", "No desks"].map((x) => `<option ${availability === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><div class="mm-caption">${found.length === 2 ? "Two desks found. Choose explicitly." : found.length === 0 ? "No desk found. Keep the current session disconnected." : "One desk available. Scan connects automatically."}</div><div class="mm-dialog-actions"><button data-action="scan-desks" class="mm-primary">Scan & connect</button></div>`,
    );
  }
  function connectDesk(i) {
    activeDesk = i;
    aux = -1;
    expanded = null;
    dirty = false;
    $(".mm-snapshot").dataset.dirty = "false";
    $(".mm-dirty").textContent = "Snapshot saved";
    closeDialog();
    render();
    feedback(`Desk ${i ? "B" : "A"} selected · simulated`);
    remember();
  }
  function activeCurve(eq) {
    return drawMode
      ? eq.curve
      : Array.from({ length: 161 }, (_, i) => paramGain(eq, i / 160));
  }
  function renderEQ() {
    graphObserver?.disconnect();
    eqDrag = null;
    drawLast = null;
    const eq = mix().eq;
    drawMode = eq.mode === "draw";
    $(".mm-content").innerHTML =
      `<div class="mm-eq-shell mm-eq-native"><div class="mm-eq-plot"><svg class="mm-eq-svg" role="img" aria-label="AUX EQ curve. Drag points for frequency and gain. Use right-hand faders for frequency, Q and gain."><defs><linearGradient id="mm-eq-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a0bd8b" stop-opacity=".30"/><stop offset="1" stop-color="#a0bd8b" stop-opacity=".02"/></linearGradient></defs><g class="mm-eq-grid"></g><path class="mm-eq-area" fill="url(#mm-eq-fill)"/><path class="mm-eq-curve" fill="none" stroke="#dce6d0" stroke-width="2"/><g class="mm-eq-handles"></g></svg></div><aside class="mm-eq-sidebar" aria-label="EQ controls"><div class="mm-eq-mode"><button data-action="eq-points" class="${!drawMode ? "mm-active" : ""}" aria-label="Three EQ points" title="Three points">•••</button><button data-action="eq-draw" class="${drawMode ? "mm-active" : ""}" aria-label="Draw curve" title="Draw curve">✎</button><button data-action="reset-eq" aria-label="Reset EQ" title="Reset EQ">↺</button></div><div class="mm-band-tabs" aria-label="Selected EQ point">${[0, 1, 2].map((i) => `<button data-select-band="${i}" aria-pressed="${!drawMode && selectedBand === i}" class="${!drawMode && selectedBand === i ? "mm-active" : ""}" ${drawMode ? "disabled" : ""}>${i + 1}</button>`).join("")}</div><div class="mm-eq-param-bank">${[
        ["freq", "FREQ", 0, 1, 0.001],
        ["q", "Q", 0, 1, 0.001],
        ["gain", "GAIN", -12, 12, 0.1],
      ]
        .map(
          ([id, label, min, max, step]) =>
            `<label class="mm-eq-param"><span>${label}</span><output data-eq-value="${id}"></output><input class="mm-vertical" type="range" min="${min}" max="${max}" step="${step}" value="0" data-eq-param="${id}" aria-label="Selected EQ point ${id === "freq" ? "frequency" : id === "q" ? "Q" : "gain"}" ${drawMode ? "disabled" : ""}/></label>`,
        )
        .join(
          "",
        )}</div><div class="mm-eq-cut-bank">${["low", "high"].map((c) => `<button data-toggle-cut="${c}" aria-pressed="${eq[c + "Enabled"]}" class="${eq[c + "Enabled"] ? "mm-active" : ""}">${c === "low" ? "Low" : "High"} cut</button>`).join("")}</div></aside></div>`;
    graphObserver = new ResizeObserver(paintEQ);
    graphObserver.observe($(".mm-eq-plot"));
    syncEQControls();
    prepareFaders();
    requestAnimationFrame(paintEQ);
  }
  function syncEQControls() {
    if (!$(".mm-eq-param-bank")) return;
    const eq = mix().eq,
      b = eq.bands[selectedBand],
      values = {
        freq: b.x,
        q: Math.log(b.q / 0.1) / Math.log(100),
        gain: b.gain,
      };
    for (const id of ["freq", "q", "gain"]) {
      $(`[data-eq-param="${id}"]`).value = values[id];
      $(`[data-eq-value="${id}"]`).textContent = drawMode
        ? "—"
        : id === "freq"
          ? hz(freq(b.x))
          : id === "q"
            ? b.q.toFixed(2)
            : (b.gain > 0 ? "+" : "") + b.gain.toFixed(1);
    }
    $$(".mm-band-tabs button").forEach((el) => {
      const chosen = !drawMode && +el.dataset.selectBand === selectedBand;
      el.classList.toggle("mm-active", chosen);
      el.setAttribute("aria-pressed", String(chosen));
    });
    syncFaderHandles();
  }
  function graphGeometry() {
    const el = $(".mm-eq-svg");
    if (!el) return null;
    const r = el.getBoundingClientRect(),
      w = Math.max(150, r.width),
      h = Math.max(80, r.height);
    return {
      w,
      h,
      left: w < 260 ? 28 : 35,
      right: w - 14,
      top: 14,
      bottom: h - 25,
      range: h - 39,
    };
  }
  function paintEQ() {
    const svg = $(".mm-eq-svg");
    if (!svg || aux < 0) return;
    const eq = mix().eq,
      g = graphGeometry(),
      x = (v) => g.left + v * (g.right - g.left),
      y = (v) => g.top + ((15 - clamp(v, -15, 15)) / 30) * g.range;
    svg.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    $(".mm-eq-grid").innerHTML =
      `<rect x="${g.left}" y="${g.top}" width="${g.right - g.left}" height="${g.range}" fill="#111a20"/>${[-12, 0, 12].map((v) => `<line x1="${g.left}" x2="${g.right}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? "#76838a" : "#34434e"}"/><text x="${g.left - 4}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${v}</text>`).join("")}${(g.w < 300 ? [20, 1000, 20000] : g.w < 500 ? [20, 100, 1000, 20000] : [20, 100, 1000, 10000, 20000]).map((f) => `<line x1="${x(logFreq(f))}" x2="${x(logFreq(f))}" y1="${g.top}" y2="${g.bottom}" stroke="#34434e"/><text x="${x(logFreq(f))}" y="${g.h - 7}" text-anchor="${f === 20 ? "start" : f === 20000 ? "end" : "middle"}">${f >= 1000 ? f / 1000 + "k" : f}</text>`).join("")}`;
    const samples = activeCurve(eq),
      curve = samples
        .map(
          (v, i) =>
            `${i ? "L" : "M"}${x(i / 160).toFixed(2)},${y(v + cuts(eq, i / 160)).toFixed(2)}`,
        )
        .join(" ");
    $(".mm-eq-curve").setAttribute("d", curve);
    $(".mm-eq-area").setAttribute(
      "d",
      `M${g.left},${y(0)} ${curve.replace(/^M/, "L")} L${g.right},${y(0)} Z`,
    );
    let handles = drawMode
      ? ""
      : eq.bands
          .map((b, i) => {
            const yy = y(paramGain(eq, b.x) + cuts(eq, b.x));
            return `<g class="mm-eq-handle" data-band="${i}" role="button" aria-label="EQ point ${i + 1}, ${hz(freq(b.x))}"><circle cx="${x(b.x)}" cy="${yy}" r="20" fill="#abbea0" fill-opacity=".18"/><circle cx="${x(b.x)}" cy="${yy}" r="12" fill="${i === selectedBand ? "#ecd3a7" : "#bcc7a8"}" stroke="#879b80"/><text x="${x(b.x)}" y="${yy + 4}" text-anchor="middle" style="fill:#26312b">${i + 1}</text></g>`;
          })
          .join("");
    for (const cut of ["low", "high"])
      if (eq[cut + "Enabled"]) {
        const xx = x(logFreq(eq[cut + "Hz"])),
          yy = g.top + 15;
        handles += `<g class="mm-eq-handle" data-cut="${cut}" role="button" aria-label="${cut === "low" ? "Low" : "High"} cut handle"><line x1="${xx}" x2="${xx}" y1="${yy + 12}" y2="${g.bottom}" stroke="${cut === "low" ? "#7caabb" : "#c7a16d"}" stroke-dasharray="3 4"/><circle cx="${xx}" cy="${yy}" r="14" fill="${cut === "low" ? "#436d7b" : "#83653c"}"/><text x="${xx}" y="${yy + 4}" text-anchor="middle" style="fill:#edf1ee">${cut === "low" ? "LC" : "HC"}</text></g>`;
      }
    $(".mm-eq-handles").innerHTML = handles;
    syncEQControls();
  }
  function graphPoint(e) {
    const svg = $(".mm-eq-svg"),
      r = svg.getBoundingClientRect(),
      g = graphGeometry();
    return {
      x: clamp((e.clientX - r.left - g.left) / (g.right - g.left), 0, 1),
      gain: clamp(15 - ((e.clientY - r.top - g.top) / g.range) * 30, -12, 12),
    };
  }
  function graphMove(e) {
    const eq = mix().eq,
      p = graphPoint(e);
    if (eqDrag?.cut) {
      const c = eqDrag.cut;
      eq[c + "Hz"] = Math.round(
        clamp(freq(p.x), c === "low" ? 20 : 1000, c === "low" ? 400 : 20000),
      );
      paintEQ();
      modified();
      return;
    }
    if (drawLast) {
      const idx = Math.round(p.x * 160),
        from = drawLast.index,
        a = drawLast.gain,
        b = p.gain;
      for (let i = Math.min(idx, from); i <= Math.max(idx, from); i++) {
        const t = idx === from ? 1 : (i - from) / (idx - from);
        eq.curve[i] = clamp(a + (b - a) * t - cuts(eq, i / 160), -12, 12);
      }
      drawLast = { index: idx, gain: p.gain };
      paintEQ();
      modified();
      return;
    }
    if (eqDrag?.band !== undefined) {
      const b = eq.bands[eqDrag.band],
        x = clamp(p.x, 0, 1);
      b.x = x;
      b.gain = clamp(
        p.gain - cuts(eq, x) - paramGain(eq, x, eqDrag.band),
        -12,
        12,
      );
      paintEQ();
      modified();
    }
  }

  function formatTime(s) {
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  }
  function paintRecord() {
    $(".mm-record").classList.toggle("mm-recording", recording);
    $(".mm-rec-text").textContent = recording
      ? formatTime(recordSeconds)
      : "Record";
    $(".mm-rec-state").textContent = recording
      ? "● MTK " + formatTime(recordSeconds)
      : "MTK stopped";
  }
  listen(root, "click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.openAux !== undefined) {
      aux = +b.dataset.openAux;
      mode = "groups";
      expanded = null;
      render();
      remember();
      return;
    }
    if (b.dataset.jumpGroup !== undefined) {
      expanded =
        mode === "groups" && expanded === +b.dataset.jumpGroup
          ? null
          : +b.dataset.jumpGroup;
      mode = "groups";
      render();
      remember();
      return;
    }
    if (b.dataset.toggleCut) {
      const c = b.dataset.toggleCut;
      mix().eq[c + "Enabled"] = !mix().eq[c + "Enabled"];
      renderEQ();
      modified();
      return;
    }
    if (b.dataset.editGroup !== undefined) {
      openEditor(+b.dataset.editGroup);
      return;
    }
    if (b.dataset.selectBand !== undefined) {
      selectedBand = +b.dataset.selectBand;
      paintEQ();
      return;
    }
    if (b.dataset.mode) {
      mode = b.dataset.mode;
      expanded = null;
      render();
      remember();
      return;
    }
    if (b.dataset.expand !== undefined) {
      expanded = expanded === +b.dataset.expand ? null : +b.dataset.expand;
      render();
      remember();
      return;
    }
    if (b.dataset.eq !== undefined) {
      aux = +b.dataset.eq;
      mode = "eq";
      render();
      remember();
      return;
    }
    if (b.dataset.pan !== undefined) {
      openPan(+b.dataset.pan);
      return;
    }
    if (b.dataset.panPreset !== undefined) {
      setPan(+b.dataset.panPreset);
      return;
    }
    if (b.dataset.toggleMember !== undefined && editor) {
      const i = +b.dataset.toggleMember,
        n = editor.members.indexOf(i);
      if (n < 0) editor.members.push(i);
      else editor.members.splice(n, 1);
      renderEditor();
      return;
    }
    if (b.dataset.connectDesk !== undefined) {
      connectDesk(+b.dataset.connectDesk);
      return;
    }
    switch (b.dataset.action) {
      case "overview":
        aux = -1;
        expanded = null;
        render();
        remember();
        break;
      case "collapse":
        expanded = null;
        render();
        remember();
        break;
      case "close-dialog":
        closeDialog();
        break;
      case "snapshots":
        openSnapshots();
        break;
      case "save":
        openDialog(
          "Save current snapshot",
          `<p class="mm-warning">Overwrite “${esc($(".mm-snapshot-name").textContent)}” with the current desk settings?</p><div class="mm-dialog-actions"><button data-action="close-dialog">Cancel</button><button data-action="confirm-save" class="mm-primary">Save snapshot</button></div>`,
        );
        break;
      case "confirm-save":
        dirty = false;
        $(".mm-snapshot").dataset.dirty = "false";
        $(".mm-dirty").textContent = "Snapshot saved";
        feedback("Snapshot saved · preview");
        closeDialog();
        break;
      case "recall":
        $(".mm-snapshot-name").textContent = $("#mm-snapshot-select").value;
        dirty = false;
        $(".mm-snapshot").dataset.dirty = "false";
        $(".mm-dirty").textContent = "Snapshot saved";
        feedback("Snapshot recalled · preview");
        closeDialog();
        break;
      case "record":
        if (recording)
          openDialog(
            "Stop multitrack recording?",
            `<p class="mm-caption">Current take · ${formatTime(recordSeconds)}</p><div class="mm-dialog-actions"><button data-action="close-dialog">Keep recording</button><button data-action="stop-record" class="mm-primary">Stop recording</button></div>`,
          );
        else {
          recording = true;
          recordSeconds = 0;
          paintRecord();
        }
        break;
      case "stop-record":
        recording = false;
        paintRecord();
        closeDialog();
        break;
      case "native":
        $(".mm-native-content").innerHTML =
          `<div class="mm-strip-scroll">${channels
            .slice(0, 8)
            .map((n, i) => channelStrip(i, true))
            .join("")}</div>`;
        $(".mm-native-snapshot").textContent =
          $(".mm-snapshot-name").textContent;
        $(".mm-native-layer").hidden = false;
        prepareFaders();
        $(".mm-native-head button").focus();
        break;
      case "close-native":
        $(".mm-native-layer").hidden = true;
        $('[data-action="native"]').focus();
        break;
      case "fullscreen": {
        const app = $(".mm-app");
        if (document.fullscreenElement)
          document
            .exitFullscreen()
            .catch(() => feedback("Could not exit fullscreen"));
        else if (app.requestFullscreen)
          app
            .requestFullscreen()
            .catch(() =>
              feedback(
                "Fullscreen unavailable in this preview · use the installed app",
              ),
            );
        else feedback("Install to Home Screen to remove browser tabs");
        break;
      }
      case "edit-groups":
        openEditor(mode === "groups" && expanded !== null ? expanded : 0);
        break;
      case "new-group":
        openEditor(-1);
        break;
      case "clear-members":
        if (
          editor &&
          window.confirm(
            "Clear all channel selections from this group? Save the group to apply the change.",
          )
        ) {
          editor.members = [];
          renderEditor();
        }
        break;
      case "save-group":
        if (editor) {
          const name = $("#mm-group-name").value.trim();
          if (!name || !editor.members.length) {
            $(".mm-editor-feedback").textContent =
              "Add a name and at least one channel";
            return;
          }
          const item = { name, members: [...editor.members] },
            g = editor.index < 0 ? groups().length : editor.index;
          if (editor.index < 0) groups().push(item);
          else groups()[g] = item;
          current().mixes.forEach((m) => (m.offsets[g] = 0));
          expanded = null;
          closeDialog();
          render();
          feedback("Group saved for this desk · preview");
          remember();
        }
        break;
      case "eq-points":
        mix().eq.mode = "points";
        drawMode = false;
        renderEQ();
        break;
      case "eq-draw":
        mix().eq.mode = "draw";
        drawMode = true;
        renderEQ();
        break;
      case "reset-eq": {
        const eq = mix().eq;
        if (drawMode) eq.curve.fill(0);
        else
          eq.bands = [
            { x: 0.233, gain: 0, q: 1 },
            { x: 0.566, gain: 0, q: 1 },
            { x: 0.85, gain: 0, q: 1 },
          ];
        eq.lowEnabled = false;
        eq.highEnabled = false;
        renderEQ();
        modified();
        feedback("Active EQ reset · cuts off · preview");
        break;
      }
      case "desks":
        deskDialog();
        break;
      case "scan-desks": {
        const found = available();
        if (found.length === 1) connectDesk(found[0]);
        else {
          activeDesk = null;
          render();
          deskDialog();
          feedback(
            found.length
              ? "Choose a desk · both are reachable"
              : "No desk found · retry when connected to desk Wi-Fi",
          );
        }
        break;
      }
    }
  });
  listen(root, "input", (e) => {
    const el = e.target;
    if (el.dataset.master !== undefined) {
      const i = +el.dataset.master;
      current().mixes[i].master = +el.value;
      $(`[data-master-value="${i}"]`).textContent = db(+el.value);
      modified();
    }
    if (
      el.dataset.channel !== undefined &&
      !$(".mm-native-layer").contains(el)
    ) {
      const i = +el.dataset.channel;
      mix().levels[i] = +el.value;
      $$(`[data-channel-value="${i}"]`).forEach(
        (o) => (o.textContent = db(+el.value)),
      );
      groups().forEach((g, n) => {
        if (g.members.includes(i)) mix().offsets[n] = 0;
      });
      modified();
    }
    if (el.dataset.group !== undefined) {
      const g = +el.dataset.group,
        m = mix(),
        old = m.offsets[g] || 0,
        b = bounds(g),
        v = clamp(+el.value, b.min, b.max),
        delta = v - old;
      groups()[g].members.forEach(
        (i) => (m.levels[i] = clamp(m.levels[i] + delta, -60, 10)),
      );
      m.offsets[g] = v;
      groups().forEach((other, n) => {
        if (
          n !== g &&
          other.members.some((i) => groups()[g].members.includes(i))
        )
          m.offsets[n] = 0;
      });
      $(`[data-group-value="${g}"]`).textContent = db(v);
      $(`[data-group-limit="${g}"]`).textContent =
        v >= b.max - 0.05
          ? "UPPER LIMIT"
          : v <= b.min + 0.05
            ? "LOWER LIMIT"
            : "";
      groups()[g].members.forEach((i) => {
        $$(`[data-channel-value="${i}"]`).forEach(
          (o) => (o.textContent = db(m.levels[i])),
        );
        const input = $(`[data-channel="${i}"]`);
        if (input) input.value = m.levels[i];
      });
      modified();
    }
    if (el.classList.contains("mm-pan-large")) setPan(+el.value);
    if (el.dataset.eqParam && !drawMode) {
      const b = mix().eq.bands[selectedBand],
        v = +el.value;
      if (el.dataset.eqParam === "freq") b.x = v;
      else if (el.dataset.eqParam === "q") b.q = 0.1 * Math.pow(100, v);
      else b.gain = v;
      paintEQ();
      modified();
    }
    if (el.dataset.cutFrequency) {
      const c = el.dataset.cutFrequency;
      if (el.value === "") return;
      mix().eq[c + "Hz"] = clamp(
        +el.value,
        c === "low" ? 20 : 1000,
        c === "low" ? 400 : 20000,
      );
      paintEQ();
      modified();
    }
  });
  listen(root, "change", (e) => {
    const el = e.target;
    if (el.id === "mm-group-choice") {
      editor.name = $("#mm-group-name").value;
      const i = +el.value;
      editor = {
        index: i,
        name: i < 0 ? "" : groups()[i].name,
        members: i < 0 ? [] : [...groups()[i].members],
      };
      $("#mm-group-name").value = editor.name;
      renderEditor();
    }
    if (el.id === "mm-network-scenario") {
      availability = el.value;
      design.availableDesk = availability;
      deskDialog();
    }
    if (el.dataset.cutEnabled) {
      const c = el.dataset.cutEnabled;
      mix().eq[c + "Enabled"] = el.checked;
      $(`[data-cut-frequency="${c}"]`).disabled = !el.checked;
      paintEQ();
      modified();
    }
    if (el.dataset.cutFrequency) {
      el.value = mix().eq[el.dataset.cutFrequency + "Hz"];
    }
    if (el.dataset.channel !== undefined || el.dataset.group !== undefined)
      render();
  });
  const gestures = installFaderGestures(root, {
    onMasterEQ: (i) => {
      aux = i;
      mode = "eq";
      expanded = null;
      render();
    },
  });
  function prepareFaders() {
    gestures.prepare();
  }
  function syncFaderHandles() {
    gestures.sync();
  }
  listen(root, "pointerdown", (e) => {
    if (!e.target.closest(".mm-eq-svg")) return;
    const cut = e.target.closest("[data-cut]"),
      band = e.target.closest("[data-band]"),
      eq = mix().eq;
    if (cut) {
      eqDrag = { cut: cut.dataset.cut };
    } else if (!drawMode && band) {
      const i = +band.dataset.band;
      selectedBand = i;
      eqDrag = { band: i };
      syncEQControls();
    } else if (drawMode) {
      const p = graphPoint(e);
      drawLast = { index: Math.round(p.x * 160), gain: p.gain };
    } else return;
    $(".mm-eq-svg").setPointerCapture(e.pointerId);
    if (drawLast) graphMove(e);
    e.preventDefault();
  });
  listen(root, "pointermove", (e) => {
    if ((eqDrag || drawLast) && e.target.closest(".mm-eq-svg")) graphMove(e);
  });
  listen(root, "pointerup", () => {
    eqDrag = null;
    drawLast = null;
  });
  listen(root, "pointercancel", () => {
    eqDrag = null;
    drawLast = null;
  });
  listen(root, "keydown", (e) => {
    if (e.key === "Escape") {
      if (!$(".mm-native-layer").hidden) {
        $(".mm-native-layer").hidden = true;
        $('[data-action="native"]').focus();
      } else if (!$(".mm-layer").hidden) closeDialog();
    }
    if (e.key === "Tab" && !$(".mm-layer").hidden) {
      const nodes = [
          ...$(".mm-dialog").querySelectorAll("button,input,select"),
        ].filter((n) => !n.disabled),
        first = nodes[0],
        last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      gestures.cancel();
      eqDrag = null;
      drawLast = null;
    }
  });
  listen(window, "pagehide", () => {
    gestures.cancel();
    eqDrag = null;
    drawLast = null;
  });
  const stopClock = startLocalClock($(".mm-clock"));
  const timer = setInterval(() => {
    if (recording) {
      recordSeconds++;
      paintRecord();
    }
  }, 1000);
  const layoutObserver = new ResizeObserver(() => applyDesign());
  layoutObserver.observe(root);
  listen(document, "fullscreenchange", applyDesign);
  $(".mm-feedback").textContent = "Simulated signal levels";
  $(".mm-snapshot-name").textContent = "DEMO SNAPSHOT";
  $(".mm-dirty").textContent = "Simulated snapshot";
  $(".mm-rec-state").textContent = "Simulated recording stopped";
  render();
  return () => {
    for (const [target, type, callback] of listeners)
      target.removeEventListener(type, callback);
    clearInterval(timer);
    stopClock();
    gestures.destroy();
    graphObserver?.disconnect();
    layoutObserver.disconnect();
  };
}
