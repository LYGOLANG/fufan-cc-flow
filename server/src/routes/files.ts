import { Router, type Router as RouterType } from "express";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FileService } from "../services/fileService.js";
import { assertWithinRoot, getClaudeHome } from "../utils/pathUtils.js";
import { httpError, statusOf, messageOf } from "../utils/httpError.js";

const router: RouterType = Router();
const service = new FileService();

/**
 * 取写操作的目标路径:projectRoot 必填,且目标必须落在其内。
 *
 * 此前 projectRoot 是**可选** body 字段,不传就整条检查跳过 —— 也就是说
 * 「文件写操作校验路径在项目目录内」这条承诺，调用方自己就能关掉。
 * 前端所有写操作(FileTree 的新建/重命名/删除)本来就一直在传它,改成必填
 * 不影响任何现有功能。
 *
 * 注意这层校验的定位:它防的是自家 bug 和误操作、限制爆炸半径。它挡不住
 * 恶意调用方——对方可以自己把 projectRoot 也填成想去的地方。真正的边界是
 * 接口鉴权,那是另一件事。
 */
function resolveWriteTarget(rawPath: unknown, rawRoot: unknown, label: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw httpError(400, `${label} 不能为空`);
  }
  if (typeof rawRoot !== "string" || !rawRoot.trim()) {
    throw httpError(400, "projectRoot 是必填项(用于限定写操作范围)");
  }
  return assertWithinRoot(rawRoot, rawPath, label);
}

// GET /api/files/tree?path=/project&depth=3
router.get("/tree", async (req, res) => {
  const rootPath = (req.query.path as string) || process.cwd();
  const depth = parseInt(req.query.depth as string) || 3;
  const exclude = req.query.exclude
    ? (req.query.exclude as string).split(",")
    : undefined;

  try {
    const tree = await service.getTree(rootPath, depth, exclude);
    res.json(tree);
  } catch (err) {
    res.status(404).json({ error: { code: "FILE_NOT_FOUND", message: String(err) } });
  }
});

/**
 * 读文件允许的根目录。
 *
 * 这个端点此前零校验,可以读走 ~/.claude/.credentials.json、providers.json、
 * .ssh/id_rsa —— 也就是本应用自己存的全部 API Key。讽刺的是 privateFile.ts
 * 还专门用 icacls 给 providers.json 加了 ACL 硬化,这个端点把它原样发出去。
 *
 * 但不能简单锁死在项目内:技能浏览器要读 ~/.claude/skills 下的文件,那是合法
 * 场景。所以允许根 = 传入的项目根 ∪ Claude/Codex 配置目录,并额外把配置目录
 * 里真正敏感的文件挡掉。
 */
function allowedReadRoots(projectRoot?: string): string[] {
  const roots = [getClaudeHome(), path.join(os.homedir(), ".codex")];
  if (typeof projectRoot === "string" && projectRoot.trim()) roots.push(projectRoot);
  return roots;
}

/** 即便落在允许的根内,这些文件也不该经此端点读出去 */
const SENSITIVE_BASENAMES = new Set([
  ".credentials.json",
  "auth.json",
  "providers.json",
  ".env",
]);

// GET /api/files/content?path=/project/src/app.js&root=/project
router.get("/content", async (req, res) => {
  const filePath = req.query.path as string;
  const root = req.query.root as string | undefined;
  if (!filePath) {
    return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "path required" } });
  }

  try {
    const roots = allowedReadRoots(root);
    let resolved: string | null = null;
    for (const r of roots) {
      try {
        resolved = assertWithinRoot(r, filePath, "path");
        break;
      } catch {
        /* 换下一个允许根继续试 */
      }
    }
    if (!resolved) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "该路径不在当前项目或配置目录内" },
      });
    }
    if (SENSITIVE_BASENAMES.has(path.basename(resolved).toLowerCase())) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "该文件包含凭据,不允许通过此接口读取" },
      });
    }
    const data = await service.getFileContent(resolved);
    res.json(data);
  } catch (err) {
    res.status(statusOf(err) === 500 ? 404 : statusOf(err)).json({
      error: { code: "FILE_NOT_FOUND", message: messageOf(err, "文件不存在或无法读取") },
    });
  }
});

// GET /api/files/raw?path=<abs-or-rel>&base=<projectRoot>
// 以原始字节流返回本地图片文件,供聊天界面内联展示会话中生成的图片。
// 仅允许图片扩展名;相对路径按 base(项目根)解析。
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};
const RAW_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

router.get("/raw", async (req, res) => {
  const reqPath = req.query.path as string;
  const base = req.query.base as string | undefined;
  if (!reqPath) {
    return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "path required" } });
  }
  try {
    const resolved = path.isAbsolute(reqPath)
      ? path.normalize(reqPath)
      : path.resolve(base || process.cwd(), reqPath);
    const type = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
    if (!type) {
      return res.status(415).json({ error: { code: "UNSUPPORTED_TYPE", message: "仅支持图片文件" } });
    }
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > RAW_IMAGE_MAX_BYTES) {
      return res.status(413).json({ error: { code: "TOO_LARGE", message: "文件过大或不是常规文件" } });
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    res.send(await fs.readFile(resolved));
  } catch {
    res.status(404).json({ error: { code: "FILE_NOT_FOUND", message: "图片不存在" } });
  }
});

