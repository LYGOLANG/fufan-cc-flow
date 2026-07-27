import { Router, type Router as RouterType } from "express";
import { SkillService } from "../services/skillService.js";

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

const service = new SkillService();

router.get("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const skills = await service.listSkills(project);
  res.json(skills);
});

router.post("/generate", async (req, res) => {
  const { description, model } = req.body;
  if (!description || typeof description !== "string") {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "description is required" } });
  }
  try {
    const result = await service.generateSkill(description, model);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = msg.includes("abort") || (err as Error)?.name === "AbortError";
    res.status(isAbort ? 408 : 500).json({
      error: { code: isAbort ? "TIMEOUT" : "PROCESS_ERROR", message: msg },
    });
  }
});

router.get("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const skill = await service.getSkill(scope, req.params.name, project);
  if (!skill) {
    return res.status(404).json({ error: { code: "FILE_NOT_FOUND", message: "Skill not found" } });
  }
  res.json(skill);
});

router.post("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const { scope, name, frontmatter, content } = req.body;
  try {
    const skillPath = await service.saveSkill(scope, name, frontmatter, content, project);
    res.json({ success: true, path: skillPath });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.put("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const { frontmatter, content } = req.body;
  try {
    await service.saveSkill(scope, req.params.name, frontmatter, content, project);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.delete("/:scope/:name", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const scope = parseScope(req.params.scope);
  const ok = await service.deleteSkill(scope, req.params.name, project);
  res.json({ success: ok });
});

export default router;
