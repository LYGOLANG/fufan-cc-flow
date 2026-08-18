import { homedir } from "os";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import { runClaudeCommand } from "../utils/runClaudeCommand.js";
import { normalizePath } from "../utils/pathUtils.js";

/**
 * 随应用分发的内置插件。
 *
 * 为什么要有这层：Claude Code 的插件必须先落进一个 marketplace 目录、在
 * `known_marketplaces.json` 注册，才能被 `claude plugin install` 装上。插件
 * 作者通常附一个 install.sh 让用户去命令行跑一遍 —— 而 Agent Flow 的用户
 * 多半是冲着「不碰命令行」来的，那一步就是劝退点。这里把同样的事在后端做完：
 * 复制 → 注册 marketplace → install，界面上就是一个按钮。
 *
 * 插件本体随包（见 client/scripts/prepare-sidecar.mjs 把 bundled-plugins/
 * 拷进 server-dist），所以换台电脑装完 Agent Flow 就自带，不依赖用户手里
 * 还留着那个文件夹。
 */

export interface BundledPluginInfo {
  /** 目录名，也是安装 API 的入参 */
  id: string;
  /** plugin.json 里的 name，`claude plugin install` 用的就是它 */
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: string;
  /** 已经装进 ~/.claude/plugins 了吗 */
  installed: boolean;
  components: {
    skills: string[];
    agents: string[];
    hooks: boolean;
  };
}

/** 内置插件落地后所在的本地 marketplace 名，出现在插件列表的「来源」里 */
const MARKETPLACE_NAME = "agent-flow-bundled";

const PLUGINS_DIR = path.join(homedir(), ".claude", "plugins");
const INSTALLED_PLUGINS_PATH = path.join(PLUGINS_DIR, "installed_plugins.json");
/**
 * 本地 marketplace 的落地位置。
 *
 * **不能直接指向 server-dist 里的随包目录**：应用升级时整个 server-dist 会被
 * 覆盖重建，而 Claude Code 的 installed_plugins.json 记的是绝对路径 ——
 * 升级一次用户的插件就指向了一个刚被删掉又重建的目录。复制到用户目录下，
 * 生命周期就和 Agent Flow 的安装包解耦了。
 */
const MARKETPLACE_ROOT = path.join(homedir(), ".claude", "agent-flow-plugins");

const serviceDir = path.dirname(fileURLToPath(import.meta.url));

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

/**
 * 找到随包的 bundled-plugins 目录。
 *
 * 三种运行形态路径不同，逐个试：dev 时在仓库根；打包后 server 跑在
 * server-dist/dist/ 里，目录在它的上级；FUFAN_BUNDLED_PLUGINS 供测试覆盖。
 */
async function resolveBundledRoot(): Promise<string | null> {
  const configured = process.env.FUFAN_BUNDLED_PLUGINS;
  if (configured?.trim()) {
    const p = path.resolve(normalizePath(configured.trim()));
    return (await exists(p)) ? p : null;
  }

  const candidates: string[] = [];
  // 从 service 文件位置和进程工作目录同时上溯，覆盖 dev/打包两种布局
  for (const start of [serviceDir, process.cwd()]) {
    let cur = path.resolve(start);
    for (let i = 0; i < 6; i += 1) {
      candidates.push(path.join(cur, "bundled-plugins"));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return null;
}

/** 已装插件名集合，用来标注「已安装」 */
async function readInstalledNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const raw = await fs.readFile(INSTALLED_PLUGINS_PATH, "utf-8");
    const data = JSON.parse(raw) as { plugins?: Record<string, unknown> };
    for (const key of Object.keys(data.plugins ?? {})) {
      const atIdx = key.indexOf("@");
      names.add(atIdx > 0 ? key.slice(0, atIdx) : key);
    }
  } catch {
    // 一个插件都没装过时这个文件不存在，属正常
  }
  return names;
}

