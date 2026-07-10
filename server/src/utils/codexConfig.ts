/**
 * 极简、只读的 Codex `~/.codex/config.toml` 解析器 —— 仅提取 `[mcp_servers.*]`。
 *
 * 为什么不引 TOML 依赖:我们只需要「读」codex 的 MCP 列表用于展示(1A 只读方案),
 * 目标结构固定且简单(命令/参数/url/env)。为这点需求拉一个完整 TOML 解析库并联网
 * 安装,风险与收益不成正比。这里手写一个针对该子集的解析器,遇到不认识的语法直接
 * 跳过,绝不写回文件,因此不会破坏 codex 配置。
 *
 * 支持:
 *   [mcp_servers.NAME]              → 一个 stdio/http MCP server
 *   [mcp_servers.NAME.env]          → 该 server 的环境变量
 *   command = '...' / "..."         → stdio 启动命令
 *   args = [ "a", "b" ]             → 命令参数(支持跨行数组)
 *   url = "https://..."             → 远程(http/sse) MCP
 *   type = "..."                    → 显式传输类型(可选)
 * NAME 支持裸键或引号键(引号内可含点号)。
 */

export interface CodexMcpServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
  env?: Record<string, string>;
}

/**
 * 去掉 TOML 字符串两端引号,裸值原样返回。
 * - 单引号 '...' 是字面量字符串,内容原样保留(反斜杠不转义)。
 * - 双引号 "..." 是基本字符串,需反转义常见序列(\\ \" \n \t \r)。
 */
function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const q = s[0];
    if (q === "'" && s[s.length - 1] === "'") {
      return s.slice(1, -1);
    }
    if (q === '"' && s[s.length - 1] === '"') {
      return s.slice(1, -1).replace(/\\(["\\ntr])/g, (_m, c) => {
        if (c === "n") return "\n";
        if (c === "t") return "\t";
        if (c === "r") return "\r";
        return c; // \" → " ; \\ → \
      });
    }
  }
  return s;
}

/** 解析形如 `[ "a", "b" ]` 的字符串数组(引号内可含逗号)。 */
function parseStringArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]\s*$/, "");
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    const c = inner[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let val = "";
      while (j < inner.length && inner[j] !== c) {
        val += inner[j];
        j++;
      }
      out.push(val);
      i = j + 1;
    } else {
      let j = i;
      while (j < inner.length && inner[j] !== ",") j++;
      const tok = inner.slice(i, j).trim();
      if (tok) out.push(tok);
      i = j;
    }
  }
  return out;
}

/** 把 `mcp_servers.node_repl.env` 拆成 ["mcp_servers","node_repl","env"],尊重引号。 */
function parseSectionPath(header: string): string[] {
  const inner = header.trim().replace(/^\[+/, "").replace(/\]+$/, "").trim();
  const segs: string[] = [];
  let cur = "";
  let inQ: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inQ) {
      if (c === inQ) inQ = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      inQ = c;
    } else if (c === ".") {
      segs.push(cur);
      cur = "";
    } else if (!/\s/.test(c)) {
      cur += c;
    }
  }
  segs.push(cur);
  return segs;
}

/** 从 config.toml 原文解析出所有 codex MCP server(只读)。解析失败返回空数组。 */
export function parseCodexMcpServers(raw: string): CodexMcpServer[] {
  const servers = new Map<string, CodexMcpServer>();
  const get = (name: string): CodexMcpServer => {
    let s = servers.get(name);
    if (!s) {
      s = { name };
      servers.set(name, s);
    }
    return s;
  };

  const lines = raw.split(/\r?\n/);
  // 上下文:当前 key=value 落到哪个 server 的哪个区(直接属性 or env)。
  let curServer: string | null = null;
  let curKind: "server" | "env" | "ignore" = "ignore";

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx].trim();
    if (!line || line.startsWith("#")) continue;

    // 段头:[table] / [[array-of-tables]]
    if (line.startsWith("[")) {
      const segs = parseSectionPath(line);
      if (segs[0] === "mcp_servers" && segs.length >= 2) {
        curServer = segs[1];
        get(curServer); // 确保 server 存在(即使没有任何键)
        if (segs.length === 2) curKind = "server";
        else if (segs[2] === "env") curKind = "env";
        else curKind = "ignore"; // 其它子表(暂不关心)
      } else {
        curServer = null;
        curKind = "ignore";
      }
      continue;
    }

    if (!curServer || curKind === "ignore") continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let valuePart = line.slice(eq + 1).trim();

    // 跨行数组:累加后续行直到闭合 ]
    if (valuePart.startsWith("[") && !valuePart.includes("]")) {
      let j = idx + 1;
      while (j < lines.length && !lines[j].includes("]")) {
        valuePart += " " + lines[j].trim();
        j++;
      }
      if (j < lines.length) valuePart += " " + lines[j].trim();
      idx = j;
    }

    const server = get(curServer);
    if (curKind === "env") {
      if (!server.env) server.env = {};
      server.env[unquote(key)] = unquote(valuePart);
      continue;
    }

    // curKind === "server"
    switch (key) {
      case "command":
        server.command = unquote(valuePart);
        break;
      case "args":
        server.args = parseStringArray(valuePart);
        break;
      case "url":
        server.url = unquote(valuePart);
        break;
      case "type":
        server.type = unquote(valuePart);
        break;
      default:
        break; // 其它键(startup_timeout_sec 等)不展示
    }
  }

  return Array.from(servers.values());
}
