import { defineConfig } from "vite";

// `base: "./"` emits relative asset paths so the built `dist/` folder works
// from a domain root (splitter.example.com), a subpath (github.io/proj/),
// or even opened directly as a file. No other config needed for hosting.
export default defineConfig({
  base: "./",
  server: { port: 5173 },
});
