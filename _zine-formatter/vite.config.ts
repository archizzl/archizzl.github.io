import { defineConfig } from "vite";

// `base: "./"` emits relative asset paths so the built `dist/` folder works
// from projects/zine-formatter/ on the site, or opened directly as a file.
export default defineConfig({
  base: "./",
  server: { port: 5174 },
});
