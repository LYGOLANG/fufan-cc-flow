import { Router, type Router as RouterType } from "express";
import { PluginService } from "../services/pluginService.js";
import { BundledPluginService } from "../services/bundledPluginService.js";

const router: RouterType = Router();
const service = new PluginService();
const bundled = new BundledPluginService();

router.get("/", async (_req, res) => {
  const plugins = await service.listPlugins();
  res.json({ plugins });
});

/**
 * 随应用分发的内置插件。
 * 必须注册在 `/:name` 之前 —— Express 按声明顺序匹配，放在后面会被
 * `DELETE|PATCH /:name` 之外的 `GET /:name` 之类路由抢走（将来加了就出事）。
 */
router.get("/bundled", async (_req, res) => {
  try {
    res.json({ plugins: await bundled.list() });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.post("/bundled/install", async (req, res) => {
  try {
    await bundled.install(String(req.body?.id ?? ""));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

/** 读本地文件夹的插件信息（安装前确认「这是什么」） */
router.post("/local/inspect", async (req, res) => {
  try {
    const p = String(req.body?.path ?? "").trim();
    if (!p) throw new Error("未提供文件夹路径");
    res.json({ plugin: await bundled.inspect(p) });
  } catch (err) {
    res.status(400).json({
      error: { code: "INVALID_PLUGIN", message: err instanceof Error ? err.message : String(err) },
    });
  }
});

/** 从本地文件夹安装插件 */
router.post("/local/install", async (req, res) => {
  try {
    const p = String(req.body?.path ?? "").trim();
    if (!p) throw new Error("未提供文件夹路径");
    await bundled.installFromPath(p);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: { code: "PROCESS_ERROR", message: err instanceof Error ? err.message : String(err) },
    });
  }
});

router.post("/install", async (req, res) => {
  try {
    await service.installPlugin(req.body.name, req.body.scope);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.delete("/:name", async (req, res) => {
  try {
    await service.uninstallPlugin(req.params.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

router.patch("/:name", async (req, res) => {
  try {
    await service.togglePlugin(req.params.name, req.body.enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { code: "PROCESS_ERROR", message: String(err) } });
  }
});

export default router;