// GET /api/files/browse?path=<absolutePath>
// Returns immediate children (dirs first) of the given path.
// Without path, returns logical root entries (drives on Windows, / on Unix).
router.get("/browse", async (req, res) => {
  const reqPath = req.query.path as string | undefined;

  try {
    if (!reqPath) {
      // ── Logical root: platform-specific "top-level" locations ──
      const entries: { name: string; type: "dir"; path: string }[] = [];

      if (process.platform === "win32") {
        // Enumerate existing Windows drives (C–Z)
        const driveLetters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        for (const letter of driveLetters) {
          const drivePath = `${letter}:\\`;
          const exists = await fs.access(drivePath).then(() => true).catch(() => false);
          if (exists) entries.push({ name: `${letter}:`, type: "dir", path: drivePath });
        }
        // Also expose home dir as a convenient shortcut
        const home = os.homedir();
        entries.push({ name: `🏠 主目录 (${path.basename(home)})`, type: "dir", path: home });
      } else {
        // Mac/Linux: expose home + /
        entries.push({ name: "🏠 主目录", type: "dir", path: os.homedir() });
        entries.push({ name: "/ (根目录)", type: "dir", path: "/" });
      }

      return res.json({ path: null, parent: null, entries });
    }

    // ── Directory listing ──
    const normalized = path.normalize(reqPath);
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "指定路径不是目录" });
    }

    const names = await fs.readdir(normalized);
    const rawEntries = await Promise.all(
      names.map(async (name) => {
        const fullPath = path.join(normalized, name);
        const s = await fs.stat(fullPath).catch(() => null);
        if (!s) return null;
        return { name, type: s.isDirectory() ? ("dir" as const) : ("file" as const), path: fullPath };
      })
    );

    // Dirs first, then files; both sorted alphabetically (case-insensitive)
    const entries = rawEntries
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

    // Compute parent path (null if already at drive root or /)
    const parent = (() => {
      const p = path.dirname(normalized);
      return p === normalized ? null : p; // dirname of root == root
    })();

    return res.json({ path: normalized, parent, entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/files/mkdir  body: { path: string, projectRoot?: string }
//
// 这里的 projectRoot 是**有意**保持可选的,别顺手改成必填:
// FolderBrowserModal 的「新建文件夹」用于给新项目选位置(client 侧调用不传
// projectRoot),此时根本还没有项目根。传了就按项目内校验,不传则只创建空目录
// —— 破坏力远小于 create/rename/delete,那三个已改为必填。
router.post("/mkdir", async (req, res) => {
  const folderPath = req.body?.path as string | undefined;
  const projectRoot = req.body?.projectRoot as string | undefined;
  if (!folderPath) {
    return res.status(400).json({ error: "path is required" });
  }

  try {
    const normalized = projectRoot
      ? assertWithinRoot(projectRoot, folderPath, "path")
      : path.normalize(folderPath);
    await fs.mkdir(normalized, { recursive: true });
    return res.json({ path: normalized });
  } catch (err) {
    res.status(statusOf(err)).json({ error: messageOf(err, "创建目录失败") });
  }
});

// POST /api/files/create  body: { filePath: string, content?: string, projectRoot: string }
router.post("/create", async (req, res) => {
  const content = (req.body?.content as string) ?? "";
  try {
    const normalized = resolveWriteTarget(req.body?.filePath, req.body?.projectRoot, "filePath");
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(normalized), { recursive: true });
    // Fail if file already exists
    const exists = await fs.access(normalized).then(() => true).catch(() => false);
    if (exists) {
      return res.status(409).json({ error: "文件已存在" });
    }
    await fs.writeFile(normalized, content, "utf-8");
    return res.json({ path: normalized });
  } catch (err) {
    res.status(statusOf(err)).json({ error: messageOf(err, "创建文件失败") });
  }
});

// POST /api/files/rename  body: { oldPath: string, newPath: string, projectRoot: string }
router.post("/rename", async (req, res) => {
  try {
    // 两端都要校验:只校验其中一个,就能把文件重命名到项目外
    const normalizedOld = resolveWriteTarget(req.body?.oldPath, req.body?.projectRoot, "oldPath");
    const normalizedNew = resolveWriteTarget(req.body?.newPath, req.body?.projectRoot, "newPath");
    // Check target doesn't already exist
    const exists = await fs.access(normalizedNew).then(() => true).catch(() => false);
    if (exists) {
      return res.status(409).json({ error: "目标路径已存在" });
    }
    await fs.rename(normalizedOld, normalizedNew);
    return res.json({ oldPath: normalizedOld, newPath: normalizedNew });
  } catch (err) {
    res.status(statusOf(err)).json({ error: messageOf(err, "重命名失败") });
  }
});

// DELETE /api/files/delete  body: { filePath: string, projectRoot: string }
// 这是全仓破坏力最大的一个端点(fs.rm recursive),projectRoot 必填且强制校验。
router.delete("/delete", async (req, res) => {
  try {
    const normalized = resolveWriteTarget(req.body?.filePath, req.body?.projectRoot, "filePath");
    // 不允许删除项目根本身:传 filePath === projectRoot 时 assertWithinRoot 会放行
    // (根算在自己内),但那等于一键清空整个项目。
    if (normalized === path.resolve(req.body.projectRoot as string)) {
      return res.status(403).json({ error: "不能删除项目根目录" });
    }
    await fs.rm(normalized, { recursive: true });
    return res.json({ success: true });
  } catch (err) {
    res.status(statusOf(err)).json({ error: messageOf(err, "删除失败") });
  }
});

// GET /api/files/search?path=/project&query=auth
router.get("/search", async (req, res) => {
  const rootPath = (req.query.path as string) || process.cwd();
  const query = req.query.query as string;
  if (!query) {
    return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "query required" } });
  }

  const results = await service.searchFiles(rootPath, query);
  res.json({ results });
});

export default router;
