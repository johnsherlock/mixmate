// F07-S05 versioning policy: a pull request that changes shipped app files must
// increase the package.json version (patch for fixes, minor for features).
// Docs-only, test-only and workflow-only pull requests pass unchanged.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const SHIPPED = [
  /^src\//,
  /^public\//,
  /^(index|iem|demo|connection-test)\.html$/,
  /^vite\.config\.js$/,
  /^scripts\//,
  /^mockups\//, // copied into dist by the build
];
export const isShipped = (path) => SHIPPED.some((pattern) => pattern.test(path));

const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
  return match ? match.slice(1).map(Number) : null;
};
export function compareVersions(a, b) {
  const left = parse(a), right = parse(b);
  if (!left || !right) return NaN;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

// Runtime dependencies are shipped in the bundle; devDependency-only changes are not.
export function dependenciesChanged({ basePackage = {}, headPackage = {}, baseLock = {}, headLock = {} }) {
  const runtime = (pkg, lock) => JSON.stringify([
    pkg.dependencies || {},
    Object.entries(lock.packages || {}).filter(([path, entry]) => path !== "" && !entry.dev).sort(([a], [b]) => (a < b ? -1 : 1)),
  ]);
  return runtime(basePackage, baseLock) !== runtime(headPackage, headLock);
}

export function checkVersion({ changedFiles, baseVersion, headVersion, dependenciesChanged: dependencies = false }) {
  const shipped = changedFiles.filter(isShipped);
  if (dependencies) shipped.push("package.json (dependencies)");
  if (!shipped.length) return { ok: true, message: "No shipped app files changed; no version bump required." };
  const order = compareVersions(headVersion, baseVersion);
  if (Number.isNaN(order)) return { ok: false, message: `Versions must be x.y.z (base ${baseVersion}, head ${headVersion}).` };
  if (order > 0) return { ok: true, message: `Version bumped ${baseVersion} -> ${headVersion}.` };
  return {
    ok: false,
    message: `Shipped files changed (${shipped.slice(0, 5).join(", ")}${shipped.length > 5 ? ", ..." : ""}) but package.json version ${headVersion} is not above base ${baseVersion}. Bump it (patch for fixes, minor for features) and add a CHANGELOG.md entry.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] || "origin/main";
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const changedFiles = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  const baseVersion = JSON.parse(git("show", `${base}:package.json`)).version;
  const headVersion = JSON.parse(git("show", "HEAD:package.json")).version;
  const json = (ref, file) => { try { return JSON.parse(git("show", `${ref}:${file}`)); } catch { return {}; } };
  const basePackage = json(base, "package.json"), headPackage = json("HEAD", "package.json");
  const changedDeps = dependenciesChanged({ basePackage, headPackage, baseLock: json(base, "package-lock.json"), headLock: json("HEAD", "package-lock.json") });
  const result = checkVersion({ changedFiles, baseVersion, headVersion, dependenciesChanged: changedDeps });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
