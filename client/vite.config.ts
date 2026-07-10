import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const devBackendPort = process.env.DEV_BACKEND_PORT || "3001";
const devBackendHttp = `http://127.0.0.1:${devBackendPort}`;
const devBackendWs = `ws://127.0.0.1:${devBackendPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5273,
    proxy: {
      "/api": {
        target: devBackendHttp,
        changeOrigin: true,
      },
      "/ws": {
        target: devBackendWs,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
