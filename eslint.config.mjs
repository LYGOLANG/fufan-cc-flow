// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * ESLint 配置 —— 定位是「自动抓真 bug」,不是「统一代码风格」。
 *
 * 风格已经由 Prettier 负责(pnpm format),所以这里刻意不开任何格式类规则:
 * 两套工具抢同一件事只会互相打架、并让开发者学会无视告警。留下的每条规则
 * 都对应一类真实会出事的写法,尤其是 react-hooks 那两条 —— 依赖数组写漏
 * 导致的闭包过期,是这个项目已经踩过的 bug 类型。
 */
export default tseslint.config(
  {
    // 构建产物、依赖、Rust 目标目录不参与检查
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/target/**",
      "client/src-tauri/server-dist/**",
      "client/src-tauri/binaries/**",
      "release/**",
    ],
  },

  // ── 前端:浏览器环境 + React Hooks 规则 ──
  {
    files: ["client/src/**/*.{ts,tsx}", "client/tests/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Hooks 的调用位置规则被破坏时,状态会在渲染之间错位 —— 必须是 error
      "react-hooks/rules-of-hooks": "error",
      // 依赖数组写漏 => 闭包读到过期的 state。项目里已有若干处经过评估的
      // 显式 eslint-disable,所以定为 warn:新写的会被提示,老的不阻断构建。
      "react-hooks/exhaustive-deps": "warn",
      ...sharedRules(),
    },
  },

  // ── 后端:Node 环境 ──
  {
    files: ["server/src/**/*.ts", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: sharedRules(),
  }
);

/** 前后端共用的规则集合 */
function sharedRules() {
  return {
    // 未使用的变量往往是重构残留或写错了名字。以 _ 开头表示「有意忽略」。
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],
    // any 会让类型检查在该处彻底失效,但存量不少,先记为 warn 逐步收敛
    "@typescript-eslint/no-explicit-any": "warn",
    // 下面几条是真会导致运行时行为出错的写法
    "no-constant-binary-expression": "error", // 如 `a ?? b === c` 这类优先级误解
    "no-self-compare": "error",
    "no-unmodified-loop-condition": "error", // 死循环
    "no-unreachable-loop": "error",
    "no-promise-executor-return": "error",
    "no-unsafe-finally": "error", // finally 里 return 会吞掉正在传播的异常
    // async 竞态。JS 是单线程,「await 后给对象属性赋值」在绝大多数情况下
    // 是安全的,这条规则对此误报很多,所以只作提示、不阻断。
    "require-atomic-updates": "warn",
    // 全角空格(U+3000)在中文 JSX 文案里是正当的排版手段,只在代码里禁止
    "no-irregular-whitespace": ["error", { skipJSXText: true, skipStrings: true, skipTemplates: true }],
    eqeqeq: ["warn", "smart"],
  };
}
