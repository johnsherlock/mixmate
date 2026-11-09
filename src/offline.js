// Bound registration, activation and cache verification together. A stalled browser
// API must not leave the app claiming that an offline copy is being prepared forever.
export async function verifyOfflineCopy({
  serviceWorker,
  baseURI,
  MessageChannelClass = globalThis.MessageChannel,
  timeoutMs = 15000,
  onRegistration = () => {},
  required,
}) {
  let timeout,
    channel,
    expired = false;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      expired = true;
      reject(
        new Error("Offline preparation timed out. Reopen online to retry."),
      );
    }, timeoutMs);
  });
  const verify = async () => {
    const registration = await serviceWorker.register(
      new URL("./sw.js", baseURI),
      { scope: "./" },
    );
    if (expired) return;
    onRegistration(registration);
    await serviceWorker.ready;
    if (expired) return;
    const controller = serviceWorker.controller;
    if (!controller)
      throw new Error(
        "Offline worker is starting. Reopen or reload this app while online.",
      );
    return new Promise((resolve, reject) => {
      channel = new MessageChannelClass();
      channel.port1.onmessage = ({ data }) => {
        if (data?.ready !== true && data?.ready !== false) {
          reject(new Error("Invalid offline verification response."));
          return;
        }
        if (
          data.ready &&
          required &&
          (data.proof?.entry !== required.entry ||
            data.proof?.token !== required.token ||
            JSON.stringify(data.proof?.assets) !==
              JSON.stringify(required.assets))
        ) {
          reject(
            new Error(
              "This offline worker does not verify the current page and its assets. Close all app windows after the update downloads, then reopen online.",
            ),
          );
          return;
        }
        resolve(data);
      };
      controller.postMessage(
        { type: "VERIFY_OFFLINE", ...(required ? { required } : {}) },
        [channel.port2],
      );
    });
  };
  try {
    return await Promise.race([verify(), deadline]);
  } finally {
    expired = true;
    clearTimeout(timeout);
    channel?.port1.close();
    channel?.port2.close();
  }
}

// Observe an already registered worker without activating it or reloading clients.
export function observeOfflineUpdates(registration, onWaiting) {
  const observed = new Set();
  let previous;
  function inspect() {
    const current = new Set(
      [registration.installing, registration.waiting].filter(Boolean),
    );
    for (const worker of observed) {
      if (!current.has(worker)) {
        worker.removeEventListener("statechange", inspect);
        observed.delete(worker);
      }
    }
    for (const worker of current) {
      if (!observed.has(worker)) {
        worker.addEventListener("statechange", inspect);
        observed.add(worker);
      }
    }
    const waiting = Boolean(
      registration.active && registration.waiting?.state === "installed",
    );
    if (waiting !== previous) {
      previous = waiting;
      onWaiting(waiting);
    }
  }
  registration.addEventListener("updatefound", inspect);
  inspect();
  return () => {
    registration.removeEventListener("updatefound", inspect);
    for (const worker of observed)
      worker.removeEventListener("statechange", inspect);
    observed.clear();
  };
}

// Built HTML gets a stable identity before its own hash is calculated. Combined
// with actual content-hashed module/CSS URLs, this proves coverage of the page
// that is executing, rather than only an older worker's self-reported inventory.
export function currentEntryRequirements(document) {
  const entry = new URL(document.baseURI);
  entry.search = "";
  entry.hash = "";
  if (entry.pathname.endsWith("/")) entry.pathname += "index.html";
  const token =
    document.querySelector('meta[name="mixmate-entry-proof"]')?.content || "";
  const assets = [
    entry.href,
    ...[
      ...document.querySelectorAll(
        'script[type="module"][src],link[rel="stylesheet"][href]',
      ),
    ].map(
      (element) =>
        new URL(
          element.getAttribute(element.tagName === "SCRIPT" ? "src" : "href"),
          document.baseURI,
        ).href,
    ),
  ];
  for (const path of ["index.html", "iem.html", "demo.html"])
    assets.push(new URL(path, document.baseURI).href);
  return { entry: entry.href, token, assets: [...new Set(assets)] };
}
