import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 可移植性约束的守卫测试。
 *
 * Product-Spec 第 11.2 节的决策是「编排引擎第一版写在 Node 侧，但核心逻辑与
 * 传输层解耦，使纯 Rust 迁移时是翻译而非重新设计」。这个约束靠人自觉守不住 ——
 * 后来者要往 engine 里塞一个 logger 或直接读 WebSocket 都很顺手，而破坏之后
 * 没有任何报错，只有迁移那天才会发现整块要重写。
 *
 * 所以把它变成会失败的测试。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(here, f), "utf8");

/** 不允许出现在引擎核心里的依赖 */
const FORBIDDEN = [
  { pattern: /from\s+["']express["']/, name: "express" },
  { pattern: /from\s+["']ws["']/, name: "ws" },
  { pattern: /from\s+["']node:http["']|from\s+["']http["']/, name: "http" },
  { pattern: /from\s+["']node:fs["']|from\s+["']fs["']/, name: "fs（引擎不该碰文件系统）" },
  { pattern: /\.\.\/claudeAgentService/, name: "claudeAgentService（应经 StepRunner 接口）" },
  { pattern: /\.\.\/\.\.\/websocket/, name: "websocket 目录" },
];

test("engine.ts 不依赖任何传输层或具体执行实现", () => {
  const src = read("engine.ts");
  for (const { pattern, name } of FORBIDDEN) {
    assert.ok(
      !pattern.test(src),
      `engine.ts 不应依赖 ${name} —— 它必须能原样翻译到 Rust，见 Product-Spec 第 11.2 节`
    );
  }
});

test("engine.ts 只 import 同目录下的类型定义", () => {
  const src = read("engine.ts");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(
      spec.startsWith("./"),
      `engine.ts 出现了非同目录 import: ${spec}。核心逻辑应保持自足。`
    );
  }
});

test("stepRunner.ts 是纯接口定义，不含具体实现依赖", () => {
  const src = read("stepRunner.ts");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(imports, [], "抽象接口不应 import 任何东西");
});
