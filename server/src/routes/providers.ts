/**
 * /api/providers — 模型供应商配置
 *
 * GET    /            列出全部供应商(Key 掩码)
 * POST   /            新增自定义 Anthropic 兼容供应商
 * PUT    /:id         更新(apiKey/baseUrl/models/defaultModel/name)
 * DELETE /:id         删除自定义供应商
 * POST   /:id/test    连通性测试
 * POST   /:id/models  从端点刷新可用模型列表
 */
import { Router, type Router as RouterType } from "express";
import {
  listProviders,
  updateProvider,
  createCustomProvider,
  deleteProvider,
  testProvider,
  refreshProviderModels,
  hiddenBuiltinIds,
  restoreDefaultProviders,
} from "../services/providerService.js";

const router: RouterType = Router();

router.get("/", async (_req, res) => {
  try {
    const [providers, hiddenBuiltins] = await Promise.all([listProviders(), hiddenBuiltinIds()]);
    res.json({ providers, hiddenBuiltins });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 恢复所有被删除的内置供应商
router.post("/restore-defaults", async (_req, res) => {
  try {
    await restoreDefaultProviders();
    const [providers, hiddenBuiltins] = await Promise.all([listProviders(), hiddenBuiltinIds()]);
    res.json({ providers, hiddenBuiltins });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, baseUrl, apiKey, models } = req.body ?? {};
    const provider = await createCustomProvider({
      name: typeof name === "string" ? name : "",
      baseUrl: typeof baseUrl === "string" ? baseUrl : "",
      apiKey: typeof apiKey === "string" ? apiKey : undefined,
      models: Array.isArray(models) ? models.filter((m: unknown) => typeof m === "string") : undefined,
    });
    res.json({ provider });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const b = req.body ?? {};
    const provider = await updateProvider(req.params.id, {
      name: typeof b.name === "string" ? b.name : undefined,
      apiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
      baseUrl: typeof b.baseUrl === "string" ? b.baseUrl : undefined,
      models: Array.isArray(b.models) ? b.models.filter((m: unknown) => typeof m === "string") : undefined,
      defaultModel: typeof b.defaultModel === "string" ? b.defaultModel : undefined,
    });
    res.json({ provider });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteProvider(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/:id/test", async (req, res) => {
  try {
    res.json(await testProvider(req.params.id));
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/:id/models", async (req, res) => {
  try {
    const models = await refreshProviderModels(req.params.id);
    res.json({ models });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
