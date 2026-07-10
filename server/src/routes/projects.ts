import { Router, type Response, type Router as RouterType } from "express";
import {
  ProjectInitError,
  ProjectInitService,
  type ProjectInitDecision,
} from "../services/projectInitService.js";

const router: RouterType = Router();
const service = new ProjectInitService();

function getTargetPath(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { targetPath?: unknown }).targetPath;
  return typeof value === "string" && value.trim() ? value : null;
}

function getDecisions(body: unknown): ProjectInitDecision[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { decisions?: unknown }).decisions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { name: string; overwrite: boolean } => (
      !!item
      && typeof item === "object"
      && typeof (item as { name?: unknown }).name === "string"
      && typeof (item as { overwrite?: unknown }).overwrite === "boolean"
    ))
    .map((item) => ({
      name: item.name as ProjectInitDecision["name"],
      overwrite: item.overwrite,
    }));
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof ProjectInitError) {
    res.status(err.status).json({
      code: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  res.status(500).json({
    code: "PROJECT_INIT_FAILED",
    message: err instanceof Error ? err.message : String(err),
  });
}

router.post("/init/preview", async (req, res) => {
  const targetPath = getTargetPath(req.body);
  if (!targetPath) {
    return res.status(400).json({ code: "INVALID_REQUEST", message: "targetPath required" });
  }

  try {
    res.json(await service.preview(targetPath));
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/init", async (req, res) => {
  const targetPath = getTargetPath(req.body);
  if (!targetPath) {
    return res.status(400).json({ code: "INVALID_REQUEST", message: "targetPath required" });
  }

  try {
    res.json(await service.init(targetPath, getDecisions(req.body)));
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
