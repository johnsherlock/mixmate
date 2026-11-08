import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(dir, prefix = '') {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${prefix}${item.name}`;
    if (item.isDirectory()) found.push(...await files(`${dir}/${item.name}`, `${path}/`));
    else if (path !== 'sw.js') found.push(path);
  }
  return found.sort();
}
const assets = await files('dist');
const hash = createHash('sha256');
for (const asset of assets) hash.update(asset).update(await readFile(`dist/${asset}`));
const version = hash.digest('hex').slice(0, 16);
const source = await readFile('src/sw-template.js', 'utf8');
await writeFile('dist/sw.js', source.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)));
console.log(`Offline worker: ${assets.length} assets, version ${version}`);
