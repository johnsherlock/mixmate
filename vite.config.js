import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

// F09-S11: the build commit and time are shown in Diagnostics so the user can
// see which build is running. Never fails the build: every source has a fallback.
function buildCommit() {
  const fromCi = (process.env.GITHUB_SHA || "").trim();
  if (/^[0-9a-f]{7,64}$/i.test(fromCi)) return fromCi.slice(0, 7);
  try {
    const value = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (/^[0-9a-f]{4,64}$/i.test(value)) return value;
  } catch { /* No git checkout (for example a source archive). */ }
  return "unknown";
}

export default defineConfig({
  base: "./",
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      input: { app: "index.html", iem: "iem.html", demo: "demo.html", connection: "connection-test.html" },
    },
  },
});
