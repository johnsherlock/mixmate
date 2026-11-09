import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
async function files(dir, prefix = "") {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${prefix}${item.name}`;
    if (item.isDirectory())
      found.push(...(await files(`${dir}/${item.name}`, `${path}/`)));
    else if (path !== "sw.js") found.push(path);
  }
  return found.sort();
}
export async function buildServiceWorker(directory = "dist") {
  const assets = await files(directory);
  const source = await readFile(
    new URL("../src/sw-template.js", import.meta.url),
    "utf8",
  );
  const hash = createHash("sha256").update(source);
  const hashes = {},
    entryProofs = {};
  for (const asset of assets) {
    let body = await readFile(`${directory}/${asset}`);
    if (asset.endsWith(".html")) {
      const html = body.toString("utf8");
      const marker =
        /(<meta name="mixmate-entry-proof" content=")(?:__ENTRY_PROOF__|[a-f0-9]{64})("\s*\/?[>])/;
      if (marker.test(html)) {
        const normalized = html.replace(marker, "$1__ENTRY_PROOF__$2");
        const proof = createHash("sha256").update(normalized).digest("hex");
        entryProofs[asset] = proof;
        body = Buffer.from(html.replace(marker, `$1${proof}$2`));
        await writeFile(`${directory}/${asset}`, body);
      }
    }
    hashes[asset] = createHash("sha256").update(body).digest("hex");
    hash.update(asset).update(body);
  }
  const version = hash.digest("hex").slice(0, 16);
  await writeFile(
    `${directory}/sw.js`,
    source
      .replace("__VERSION__", version)
      .replace("__ASSETS__", JSON.stringify(assets))
      .replace("__HASHES__", JSON.stringify(hashes))
      .replace("__ENTRY_PROOFS__", JSON.stringify(entryProofs)),
  );
  return { assets, hashes, version };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { assets, version } = await buildServiceWorker();
  console.log(`Offline worker: ${assets.length} assets, version ${version}`);
}
