import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkVersion, compareVersions, isShipped } from '../scripts/check-version.js';

test('shipped file changed without a bump fails; with a bump passes; docs-only passes', () => {
  assert.equal(checkVersion({ changedFiles: ['src/iem/live-entry.js'], baseVersion: '0.6.0', headVersion: '0.6.0' }).ok, false);
  assert.equal(checkVersion({ changedFiles: ['src/iem/live-entry.js', 'docs/x.md'], baseVersion: '0.6.0', headVersion: '0.6.1' }).ok, true);
  assert.equal(checkVersion({ changedFiles: ['docs/backlog.md', 'AGENTS.md', 'tests/a.test.js', '.github/workflows/ci.yml', 'CHANGELOG.md'], baseVersion: '0.6.0', headVersion: '0.6.0' }).ok, true);
  assert.equal(checkVersion({ changedFiles: ['src/a.js'], baseVersion: '0.6.0', headVersion: '0.5.9' }).ok, false);
  assert.equal(checkVersion({ changedFiles: ['src/a.js'], baseVersion: '0.6.0', headVersion: 'x' }).ok, false);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  for (const path of ['src/a.js', 'public/manifest.webmanifest', 'index.html', 'iem.html', 'demo.html', 'connection-test.html', 'vite.config.js', 'scripts/build-sw.js']) assert.equal(isShipped(path), true, path);
  for (const path of ['docs/a.md', 'tests/a.js', 'mockups/iem.html', 'package.json', 'README.md']) assert.equal(isShipped(path), false, path);
});

test('the CLI compares a real git base with HEAD', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mm-version-')), script = resolve('scripts/check-version.js');
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  const run = () => { try { execFileSync('node', [script, 'base'], { cwd: dir, stdio: 'pipe' }); return 0; } catch (error) { return error.status; } };
  try {
    git('init', '-q'); await mkdir(join(dir, 'src')); await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' })); await writeFile(join(dir, 'src/a.js'), 'a');
    git('add', '.'); git('commit', '-q', '-m', 'base'); git('branch', 'base');
    await writeFile(join(dir, 'docs/a.md'), 'doc'); git('add', '.'); git('commit', '-q', '-m', 'docs'); assert.equal(run(), 0);
    await writeFile(join(dir, 'src/a.js'), 'b'); git('add', '.'); git('commit', '-q', '-m', 'src'); assert.equal(run(), 1);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.0.1' })); git('add', '.'); git('commit', '-q', '-m', 'bump'); assert.equal(run(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
