(() => {
  if (typeof window.__mmS04 !== 'undefined') throw Error('Existing diagnostic must be inspected first.');
  const original = WebSocket.prototype.send;
  const d = { installed: new Date().toISOString(), ua: navigator.userAgent, url: location.href, started: null, deadline: null, sockets: [], events: [], receipts: [], statuses: [], keys: [], overflow: 0, skipped: 0, incoming: 0, timer: null };
  const stamp = () => ({ utc: new Date().toISOString(), mono: performance.now() });
  const add = (list, value, cap) => { if (list.length < cap) list.push(value); else d.overflow++; };
  const selected = /^(?:SETD|SETS)\^((?:model|firmware)|a\.[01]\.(?:mix|matrix|stereoIndex|mute)|i\.[01]\.(?:stereoIndex|name)|i\.[01]\.aux\.[01]\.(?:value|pan|mute|post|postproc))\^(.+)$/;
  const stop = () => { add(d.events, { ...stamp(), type: 'watchdog-stop' }, 100); for (const row of d.sockets) if (row.socket.readyState < 2) row.socket.close(1000, 'S04 bounded session ended'); };
  const attach = socket => {
    let row = d.sockets.find(row => row.socket === socket); if (row) return row;
    row = { id: d.sockets.length + 1, socket, url: socket.url, counts: { INIT: 0, ALIVE: 0, heartbeat: 0, parameter: 0, other: 0 }, handlers: [] }; d.sockets.push(row);
    if (!d.started) { d.started = stamp(); d.deadline = d.started.mono + 300000; d.timer = setTimeout(stop, 300000); }
    const message = event => {
      d.incoming++; if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > 131072) { d.skipped++; return; }
      const lines = event.data.split('\n'); if (lines.length > 2048) d.skipped += lines.length - 2048;
      for (let line of lines.slice(0, 2048)) { if (line.length > 4096) { d.skipped++; continue; } if (line.startsWith('3:::')) line = line.slice(4); const match = selected.exec(line); if (match) add(d.receipts, { ...stamp(), socket: row.id, path: match[1], raw: match[2] }, 1000); }
    };
    const close = event => add(d.events, { ...stamp(), socket: row.id, type: 'close', code: event.code, clean: event.wasClean, reason: event.reason }, 100);
    const error = () => add(d.events, { ...stamp(), socket: row.id, type: 'error' }, 100);
    for (const [type, fn] of [['message', message], ['close', close], ['error', error]]) { socket.addEventListener(type, fn); row.handlers.push([type, fn]); }
    add(d.events, { ...stamp(), socket: row.id, type: 'attached', url: socket.url }, 100); return row;
  };
  function wrapped(message) {
    const row = attach(this);
    if (d.started && (performance.now() >= d.deadline || Date.now() - Date.parse(d.started.utc) >= 300000)) stop();
    const type = message === '3:::INIT' ? 'INIT' : message === '3:::ALIVE' ? 'ALIVE' : message === '2::' ? 'heartbeat' : typeof message === 'string' && message.startsWith('3:::SETD^') ? 'parameter' : 'other';
    row.counts[type]++;
    if (type === 'parameter' || type === 'other') add(d.events, { ...stamp(), socket: row.id, type: 'send', message }, 100);
    try { const result = original.call(this, message); if (type === 'parameter' || type === 'other') add(d.events, { ...stamp(), socket: row.id, type: 'returned', message }, 100); return result; }
    catch (error) { add(d.events, { ...stamp(), socket: row.id, type: 'threw', message, error: String(error) }, 100); throw error; }
  }
  WebSocket.prototype.send = wrapped;
  let lastStatus = '';
  const capture = () => { const state = { mode: document.querySelector('.mm-mode-label')?.textContent, feedback: document.querySelector('.mm-feedback')?.textContent, detail: document.querySelector('.mm-dirty')?.textContent }; const key = JSON.stringify(state); if (key !== lastStatus) { lastStatus = key; add(d.statuses, { ...stamp(), ...state }, 500); } };
  const observer = new MutationObserver(capture); observer.observe(document.querySelector('#app') || document.body, { childList: true, characterData: true, subtree: true }); capture();
  const key = event => { if (event.target?.matches?.('input[type=range]')) add(d.keys, { ...stamp(), type: event.type, trusted: event.isTrusted, key: event.key, label: event.target.getAttribute('aria-label'), value: event.target.value }, 100); };
  const visibility = () => add(d.events, { ...stamp(), type: 'visibility', hidden: document.hidden }, 100);
  document.addEventListener('keydown', key, true); document.addEventListener('keyup', key, true); document.addEventListener('visibilitychange', visibility);
  d.dump = () => ({ installed: d.installed, ua: d.ua, url: d.url, started: d.started, deadline: d.deadline, now: stamp(), sockets: d.sockets.map(row => ({ id: row.id, url: row.url, readyState: row.socket.readyState, counts: row.counts })), incoming: d.incoming, skipped: d.skipped, overflow: d.overflow, events: d.events, receipts: d.receipts, statuses: d.statuses, keys: d.keys });
  d.cleanup = () => { clearTimeout(d.timer); observer.disconnect(); document.removeEventListener('keydown', key, true); document.removeEventListener('keyup', key, true); document.removeEventListener('visibilitychange', visibility); for (const row of d.sockets) for (const [type, fn] of row.handlers) row.socket.removeEventListener(type, fn); if (WebSocket.prototype.send !== wrapped) throw Error('Send wrapper changed; inspect before cleanup.'); WebSocket.prototype.send = original; return d.dump(); };
  window.__mmS04 = d; return JSON.stringify({ installed: d.installed, noSockets: d.sockets.length, watchdogMs: 300000 });
})()
