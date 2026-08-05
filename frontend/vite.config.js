import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Backend port varies per machine (e.g. 8000 is taken by other local
  // software on some setups), so it's overridable via BACKEND_PORT in a
  // local .env.local (gitignored) instead of hardcoded here.
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.BACKEND_PORT || "8000";

  return {
    plugins: [react()],
    base: "./",
    build: {
      outDir: "dist",
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
