import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildServiceWorker } from '../scripts/build-sw.js';

async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await inventory(join(directory, entry.name), relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}
test('production build precaches the exact emitted inventory and resolves install/assets under /mixmate/', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mixmate-build-'));
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory], { stdio: 'pipe' });
    await mkdir(join(directory, 'mockups'));
    await copyFile('mockups/iem.html', join(directory, 'mockups/iem.html'));
    // Include a nested future asset to guard against a fixed eight-file precache.
    await mkdir(join(directory, 'assets', 'nested'));
    await writeFile(join(directory, 'assets/nested/local.bin'), 'bundled future asset');
    const first = await buildServiceWorker(directory);
    assert.deepEqual(first.assets, (await inventory(directory)).filter(path => path !== 'sw.js'));
    for (const path of first.assets) {
      assert.equal(first.hashes[path], createHash('sha256').update(await readFile(join(directory, path))).digest('hex'));
    }
    const scope = 'https://example.test/mixmate/';
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.webmanifest'), 'utf8'));
    for (const key of ['id', 'scope', 'start_url']) assert.equal(new URL(manifest[key], scope).href, scope);
    for (const icon of manifest.icons) assert.ok(first.assets.includes(icon.src.replace(/^\.\//, '')));
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^https?:/.test(reference)) continue; // Source/feedback links are not runtime assets.
      const url = new URL(reference, scope);
      assert.ok(url.href.startsWith(scope), reference);
      if (url.href !== scope) assert.ok(first.assets.includes(url.href.slice(scope.length)), reference);
    }
    const generated = await readFile(join(directory, 'sw.js'), 'utf8');
    assert.ok(!/__VERSION__|__ASSETS__|__HASHES__/.test(generated));
    assert.match(generated, /cache: 'reload'/);
    assert.ok(!generated.includes('skipWaiting('));
    assert.equal(await readFile(join(directory, 'mockups/iem.html'), 'utf8'), await readFile('mockups/iem.html', 'utf8'));
    assert.deepEqual(await buildServiceWorker(directory), first);
    await writeFile(join(directory, 'manifest.webmanifest'), '{}');
    const changed = await buildServiceWorker(directory);
    assert.notEqual(changed.version, first.version);
    assert.notEqual(changed.hashes['manifest.webmanifest'], first.hashes['manifest.webmanifest']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
