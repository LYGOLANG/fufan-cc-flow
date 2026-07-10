import { Router, type Router as RouterType } from "express";
import { McpService, bumpMcpConfigVersion } from "../services/mcpService.js";

const router: RouterType = Router();
const service = new McpService();

router.get("/servers", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const engine = req.query.engine as string | undefined;
  // codex 引擎:读 codex 自己的 MCP(~/.codex/config.toml),只读展示,由 codex CLI 管理。
  if (engine === "codex") {
    const servers = await service.listCodexServers();
    return res.json({ servers, readonly: true, engine: "codex" });
  }
  const servers = await service.listServers(project);
  res.json({ servers, readonly: false, engine: "claude" });
});

router.post("/servers", async (req, res) => {
  try {
    await service.addServer(req.body);
    bumpMcpConfigVersion();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.delete("/servers/:name", async (req, res) => {
  try {
    await service.removeServer(req.params.name);
    bumpMcpConfigVersion();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.get("/servers/:name/config", async (req, res) => {
  const project = req.query.project as string | undefined;
  const result = await service.getServerConfig(req.params.name, project);
  if (!result) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
  }
  res.json(result);
});

router.patch("/servers/:name/config", async (req, res) => {
  try {
    const { config, scope } = req.body;
    const project = req.query.project as string | undefined;
    await service.updateServerConfig(req.params.name, config, scope, project);
    bumpMcpConfigVersion();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.post("/servers/json", async (req, res) => {
  try {
    const { name, json, scope } = req.body;
    if (!name || !json) {
      return res.status(400).json({ error: { code: "INVALID_PARAMS", message: "name and json are required" } });
    }
    await service.addServerJson(name, typeof json === "string" ? json : JSON.stringify(json), scope);
    bumpMcpConfigVersion();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.post("/import-desktop", async (_req, res) => {
  try {
    const imported = await service.importFromDesktop();
    if (imported.length > 0) bumpMcpConfigVersion();
    res.json({ imported, count: imported.length });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

export default router;
