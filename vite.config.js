import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: { app: "index.html", iem: "iem.html", demo: "demo.html", connection: "connection-test.html" },
    },
  },
});
