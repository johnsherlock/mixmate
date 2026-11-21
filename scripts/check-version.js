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

export function checkVersion({ changedFiles, baseVersion, headVersion }) {
  const shipped = changedFiles.filter(isShipped);
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
  const result = checkVersion({ changedFiles, baseVersion, headVersion });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
