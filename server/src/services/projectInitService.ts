import { constants as fsConstants } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { normalizePath } from "../utils/pathUtils.js";

const TEMPLATE_ITEMS = [
  { name: ".claude", type: "directory" },
  { name: ".codex", type: "directory" },
  { name: ".agents", type: "directory" },
  { name: "AGENTS.md", type: "file" },
] as const;

export type ProjectTemplateItemName = (typeof TEMPLATE_ITEMS)[number]["name"];
export type ProjectTemplateItemType = (typeof TEMPLATE_ITEMS)[number]["type"];
export type ProjectTemplateItemStatus = "ready" | "conflict" | "missing";

export interface ProjectInitPreviewItem {
  name: ProjectTemplateItemName;
  type: ProjectTemplateItemType;
  sourcePath: string;
  targetPath: string;
  status: ProjectTemplateItemStatus;
}

export interface ProjectInitPreview {
  templateRoot: string;
  targetPath: string;
  items: ProjectInitPreviewItem[];
  hasConflicts: boolean;
  hasMissing: boolean;
}

export interface ProjectInitDecision {
  name: ProjectTemplateItemName;
  overwrite: boolean;
}

export interface ProjectInitResultItem {
  name: ProjectTemplateItemName;
  action: "copied" | "skipped";
  targetPath: string;
}

export interface ProjectInitResult {
  targetPath: string;
  items: ProjectInitResultItem[];
}

export class ProjectInitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

const serviceDir = path.dirname(fileURLToPath(import.meta.url));

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function ancestors(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function templateScore(root: string): Promise<number> {
  const itemScore = await Promise.all(
    TEMPLATE_ITEMS.map((item) => exists(path.join(root, item.name)))
  );
  const packageScore = await fs.readFile(path.join(root, "package.json"), "utf-8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as { name?: unknown };
      return parsed.name === "fufan-cc-flow" ? 2 : 0;
    })
    .catch(() => 0);
  return itemScore.filter(Boolean).length + packageScore;
}

async function resolveTemplateRoot(): Promise<string> {
  const configured = process.env.FUFAN_TEMPLATE_ROOT;
  if (configured?.trim()) return path.resolve(normalizePath(configured.trim()));

  const candidates = unique([
    ...ancestors(process.cwd()),
    ...ancestors(serviceDir),
  ]);

  let best = candidates[0] ?? process.cwd();
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = await templateScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function assertWritableDirectory(targetPath: string): Promise<string> {
  const normalized = path.resolve(normalizePath(targetPath));
  const stat = await fs.stat(normalized).catch(() => null);
  if (!stat) {
    throw new ProjectInitError("TARGET_NOT_FOUND", "目标目录不存在", 404);
  }
  if (!stat.isDirectory()) {
    throw new ProjectInitError("TARGET_NOT_DIRECTORY", "目标路径不是目录");
  }
  await fs.access(normalized, fsConstants.W_OK).catch(() => {
    throw new ProjectInitError("TARGET_NOT_WRITABLE", "目标目录不可写", 403);
  });
  return normalized;
}

async function assertCopyCompatible(
  item: ProjectInitPreviewItem
): Promise<void> {
  const targetStat = await fs.stat(item.targetPath).catch(() => null);
  if (!targetStat) return;
  const targetType = targetStat.isDirectory() ? "directory" : "file";
  if (targetType !== item.type) {
    throw new ProjectInitError(
      "TARGET_TYPE_MISMATCH",
      `${item.name} 已存在但类型不匹配，请手动处理后再初始化`
    );
  }
}

export class ProjectInitService {
  async preview(targetPath: string): Promise<ProjectInitPreview> {
    const targetRoot = await assertWritableDirectory(targetPath);
    const templateRoot = await resolveTemplateRoot();

    if (samePath(templateRoot, targetRoot)) {
      // 目标就是模板源本身:它天然自带全部模板,无须(也不能)向自己复制。
      // 返回空清单让上层按"无冲突无缺失"直接放行,项目照常打开。
      return {
        templateRoot,
        targetPath: targetRoot,
        items: [],
        hasConflicts: false,
        hasMissing: false,
      };
    }

    const items = await Promise.all(
      TEMPLATE_ITEMS.map(async (item): Promise<ProjectInitPreviewItem> => {
        const sourcePath = path.join(templateRoot, item.name);
        const itemTargetPath = path.join(targetRoot, item.name);
        const sourceExists = await exists(sourcePath);
        const targetExists = await exists(itemTargetPath);
        return {
          name: item.name,
          type: item.type,
          sourcePath,
          targetPath: itemTargetPath,
          status: !sourceExists ? "missing" : targetExists ? "conflict" : "ready",
        };
      })
    );

    return {
      templateRoot,
      targetPath: targetRoot,
      items,
      hasConflicts: items.some((item) => item.status === "conflict"),
      hasMissing: items.some((item) => item.status === "missing"),
    };
  }

  async init(
    targetPath: string,
    decisions: ProjectInitDecision[]
  ): Promise<ProjectInitResult> {
    const preview = await this.preview(targetPath);
    const invalid = decisions.find(
      (decision) => !TEMPLATE_ITEMS.some((item) => item.name === decision.name)
    );
    if (invalid) {
      throw new ProjectInitError("INVALID_ITEM", `未知模板项: ${invalid.name}`);
    }
    if (preview.hasMissing) {
      const missing = preview.items
        .filter((item) => item.status === "missing")
        .map((item) => item.name)
        .join(", ");
      throw new ProjectInitError("TEMPLATE_ITEM_MISSING", `模板源缺失: ${missing}`);
    }

    const decisionMap = new Map(
      decisions.map((decision) => [decision.name, decision.overwrite])
    );
    const copied: ProjectInitResultItem[] = [];

    for (const [index, item] of preview.items.entries()) {
      const overwrite = decisionMap.get(item.name) === true;
      if (item.status === "conflict" && !overwrite) {
        copied.push({ name: item.name, action: "skipped", targetPath: item.targetPath });
        continue;
      }

      try {
        await assertCopyCompatible(item);
        await fs.cp(item.sourcePath, item.targetPath, {
          recursive: item.type === "directory",
          force: true,
          errorOnExist: false,
        });
        copied.push({ name: item.name, action: "copied", targetPath: item.targetPath });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ProjectInitError(
          "PROJECT_INIT_PARTIAL_FAILURE",
          `复制 ${item.name} 失败: ${message}`,
          500,
          {
            copied,
            failed: {
              name: item.name,
              targetPath: item.targetPath,
              message,
            },
            skippedRemaining: preview.items
              .slice(index + 1)
              .map((remaining) => remaining.name),
          }
        );
      }
    }

    return {
      targetPath: preview.targetPath,
      items: copied,
    };
  }
}
