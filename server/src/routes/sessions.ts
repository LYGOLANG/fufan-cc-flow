import { Router, type Router as RouterType } from "express";
import { SessionManager } from "../services/sessionManager.js";
import { getAgent } from "../services/agentRegistry.js";
import type { RewindRequest, RewindResult } from "../types/api.js";

const router: RouterType = Router();
const manager = new SessionManager();

router.get("/", async (req, res) => {
  // Pass projectPath to filter by project, or undefined to return all sessions
  const project = (req.query.project as string) || undefined;
  const sessions = await manager.listSessions(project);
  res.json({ sessions });
});

// GET /api/sessions/:id/messages — load historical messages for display
// Query params: offset (skip last N), limit (page size, default 50)
router.get("/:id/messages", async (req, res) => {
  try {
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const limit  = req.query.limit  ? Number(req.query.limit)  : 50;
    const messages = await manager.getSessionMessages(req.params.id, { offset, limit });
    // Extract total from first message tag (only present on offset=0)
    const total = (messages[0] as { total?: number })?.total ?? messages.length;
    res.json({ messages, total });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id/checkpoints — list file-history-snapshot entries
router.get("/:id/checkpoints", async (req, res) => {
  try {
    const result = await manager.getSessionCheckpoints(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/sessions/:id/rollback — restore files from a checkpoint snapshot
// 原先这里还有一条 POST /:id/rollback。它零调用方（前端走的是下面的 /rewind），
// 却能直接触发 manager.rollbackToCheckpoint() —— 一个会 restore/delete 用户
// 真实文件的操作。没有任何界面能到达的高危写接口，留着只是徒增攻击面，故移除。
//
// 服务层的 rollbackToCheckpoint 仍在用：/rewind 内部会在 SDK rewindFiles
// 不可用时回落到它。删的只是这条 HTTP 入口。

// POST /api/sessions/:id/rewind — SDK rewindFiles (preferred) or fallback to manual rollback
router.post("/:id/rewind", async (req, res) => {
  try {
    const { messageUuid, dryRun } = req.body as RewindRequest;
    if (!messageUuid) {
      return res.status(400).json({ canRewind: false, error: "messageUuid is required", method: "sdk" } satisfies RewindResult);
    }

    // 尝试 SDK rewindFiles（需要活跃的 stream）
    const service = getAgent(req.params.id);
    if (service && service.isRunning(req.params.id)) {
      const sdkResult = await service.rewindFiles(req.params.id, messageUuid, dryRun);
      return res.json({ ...sdkResult, method: "sdk" } satisfies RewindResult);
    }

    // Fallback: 手动 file-history 回滚（session 已结束时）
    if (dryRun) {
      // dryRun fallback: 只返回 checkpoint 中的文件列表
      const cpResult = await manager.getSessionCheckpoints(req.params.id);
      const cp = cpResult.checkpoints.find((c) => c.messageId === messageUuid);
      if (!cp) {
        return res.json({ canRewind: false, error: "Checkpoint not found", method: "fallback" } satisfies RewindResult);
      }
      return res.json({
        canRewind: true,
        filesChanged: cp.changedFiles.map((f) => f.path),
        method: "fallback",
      } satisfies RewindResult);
    }

    const rollbackResult = await manager.rollbackToCheckpoint(req.params.id, messageUuid);
    const filesChanged = rollbackResult.fileResults
      .filter((f) => f.action !== "skipped")
      .map((f) => f.path);
    return res.json({
      canRewind: rollbackResult.success,
      error: rollbackResult.error,
      filesChanged,
      method: "fallback",
    } satisfies RewindResult);
  } catch (err) {
    res.status(500).json({ canRewind: false, error: String(err), method: "fallback" } satisfies RewindResult);
  }
});

// PATCH /api/sessions/:id — rename a session
router.patch("/:id", async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) return res.status(400).json({ error: "name is required" });
    const ok = await manager.renameSession(req.params.id, name);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/:id", async (req, res) => {
  const ok = await manager.deleteSession(req.params.id);
  res.json({ success: ok });
});

export default router;
