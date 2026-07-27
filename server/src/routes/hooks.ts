import { Router, type Router as RouterType } from "express";
import { listHooks, saveHooks, sanitizeHooksConfig } from "../services/hooksService.js";

/** 校验类错误自带 statusCode(400/403);其余按 500 处理,不把内部细节当用户提示 */
function statusOf(err: unknown): number {
  const code = (err as { statusCode?: unknown })?.statusCode;
  return typeof code === "number" ? code : 500;
}

const router: RouterType = Router();

type HooksScope = "user" | "project" | "project-local";
const VALID_SCOPES = new Set(["user", "project", "project-local"]);

function parseScope(raw?: string): HooksScope {
  if (raw && VALID_SCOPES.has(raw)) return raw as HooksScope;
  return "user";
}

router.get("/", async (req, res) => {
  try {
    const scope = parseScope(req.query.scope as string);
    const project = req.query.project as string | undefined;
    const hooks = await listHooks(scope, project);
    res.json({ hooks });
  } catch (err) {
    const status = statusOf(err);
    res.status(status).json({
      error: { code: "HOOKS_READ_ERROR", message: status === 500 ? String(err) : (err as Error).message },
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const scope = parseScope(req.query.scope as string);
    const project = req.query.project as string | undefined;
    // 结构校验 + 路径校验都在下游抛带 statusCode 的错误。
    // 这个接口写的是 Claude Code 自己要读的 settings.json,且 hook 的 command
    // 会在会话启动时执行,所以入参一律先过闸再落盘。
    await saveHooks(sanitizeHooksConfig(req.body?.hooks ?? {}), scope, project);
    res.json({ success: true });
  } catch (err) {
    const status = statusOf(err);
    res.status(status).json({
      error: { code: "HOOKS_WRITE_ERROR", message: status === 500 ? String(err) : (err as Error).message },
    });
  }
});

export default router;