export class BundledPluginService {
  async list(): Promise<BundledPluginInfo[]> {
    const root = await resolveBundledRoot();
    if (!root) return [];

    let dirs: string[];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    const installedNames = await readInstalledNames();
    const result: BundledPluginInfo[] = [];

    for (const id of dirs) {
      const dir = path.join(root, id);
      let meta: {
        name?: string;
        displayName?: string;
        version?: string;
        description?: string;
        author?: { name?: string };
      };
      try {
        meta = JSON.parse(
          await fs.readFile(path.join(dir, ".claude-plugin", "plugin.json"), "utf-8")
        );
      } catch {
        // 没有 manifest 的目录不当作插件，跳过 —— 宁可少列一个，
        // 也不要列出一个装不上的条目
        continue;
      }
      const name = meta.name?.trim();
      if (!name) continue;

      result.push({
        id,
        name,
        displayName: meta.displayName,
        version: meta.version,
        description: meta.description,
        author: meta.author?.name,
        installed: installedNames.has(name),
        components: {
          skills: await this.listDirNames(path.join(dir, "skills")),
          agents: (await this.listDirNames(path.join(dir, "agents"), true)).map((f) =>
            f.replace(/\.md$/i, "")
          ),
          hooks: await exists(path.join(dir, "hooks", "hooks.json")),
        },
      });
    }

    return result;
  }

