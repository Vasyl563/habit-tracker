import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev server proxies API paths to the Hono server → same origin in the
 * browser, so the session cookie flows without any CORS ceremony.
 * (The API still has a correct CORS allow-list for the non-proxied case.)
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3005", changeOrigin: false },
      "/rpc": { target: "http://localhost:3005", changeOrigin: false },
      "/v1": { target: "http://localhost:3005", changeOrigin: false },
      "/sse": { target: "http://localhost:3005", changeOrigin: false }
    }
  }
});
