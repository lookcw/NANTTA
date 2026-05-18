import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Django serves the built bundle from STATIC_URL ("/static/") and WhiteNoise
// adds content-hashed filenames at collectstatic time. The SPA shell view
// reads manifest.json to inject the hashed entry point.
//
// During `npm run dev` Vite serves at /, proxying /api to Django so the
// frontend can hit the backend without CORS rules.
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "trains/frontend"),
  base: "/static/trains/app/",
  build: {
    outDir: resolve(__dirname, "trains/static/trains/app"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: resolve(__dirname, "trains/frontend/index.html"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
