import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Used in `npm run dev` only; in compose we proxy the built bundle
    // through Caddy and skip Vite entirely.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
