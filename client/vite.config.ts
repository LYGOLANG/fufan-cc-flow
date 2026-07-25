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
  build: {
    rollupOptions: {
      output: {
        // vendor 分组:框架与重量级渲染链各自成 chunk,业务代码更新时用户
        // 无需重新下载未变化的第三方库(独立 hash 长效缓存)
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-markdown": ["react-markdown", "remark-gfm"],
          "vendor-highlight": ["react-syntax-highlighter"],
        },
      },
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
