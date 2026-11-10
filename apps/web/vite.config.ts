import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

/**
 * Dev and preview servers proxy the API and the WebSocket to the arena
 * server. The browser only ever talks to its own origin, so the same build
 * works behind Caddy in production (Phase 4): Caddy forwards `/api/*` and
 * `/ws` to the server the same way.
 *
 * VITE_API_BASE: where the arena server listens (default http://localhost:8080,
 * the server's own PORT default).
 */
export default defineConfig(() => {
  const target = process.env.VITE_API_BASE ?? "http://localhost:8080";
  const wsTarget = target.replace(/^http/, "ws");
  const proxy = {
    // The server mounts REST at its root; the UI calls /api/v1/*.
    "/api/v1": { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api\/v1/, "") },
    "/ws": { target: wsTarget, ws: true, changeOrigin: true },
  };
  return {
    plugins: [react()],
    // Workspace packages resolve to their TypeScript source (DECISIONS-P1), so the
    // UI never needs a prior `tsc -b` of packages/protocol.
    resolve: { conditions: ["source", ...defaultClientConditions] },
    server: { port: 5173, strictPort: false, proxy },
    preview: { port: 4173, strictPort: false, proxy },
    build: { outDir: "dist", sourcemap: true, target: "es2022" },
  };
});
