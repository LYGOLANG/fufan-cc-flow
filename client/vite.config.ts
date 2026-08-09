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
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      output: {
        // vendor 分组:框架与重量级渲染链各自成 chunk,业务代码更新时用户
        // 无需重新下载未变化的第三方库(独立 hash 长效缓存)
        //
        // 注意必须逐个列出「实际被 import 的入口」,而不是只写包名:
        // 对象形式的 manualChunks 是按模块 id 匹配的,"react-dom" 只对应
        // 那个仅 re-export flushSync/createPortal 的 CJS 门面(约 4KB),
        // 真正 180KB+ 的 react-dom/client(main.tsx 用的那个)不会被匹配到,
        // 会当成业务代码的普通依赖留在主 chunk 里 —— 分组看着生效实则没有。
        // react/jsx-runtime 同理:自动 JSX 转换下每个 tsx 文件都 import 它。
        manualChunks: {
          // 不列 scheduler:它不是本项目的直接依赖,pnpm 的严格 node_modules
          // 结构下 rollup 无法把它当入口解析(会报 Could not resolve entry module)。
          // 它是 react-dom 的依赖,会自然被带进同一个 chunk。
          "vendor-react": ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
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
