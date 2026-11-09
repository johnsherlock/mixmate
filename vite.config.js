import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: { connection: "index.html", iem: "iem.html", demo: "demo.html" },
    },
  },
});
