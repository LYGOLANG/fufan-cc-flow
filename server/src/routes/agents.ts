import { Router, type Router as RouterType } from "express";
import { AgentService } from "../services/agentService.js";

const router: RouterType = Router();

/**
 * scope 必须是显式白名单。
 *
 * 原先是裸断言 `req.params.scope as "project" | "user"`,任何非 "project"
 * 的值(包括拼错的、恶意构造的)都会走进 else 分支 => 落到**用户全局目录**,
 * 把爆炸半径从单个项目扩大到整个用户配置。
 */
function parseScope(raw: unknown): "project" | "user" {
  if (raw === "project" || raw === "user") return raw;
  throw Object.assign(new Error('scope 必须是 "project" 或 "user"'), { statusCode: 400 });
}

const service = new AgentService();

router.get("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const agents = await service.listAgents(project);
  res.json(agents);
});

router.get("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const agent = await service.getAgent(scope, req.params.name, project);
  if (!agent) {
    return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } });
  }
  res.json(agent);
});

router.post("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const { scope, name, frontmatter, content } = req.body;
  try {
    const agentPath = await service.saveAgent(scope, name, frontmatter, content, project);
    res.json({ success: true, path: agentPath });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.put("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const { frontmatter, content } = req.body;
  try {
    await service.saveAgent(scope, req.params.name, frontmatter, content, project);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.delete("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const ok = await service.deleteAgent(scope, req.params.name, project);
  res.json({ success: ok });
});

export default router;
