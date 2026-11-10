import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildServiceWorker } from '../scripts/build-sw.js';
import { posix } from 'node:path';

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
    const startURL = new URL(manifest.start_url, new URL('manifest.webmanifest', scope));
    assert.equal(startURL.href, scope);
    assert.equal(new URL(manifest.scope, new URL('manifest.webmanifest', scope)).href, scope);
    // Manifest id is resolved against the start URL's ORIGIN, not the manifest
    // directory. './' therefore collides with the origin-root app identity.
    // https://www.w3.org/TR/appmanifest/#id-member (processing steps 4–5)
    const appID = new URL(manifest.id, startURL.origin);
    assert.equal(appID.href, scope);
    assert.notEqual(appID.href, new URL('/', scope).href);
    assert.notEqual(appID.href, new URL('another-app/', startURL.origin).href);
    // Identity must survive a future start URL change within this app's scope.
    assert.equal(new URL(manifest.id, new URL('connection-test.html', scope).origin).href, appID.href);
    for (const icon of manifest.icons) assert.ok(first.assets.includes(icon.src.replace(/^\.\//, '')));
    const notice = 'third-party/soundcraft-ui-connection-LICENSE.txt';
    assert.ok(first.assets.includes(notice));
    assert.equal(await readFile(join(directory, notice), 'utf8'), await readFile(join('public', notice), 'utf8'));
    for (const entry of ['index.html', 'iem.html', 'demo.html', 'connection-test.html']) {
      const html = await readFile(join(directory, entry), 'utf8');
      assert.match(html, /name="mixmate-entry-proof" content="[a-f0-9]{64}"/);
      for (const [, reference] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        if (/^https?:/.test(reference)) continue;
        const url = new URL(reference, scope);
        assert.ok(url.href.startsWith(scope), reference);
        if (url.href !== scope) assert.ok(first.assets.includes(url.href.slice(scope.length)), reference);
      }
    }
    const moduleGraph = async entry => {
      const html = await readFile(join(directory, entry), 'utf8');
      const starts = [...html.matchAll(/<script[^>]+src="([^" ]+\.js)"/g)].map(match => match[1].replace(/^\.\//, ''));
      const visited = new Set();
      async function visit(path) {
        if (visited.has(path)) return '';
        visited.add(path);
        const source = await readFile(join(directory, path), 'utf8');
        let result = source;
        for (const match of source.matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)) result += await visit(posix.join(posix.dirname(path), match[1]));
        return result;
      }
      return (await Promise.all(starts.map(visit))).join('\n');
    };
    const live = await moduleGraph('index.html'), alias = await moduleGraph('iem.html'), demo = await moduleGraph('demo.html'), connection = await moduleGraph('connection-test.html');
    assert.equal(live, alias); // Root and compatibility URL load the same typed AUX capability.
    assert.ok(connection.includes('setInputFader') && connection.includes('3:::SETD'));
    const rootHTML = await readFile(join(directory, 'index.html'), 'utf8');
    const connectionHTML = await readFile(join(directory, 'connection-test.html'), 'utf8');
    assert.match(rootHTML, /id="iem-root"/); assert.ok(!rootHTML.includes('id="enable-fader"'));
    assert.match(connectionHTML, /id="enable-fader"[^>]*disabled/);
    assert.match(connectionHTML, /href="\.\/">← Main live IEM app/);
    assert.match(rootHTML, /connect-src ws:/);
    const metadata = JSON.parse(await readFile('package.json', 'utf8'));
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    assert.equal(metadata.version, '0.4.0'); assert.equal(lock.version, metadata.version); assert.equal(lock.packages[''].version, metadata.version);
    assert.ok(live.includes(metadata.version) && connection.includes(metadata.version));
    assert.equal(manifest.name, 'MixMate — IEM mixer'); assert.equal(manifest.id, 'mixmate/'); assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
    const shell = await readFile('src/iem/shell.html', 'utf8');
    assert.match(shell, /href="\.\/">Live IEM/); assert.match(shell, /href="\.\/connection-test.html"[^>]*>Settings \/ test/);
    assert.ok(demo.includes('KICK') && demo.includes('SNARE'));
    assert.ok(!live.includes('KICK') && !live.includes('SNARE'));
    assert.ok(live.includes('3:::INIT') && live.includes('3:::ALIVE') && live.includes('2::'));
    assert.ok(live.includes('VU2^') && live.includes('NOT AUX send') && live.includes('vuPostFaderL'));
    assert.ok(!demo.includes('VU2^')); // Meter decoding cannot enter the isolated simulation graph.
    assert.ok(!demo.includes('3:::INIT') && !demo.includes('3:::ALIVE'));
    assert.ok(!live.includes('setInputFader') && live.includes('3:::SETD') && !live.includes('3:::SETS'));
    assert.ok(!live.includes('new MixerConnection') && !live.includes('faderTargets'));
    const liveHTML = await readFile(join(directory, 'iem.html'), 'utf8');
    const demoHTML = await readFile(join(directory, 'demo.html'), 'utf8');
    assert.match(liveHTML, /connect-src ws:/);
    assert.match(demoHTML, /connect-src 'none'/);
    const transport = await readFile('src/iem/session-core.js', 'utf8');
    assert.deepEqual([...transport.matchAll(/\.send\(([^)]+)\)/g)].map(match => match[1]).sort(), ["'2::'", "'3:::ALIVE'", "'3:::INIT'", "grant.message"].sort());
    assert.ok(!transport.includes('../protocol.js'));
    assert.match(transport, /createReadOnlySession\(options\) \{ return createSession\(false, options\)/);
    assert.match(transport, /createAuxLevelSession\(options\) \{ return createSession\(true, options\)/);
    assert.doesNotMatch(transport, /export function createSession/);
    const generated = await readFile(join(directory, 'sw.js'), 'utf8');
    assert.ok(!/__VERSION__|__ASSETS__|__HASHES__|__ENTRY_PROOFS__/.test(generated));
    assert.match(generated, /cache: 'reload'/);
    assert.ok(!generated.includes('skipWaiting('));
    assert.equal(await readFile(join(directory, 'mockups/iem.html'), 'utf8'), await readFile('mockups/iem.html', 'utf8'));
    assert.deepEqual(await buildServiceWorker(directory), first);
    const oldEntry = await readFile(join(directory, 'iem.html'), 'utf8');
    const oldToken = /name="mixmate-entry-proof" content="([a-f0-9]{64})"/.exec(oldEntry)[1];
    await writeFile(join(directory, 'iem.html'), oldEntry.replace('</title>', ' revised</title>'));
    await buildServiceWorker(directory);
    const newToken = /name="mixmate-entry-proof" content="([a-f0-9]{64})"/.exec(await readFile(join(directory, 'iem.html'), 'utf8'))[1];
    assert.notEqual(newToken, oldToken); // HTML-only changes cannot reuse old entry proof.
    await writeFile(join(directory, 'manifest.webmanifest'), '{}');
    const changed = await buildServiceWorker(directory);
    assert.notEqual(changed.version, first.version);
    assert.notEqual(changed.hashes['manifest.webmanifest'], first.hashes['manifest.webmanifest']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