  private async listDirNames(dir: string, files = false): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => (files ? e.isFile() : e.isDirectory())).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * 一键安装：复制到本地 marketplace → 写 marketplace 清单 → 注册 → install。
   *
   * 等价于插件自带 install.sh 干的事，区别是全在后端跑完，用户只点一个按钮。
   */
  async install(id: string): Promise<void> {
    // 目录名直接来自用户请求，必须挡住路径穿越：只允许简单标识符
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") {
      throw new Error(`非法的插件标识：${JSON.stringify(id).slice(0, 60)}`);
    }

    const root = await resolveBundledRoot();
    if (!root) throw new Error("未找到随包插件目录（bundled-plugins）");

    return this.installFromPath(path.join(root, id), id);
  }

  /**
   * 读一个本地插件文件夹的元信息，供界面在安装前展示「这是什么」。
   * 结构不合法时抛错，让用户当场知道选错了目录，而不是装完才发现没反应。
   */
  async inspect(sourcePath: string): Promise<{
    name: string;
    displayName?: string;
    version?: string;
    description?: string;
    author?: string;
    installed: boolean;
    components: { skills: string[]; agents: string[]; hooks: boolean };
  }> {
    const source = path.resolve(normalizePath(sourcePath));
    const manifestPath = path.join(source, ".claude-plugin", "plugin.json");
    if (!(await exists(manifestPath))) {
      throw new Error(
        "这个文件夹不是 Claude Code 插件：缺少 .claude-plugin/plugin.json。\n" +
          "请选择插件本身的文件夹（里面应有 .claude-plugin 目录）。"
      );
    }
    let meta: {
      name?: string;
      displayName?: string;
      version?: string;
      description?: string;
      author?: { name?: string };
    };
    try {
      meta = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch (e) {
      throw new Error(`plugin.json 解析失败：${String(e)}`, { cause: e });
    }
    const name = meta.name?.trim();
    if (!name) throw new Error("plugin.json 缺少 name 字段，无法确定插件标识");

    const installedNames = await readInstalledNames();
    return {
      name,
      displayName: meta.displayName,
      version: meta.version,
      description: meta.description,
      author: meta.author?.name,
      installed: installedNames.has(name),
      components: {
        skills: await this.listDirNames(path.join(source, "skills")),
        agents: (await this.listDirNames(path.join(source, "agents"), true)).map((f) =>
          f.replace(/\.md$/i, "")
        ),
        hooks: await exists(path.join(source, "hooks", "hooks.json")),
      },
    };
  }

  /**
   * 从任意本地文件夹安装插件。
   *
   * 与 install(id) 共用同一条落地路径 —— 用户从界面选来的文件夹和随包插件
   * 走完全相同的流程，不存在「内置的能装、自己的装不上」这种两套逻辑。
   *
   * `dirName` 是落地到 marketplace 里的目录名，缺省从源目录名推导。
   */
  async installFromPath(sourcePath: string, dirName?: string): Promise<void> {
    const source = path.resolve(normalizePath(sourcePath));
    const manifestPath = path.join(source, ".claude-plugin", "plugin.json");
    if (!(await exists(manifestPath))) {
      throw new Error(
        "这个文件夹不是 Claude Code 插件：缺少 .claude-plugin/plugin.json"
      );
    }
    const meta = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as {
      name?: string;
      description?: string;
      author?: { name?: string };
    };
    const name = meta.name?.trim();
    if (!name) throw new Error("plugin.json 缺少 name 字段");

    // 落地目录名：来源目录名可能含中文、空格（用户桌面上的文件夹很常见），
    // 而它会进 marketplace.json 的 source 路径和文件系统 —— 统一规整成
    // ASCII 短横线形式，规整后为空则退回插件名。
    const slugFromDir = (source.split(/[\\/]/).pop() ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slugFromName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const id = dirName ?? (slugFromDir || slugFromName);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new Error(`无法从目录名推导合法标识：${source}`);
    }

    // 1) 复制到用户目录下的 marketplace（升级不会动它，见 MARKETPLACE_ROOT 注释）
    const dest = path.join(MARKETPLACE_ROOT, "plugins", id);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(source, dest, { recursive: true });

    // 2) 写/更新 marketplace 清单。**保留同一清单里的其它插件** ——
    //    直接覆盖会让先装的内置插件从市场里消失，下次 update 时它就成了孤儿。
    const mpManifestPath = path.join(MARKETPLACE_ROOT, ".claude-plugin", "marketplace.json");
    await fs.mkdir(path.dirname(mpManifestPath), { recursive: true });
    let manifest: {
      name?: string;
      owner?: { name?: string };
      plugins?: Array<{ name: string; source: string; description?: string }>;
    } = {};
    try {
      manifest = JSON.parse(await fs.readFile(mpManifestPath, "utf-8"));
    } catch {
      // 首次安装，从空清单开始
    }
    const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
    const entry = {
      name,
      source: `./plugins/${id}`,
      description: meta.description ?? "",
    };
    const idx = plugins.findIndex((p) => p?.name === name);
    if (idx >= 0) plugins[idx] = entry;
    else plugins.push(entry);

    await fs.writeFile(
      mpManifestPath,
      JSON.stringify(
        {
          name: MARKETPLACE_NAME,
          owner: manifest.owner ?? { name: "Agent Flow" },
          plugins,
        },
        null,
        2
      ),
      "utf-8"
    );

    // 3) 注册 marketplace。已注册时 CLI 会报错，那不是失败，继续往下走即可。
    try {
      await runClaudeCommand(
        ["plugin", "marketplace", "add", MARKETPLACE_ROOT],
        { label: "bundled-plugin" }
      );
    } catch (err) {
      logger.info(`[bundled-plugin] marketplace add 跳过（多半已注册）: ${String(err)}`);
      // 已注册的情况下要刷新一次，否则新加的插件不在索引里
      try {
        await runClaudeCommand(["plugin", "marketplace", "update", MARKETPLACE_NAME], {
          label: "bundled-plugin",
        });
      } catch (e2) {
        logger.info(`[bundled-plugin] marketplace update 失败（忽略）: ${String(e2)}`);
      }
    }

    // 4) 安装。带上 marketplace 限定，避免同名插件装错来源。
    await runClaudeCommand(["plugin", "install", `${name}@${MARKETPLACE_NAME}`], {
      label: "bundled-plugin",
    });
  }
}
