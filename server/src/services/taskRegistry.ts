/**
 * Task Registry — 运行中任务的落盘登记与「上次被中止」提醒
 *
 * 背景:运行中的任务只存在内存(claudeAgentService.activeStreams /
 * codexAgentService.activeProcs),进程被杀就全丢,重启后无从得知上次有任务被中断。
 *
 * 机制:
 *   - 每轮任务开始 → registerRunning() 写一条记录进 ~/.fufan-cc-flow/running-tasks.json
 *   - 正常完成 / 用户主动中止 / 关标签收尾 → markDone() 移除
 *   - 优雅关闭(SIGINT/SIGTERM 或 Tauri 的 /shutdown-all) → interruptAllRunning()
 *     把仍在运行的记录移入 interrupted 并【同步】落盘(异步写在退出路径上不可靠)
 *   - 硬杀/崩溃 → 文件里残留 running 记录,下次启动 initTaskRegistry() 把它们
 *     归入 interrupted(视为上次退出时被中止)
 *   - 前端启动时 GET /api/system/interrupted-tasks 拉取提醒,确认后 clear
 *
 * 每个项目同时最多一轮任务(chatHandler 的 ProjectSession 语义),故按 projectPath 索引。
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { logger } from "../utils/logger.js";

const REGISTRY_FILE = path.join(os.homedir(), ".fufan-cc-flow", "running-tasks.json");
const MAX_INTERRUPTED = 20;

export interface TaskRecord {
  projectPath: string;
  engine: "claude" | "codex";
  sessionId: string | null;
  /** prompt 前 120 字,仅用于提醒展示 */
  promptSnippet: string;
  startedAt: number;
  interruptedAt?: number;
}

interface RegistryFile {
  running: TaskRecord[];
  interrupted: TaskRecord[];
}

let state: RegistryFile = { running: [], interrupted: [] };

// ── 写串行化 ──
// 多个状态变更(registerRunning → updateSessionId → markDone)会快速连发 persist,
// 并发 writeFile 完成顺序不保证,旧快照可能后落地覆盖新快照。这里只保留「最新待写
// 快照」,单飞行写循环逐个落盘,天然去重且不乱序。
let pendingSnapshot: string | null = null;
let writing = false;

async function drainWrites(): Promise<void> {
  if (writing) return;
  writing = true;
  try {
    while (pendingSnapshot !== null) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      try {
        await fsp.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
        await fsp.writeFile(REGISTRY_FILE, snap, "utf-8");
      } catch (err) {
        logger.warn(`[taskRegistry] persist failed: ${String(err)}`);
      }
    }
  } finally {
    writing = false;
  }
}

function persistAsync(): void {
  pendingSnapshot = JSON.stringify(state, null, 2);
  void drainWrites();
}

/**
 * 退出路径专用:同步落盘,保证进程退出前终态已在磁盘上。
 * 若此刻还有一个异步写在飞(旧快照可能晚于本次落地把终态覆盖),
 * 把终态重新排队——drain 循环随后会用终态再写一遍,终态必胜。
 * (gracefulExit 有 300ms 退出缓冲,足够这次补写完成。)
 */
function persistSync(): void {
  const snap = JSON.stringify(state, null, 2);
  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, snap, "utf-8");
  } catch (err) {
    logger.warn(`[taskRegistry] sync persist failed: ${String(err)}`);
  }
  if (writing) {
    pendingSnapshot = snap; // 有在飞写:排队终态,由 drain 兜底覆盖
  } else {
    pendingSnapshot = null; // 无在飞写:磁盘已是终态,丢弃排队快照
  }
}

/**
 * 启动时调用:读文件;残留的 running 记录 = 上次退出(优雅或硬杀)时任务在跑,
 * 全部归入 interrupted 供前端提醒。
 */
export function initTaskRegistry(): void {
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    const data = JSON.parse(raw) as Partial<RegistryFile>;
    state = {
      running: [],
      interrupted: Array.isArray(data.interrupted) ? data.interrupted : [],
    };
    const leftovers = Array.isArray(data.running) ? data.running : [];
    if (leftovers.length > 0) {
      const now = Date.now();
      for (const rec of leftovers) {
        state.interrupted.push({ ...rec, interruptedAt: rec.interruptedAt ?? now });
      }
      logger.info(`[taskRegistry] ${leftovers.length} 个任务在上次退出时被中止,已记录待提醒`);
    }
    state.interrupted = state.interrupted.slice(-MAX_INTERRUPTED);
    if (leftovers.length > 0) persistAsync();
  } catch {
    state = { running: [], interrupted: [] };
  }
}

/** 一轮任务开始:登记(同项目旧记录直接覆盖)。 */
export function registerRunning(rec: Omit<TaskRecord, "interruptedAt">): void {
  state.running = state.running.filter((r) => r.projectPath !== rec.projectPath);
  state.running.push(rec);
  persistAsync();
}

/**
 * 任务正常结束 / 用户主动中止 / 关标签收尾:移除登记。
 * 传入 sessionId 时只删匹配的那条——防止上一轮任务的迟到 close 事件
 * (如 codex taskkill 异步完成)误删同项目新任务的登记。
 * 不传 sessionId(如关标签的全项目收尾)则删该项目所有登记。
 */
export function markDone(projectPath: string, sessionId?: string | null): void {
  const before = state.running.length;
  state.running = state.running.filter((r) => {
    if (r.projectPath !== projectPath) return true;
    if (sessionId && r.sessionId && r.sessionId !== sessionId) return true; // 不是这条任务,保留
    return false;
  });
  if (state.running.length !== before) persistAsync();
}

/** 首轮临时 id 换成真实 sessionId 时同步登记。 */
export function updateSessionId(projectPath: string, sessionId: string): void {
  const rec = state.running.find((r) => r.projectPath === projectPath);
  if (rec && rec.sessionId !== sessionId) {
    rec.sessionId = sessionId;
    persistAsync();
  }
}

/** 单项目任务被动中止(如寄存超时无人认领):移入 interrupted 供提醒。 */
export function interruptProject(projectPath: string): void {
  const rec = state.running.find((r) => r.projectPath === projectPath);
  if (!rec) return;
  state.running = state.running.filter((r) => r !== rec);
  state.interrupted.push({ ...rec, interruptedAt: Date.now() });
  state.interrupted = state.interrupted.slice(-MAX_INTERRUPTED);
  persistAsync();
}

/**
 * 优雅关闭:把所有仍在运行的任务标记为 interrupted 并同步落盘。
 * 返回被中止的数量。
 */
export function interruptAllRunning(): number {
  const n = state.running.length;
  if (n > 0) {
    const now = Date.now();
    for (const rec of state.running) {
      state.interrupted.push({ ...rec, interruptedAt: now });
    }
    state.interrupted = state.interrupted.slice(-MAX_INTERRUPTED);
    state.running = [];
  }
  persistSync();
  return n;
}

export function listInterrupted(): TaskRecord[] {
  return [...state.interrupted];
}

export function clearInterrupted(): void {
  state.interrupted = [];
  persistAsync();
}
