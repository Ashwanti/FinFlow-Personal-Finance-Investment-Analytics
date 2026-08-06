import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The dev server proxies /api to the backend rather than calling it
 * cross-origin.
 *
 * That matters more than it looks. The refresh token lives in an httpOnly
 * cookie scoped to /api/auth with SameSite=Lax; proxying makes the browser see
 * one origin, so the cookie is sent without relying on CORS, without
 * SameSite edge cases, and without the backend's CLIENT_ORIGIN having to match
 * whatever port Vite picked today.
 *
 * In production the two are usually served from one origin anyway. Set
 * VITE_API_URL if they are not — the client falls back to absolute URLs with
 * credentials included, which is what the backend's CORS config expects.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: false },
        "/health": { target, changeOrigin: false },
      },
    },
    build: { outDir: "dist", sourcemap: true },
  };
});
