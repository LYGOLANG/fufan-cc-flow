#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise SystemExit("PyYAML is required: python3 -m pip install pyyaml") from exc


INSTALL_SH = """#!/bin/sh
set -e
SELF="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="__PLUGIN_ID__"
ROOT="${CLAUDE_MARKETPLACE_ROOT:-$HOME/claude-plugins}"
DEST="$ROOT/plugins/$PLUGIN_ID"
if ! command -v claude >/dev/null 2>&1; then
  echo "missing claude CLI"
  exit 1
fi
echo "copy -> $DEST"
mkdir -p "$ROOT/plugins" "$ROOT/.claude-plugin"
rm -rf "$DEST"
mkdir -p "$DEST"
(cd "$SELF" && tar cf - --exclude .git --exclude node_modules --exclude .DS_Store .) | (cd "$DEST" && tar xf -)
if [ -f "$DEST/package.json" ] && command -v npm >/dev/null 2>&1; then
  echo "npm install in $DEST"
  (cd "$DEST" && npm install --silent)
  if grep -q '"build:ui"' "$DEST/package.json"; then
    echo "npm run build:ui in $DEST"
    (cd "$DEST" && npm run build:ui --silent)
  fi
fi
python3 - "$ROOT" "$PLUGIN_ID" <<'MERGE'
import json, pathlib, sys
root, pid = pathlib.Path(sys.argv[1]), sys.argv[2]
mp = root / ".claude-plugin" / "marketplace.json"
data = {"name": "personal", "owner": {"name": "personal"}, "plugins": []}
if mp.exists():
    try:
        data = json.loads(mp.read_text(encoding="utf-8"))
    except Exception as exc:
        print("existing marketplace.json invalid: " + str(exc))
        sys.exit(1)
entries = data.setdefault("plugins", [])
if not any(isinstance(e, dict) and e.get("name") == pid for e in entries):
    entries.append({"name": pid, "source": f"./plugins/{pid}", "category": "Productivity"})
mp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
MERGE
python3 - "$DEST" <<'BUMP'
import json, pathlib, sys
from datetime import datetime, timezone
p = pathlib.Path(sys.argv[1]) / ".claude-plugin" / "plugin.json"
if p.is_file():
    m = json.loads(p.read_text(encoding="utf-8"))
    base = str(m.get("version", "0.1.0")).split("+")[0]
    m["version"] = base + "+local." + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    p.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    print("version -> " + m["version"])
BUMP
claude plugin validate "$ROOT"
claude plugin marketplace add "$ROOT" 2>/dev/null || claude plugin marketplace update personal
claude plugin install "$PLUGIN_ID@personal" 2>/dev/null || claude plugin update "$PLUGIN_ID@personal"
echo ""
echo "done: $PLUGIN_ID@personal installed. run /reload-plugins or start a new session."
"""

FORMS = ("companion-web-app", "mcp-app", "hybrid")


def kebab_to_identifier(value: str) -> str:
    return value.replace("-", "_")


def title_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def write(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite {path}; pass --force")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def fill(template: str, tokens: dict[str, str]) -> str:
    for key, value in tokens.items():
        template = template.replace(key, value)
    return template


WIDGET_SERVER_MJS = '''import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { applyResult, claimNextRequest, createRequest, ensureProject, getState } from "./storage.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WIDGET_HTML = join(ROOT, "dist", "ui", "widget.html");
const WIDGET_URI = "__WIDGET_URI__";

const server = new McpServer(
  { name: __PLUGIN_ID_JSON__, version: __VERSION_JSON__ },
  { instructions: __INSTRUCTIONS_JSON__ },
);

registerAppResource(
  server,
  __RESOURCE_NAME_JSON__,
  WIDGET_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    let text;
    try {
      text = await readFile(WIDGET_HTML, "utf8");
    } catch {
      throw new Error("Widget bundle missing. Run: npm run build:ui");
    }
    return { contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text }] };
  },
);

registerAppTool(
  server,
  __RENDER_TOOL_JSON__,
  {
    title: __OPEN_TITLE_JSON__,
    description: "Open the plugin workspace. Hosts that support MCP Apps embed the widget; other hosts read the structured state and continue in conversation.",
    inputSchema: { projectDir: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: WIDGET_URI } },
  },
  async ({ projectDir }) => {
    const resolvedProjectDir = resolve(projectDir);
    await ensureProject(resolvedProjectDir);
    const state = await getState(resolvedProjectDir);
    return {
      content: [{ type: "text", text: `Project v${state.project.projectVersion}: ${state.requests.length} requests, ${state.results.length} results.` }],
      structuredContent: { projectDir: resolvedProjectDir, ...state },
    };
  },
);

server.registerTool(
  __CREATE_REQUEST_TOOL_JSON__,
  {
    title: "Create request",
    description: "Create a pending request from the widget UI.",
    inputSchema: { projectDir: z.string().min(1), userIntent: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ projectDir, userIntent }) => {
    const request = await createRequest(resolve(projectDir), { userIntent });
    return { content: [{ type: "text", text: `Created ${request.requestId}` }], structuredContent: { request } };
  },
);

server.registerTool(
  __GET_REQUEST_TOOL_JSON__,
  {
    title: "Get next pending request",
    description: "Claim the oldest pending request submitted from the plugin UI for this project.",
    inputSchema: { projectDir: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ projectDir }) => {
    const request = await claimNextRequest(resolve(projectDir));
    return {
      content: [{ type: "text", text: request ? `Claimed request ${request.requestId}` : "No pending request." }],
      structuredContent: { request },
    };
  },
);

server.registerTool(
  __APPLY_RESULT_TOOL_JSON__,
  {
    title: "Apply plugin result",
    description: "Write a structured Agent result for a claimed UI request with version protection.",
    inputSchema: {
      projectDir: z.string().min(1),
      requestId: z.string().regex(/^req-[A-Za-z0-9-]+$/),
      basedOnProjectVersion: z.number().int().nonnegative(),
      summary: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => {
    try {
      const result = await applyResult(resolve(input.projectDir), input);
      return { content: [{ type: "text", text: `Applied result for ${input.requestId}` }], structuredContent: result };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        structuredContent: { code: error?.code || "INTERNAL_ERROR", retryable: false },
      };
    }
  },
);

server.registerTool(
  __GET_STATE_TOOL_JSON__,
  {
    title: "Get plugin project state",
    description: "Read project version, requests, and results for diagnostics.",
    inputSchema: { projectDir: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectDir }) => {
    const state = await getState(resolve(projectDir));
    return { content: [{ type: "text", text: `Project version ${state.project.projectVersion}` }], structuredContent: state };
  },
);

await server.connect(new StdioServerTransport());
'''


WIDGET_HTML_TEMPLATE = '''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>__TITLE__</title>
  <link rel="stylesheet" href="./kit/tokens.css">
  <link rel="stylesheet" href="./kit/components.css">
  <style>
    body { margin: 0; padding: 16px; display: grid; gap: 14px; }
    .masthead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    section { display: grid; gap: 10px; align-content: start; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    textarea { width: 100%; box-sizing: border-box; resize: vertical; }
    .list { display: grid; gap: 8px; }
    .list p { margin: 4px 0 0; }
  </style>
</head>
<body class="__BODY_CLASS__">
  <header class="masthead">
    <div>
      <p class="__EYEBROW__">__HOST_LABEL__</p>
      <h1 class="__TITLE_CLASS__">__TITLE__</h1>
    </div>
    <span id="version" class="__VERSION_CLASS__">connecting…</span>
  </header>

  <section class="__CARD__">
    <label class="__LABEL__" for="intent">提交给当前 Agent 的请求</label>
    <textarea id="intent" class="__FIELD__" rows="4" placeholder="描述要让 Agent 完成的任务"></textarea>
    <div class="actions">
      <button id="submit" class="__BTN_PRIMARY__" type="button">提交请求</button>
      <button id="refresh" class="__BTN_QUIET__" type="button">刷新</button>
    </div>
    <p id="message" class="__MSG__" role="status"></p>
  </section>

  <section class="__CARD__">
    <h2 class="__SECTION_TITLE__">Requests</h2>
    <div id="requests" class="list"></div>
  </section>

  <section class="__CARD__">
    <h2 class="__SECTION_TITLE__">Results</h2>
    <div id="results" class="list"></div>
  </section>

  <script type="module" src="./kit/components.js"></script>
  <script type="module" src="./widget.js"></script>
</body>
</html>
'''


WIDGET_JS_TEMPLATE = '''import { App } from "@modelcontextprotocol/ext-apps";

const els = {
  version: document.querySelector("#version"),
  intent: document.querySelector("#intent"),
  submit: document.querySelector("#submit"),
  refresh: document.querySelector("#refresh"),
  message: document.querySelector("#message"),
  requests: document.querySelector("#requests"),
  results: document.querySelector("#results"),
};

let projectDir = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function renderState(state) {
  if (!state || !state.project) return;
  if (state.projectDir) projectDir = state.projectDir;
  els.version.textContent = `Project v${state.project.projectVersion}`;
  const requests = state.requests || [];
  const results = state.results || [];
  els.requests.innerHTML = requests.length
    ? requests.map((item) => `<div class="__ITEM__"><strong class="__ITEMID__">${escapeHtml(item.requestId)}</strong> <span class="__STATUS__">${escapeHtml(item.status)}</span><p>${escapeHtml(item.userIntent)}</p></div>`).join("")
    : '<p class="__EMPTY__">暂无</p>';
  els.results.innerHTML = results.length
    ? results.map((item) => `<div class="__ITEM__"><strong class="__ITEMID__">${escapeHtml(item.requestId)}</strong> <span class="__STATUS__">v${item.projectVersion}</span><p>${escapeHtml(item.summary)}</p></div>`).join("")
    : '<p class="__EMPTY__">暂无</p>';
}

const app = new App({ name: __TITLE_JSON__, version: __VERSION_JSON__ });

app.ontoolresult = (event) => {
  const structured = event?.result?.structuredContent || event?.structuredContent;
  renderState(structured);
};

async function callTool(name, args) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result?.isError) {
    const text = result?.content?.find((item) => item.type === "text")?.text || "Tool call failed";
    throw new Error(text);
  }
  return result?.structuredContent || {};
}

async function refresh() {
  if (!projectDir) return;
  try {
    const state = await callTool("__GET_STATE_TOOL__", { projectDir });
    renderState({ projectDir, ...state });
  } catch (error) {
    els.message.textContent = error.message;
  }
}

els.submit.addEventListener("click", async () => {
  const userIntent = els.intent.value.trim();
  if (!userIntent || !projectDir) return;
  els.submit.disabled = true;
  try {
    const { request } = await callTool("__CREATE_REQUEST_TOOL__", { projectDir, userIntent });
    els.message.textContent = `已提交 ${request.requestId}。回到对话让 Agent 处理待办请求。`;
    els.intent.value = "";
    await refresh();
  } catch (error) {
    els.message.textContent = error.message;
  } finally {
    els.submit.disabled = false;
  }
});

els.refresh.addEventListener("click", refresh);

await app.connect();
els.version.textContent = "已连接，等待项目状态…";
'''


PREVIEW_HOST_HTML = '''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MCP App Dev Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; display: grid; gap: 12px; }
    header { display: flex; gap: 12px; align-items: baseline; }
    iframe { width: 100%; min-height: 520px; border: 1px dashed #8886; border-radius: 8px; background: transparent; }
  </style>
</head>
<body>
  <header>
    <strong>MCP App Dev Preview</strong>
    <span id="status">starting…</span>
  </header>
  <iframe id="widget" sandbox="allow-scripts allow-same-origin"></iframe>
  <script type="module" src="./preview-host.js"></script>
</body>
</html>
'''


PREVIEW_HOST_JS = '''import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const status = document.querySelector("#status");
const iframe = document.querySelector("#widget");
const params = new URLSearchParams(location.search);
const projectDir = params.get("projectDir") || "";
const openTool = params.get("openTool") || "";

async function callServer(payload) {
  const response = await fetch("/api/call-tool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const bridge = new AppBridge(null, { name: "dev-preview", version: "0.1.0" }, {});
bridge.oncalltool = async (toolParams) => callServer(toolParams);
bridge.oninitialized = async () => {
  status.textContent = "widget initialized";
  if (openTool && projectDir) {
    const result = await callServer({ name: openTool, arguments: { projectDir } });
    bridge.sendToolResult(result);
  }
  window.__previewReady = true;
};

// 宿主桥先于 widget 就位：connect 同步开始监听后立即载入 widget，不等握手完成。
bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
status.textContent = "bridge listening, loading widget…";
iframe.src = "/widget";
'''


VITE_WIDGET_CONFIG = '''import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    rollupOptions: { input: "ui/widget.html" },
  },
});
'''


VITE_PREVIEW_CONFIG = '''import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist/preview",
    emptyOutDir: true,
    rollupOptions: { input: "ui/preview-host.html" },
  },
});
'''


DEV_PREVIEW_MJS = '''import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WIDGET_HTML = new URL("../dist/ui/widget.html", import.meta.url);
const PREVIEW_HTML = new URL("../dist/preview/preview-host.html", import.meta.url);
const SERVER_ENTRY = fileURLToPath(new URL("../server/index.mjs", import.meta.url));
const OPEN_TOOL = "__RENDER_TOOL__";

const projectDir = process.argv[2] || ROOT;

const client = new Client({ name: "dev-preview", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] }));

function json(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveBuilt(fileUrl, response) {
  let text;
  try {
    text = await readFile(fileUrl, "utf8");
  } catch {
    return json(response, 503, { error: "Bundle missing. Run: npm run build:ui" });
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(text);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(302, { location: `/preview?projectDir=${encodeURIComponent(projectDir)}&openTool=${encodeURIComponent(OPEN_TOOL)}` });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/preview") return serveBuilt(PREVIEW_HTML, response);
    if (request.method === "GET" && url.pathname === "/widget") return serveBuilt(WIDGET_HTML, response);
    if (request.method === "POST" && url.pathname === "/api/call-tool") {
      const { name, arguments: args } = await readBody(request);
      const result = await client.callTool({ name, arguments: args || {} });
      return json(response, 200, result);
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
console.log(`dev-preview: http://127.0.0.1:${server.address().port}/`);
'''


WIDGET_PROBE_MJS = '''import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../server/index.mjs", import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
const client = new Client({ name: "__PLUGIN_ID__-probe", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((tool) => tool.name);
for (const required of __REQUIRED_TOOLS_JSON__) {
  if (!names.includes(required)) throw new Error(`Missing tool: ${required}`);
}

const openTool = tools.tools.find((tool) => tool.name === "__RENDER_TOOL__");
const resourceUri = openTool?._meta?.ui?.resourceUri;
if (resourceUri !== "__WIDGET_URI__") throw new Error(`Tool _meta.ui.resourceUri mismatch: ${resourceUri}`);

const resources = await client.listResources();
if (!resources.resources.some((item) => item.uri === "__WIDGET_URI__")) {
  throw new Error("ui:// resource not listed");
}

const contents = await client.readResource({ uri: "__WIDGET_URI__" });
const entry = contents.contents?.[0];
if (entry?.mimeType !== "text/html;profile=mcp-app") throw new Error(`Unexpected resource mimeType: ${entry?.mimeType}`);
if (!entry?.text || !entry.text.includes("<html")) throw new Error("Widget resource is empty; run npm run build:ui first");
if (/<(?:script|link)[^>]+(?:src|href)=/.test(entry.text)) throw new Error("Widget resource still references external files; it must be self-contained");

const probeDir = await mkdtemp(join(tmpdir(), "__PLUGIN_ID__-probe-"));
try {
  const called = await client.callTool({ name: "__GET_STATE_TOOL__", arguments: { projectDir: probeDir } });
  if (!called?.structuredContent?.project) throw new Error("__GET_STATE_TOOL__ returned no project state");
} finally {
  await rm(probeDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tools: names, resource: "__WIDGET_URI__" }, null, 2));
await client.close();
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Project root containing plugin.yaml")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    ir_path = root / "plugin.yaml"
    if not ir_path.exists():
        parser.error(f"Missing {ir_path}")
    validator = Path(__file__).resolve().with_name("validate-plugin-project.py")
    checked = subprocess.run(
        [sys.executable, str(validator), "--root", str(root), "--ir-only"],
        check=False,
    )
    if checked.returncode:
        return checked.returncode
    ir = yaml.safe_load(ir_path.read_text(encoding="utf-8"))
    plugin = ir.get("plugin", {})
    plugin_id = plugin.get("id")
    title = plugin.get("title")
    description = plugin.get("description")
    if not isinstance(plugin_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", plugin_id):
        parser.error("plugin.yaml plugin.id must be lowercase kebab-case")
    if not isinstance(title, str) or not title.strip():
        parser.error("plugin.yaml plugin.title is required")
    form = plugin.get("form") or "companion-web-app"
    if form not in FORMS:
        parser.error(f"plugin.yaml plugin.form must be one of {FORMS}")
    code_root = ir.get("paths", {}).get("codeRoot") or f"./{plugin_id}"
    declared_output = (root / str(code_root).removeprefix("./")).resolve()
    try:
        declared_output.relative_to(root)
    except ValueError:
        parser.error("plugin.yaml paths.codeRoot must remain inside the project root")
    output = (args.output or declared_output).resolve()
    if args.output and output != declared_output:
        parser.error("--output must match plugin.yaml paths.codeRoot; update the IR instead of creating path drift")
    if output == root.resolve() or (output / "plugin.yaml").is_file() or (output / "Plugin-Project-State.md").is_file():
        parser.error("plugin.yaml paths.codeRoot 指向项目根或已有项目产物目录，拒绝覆盖删除")
    if output.exists() and any(output.iterdir()) and not args.force:
        parser.error(f"Output directory is not empty: {output}; pass --force")
    if args.force and output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    has_web = form in ("companion-web-app", "hybrid")
    has_widget = form in ("mcp-app", "hybrid")

    ident = kebab_to_identifier(plugin_id)
    render_tool = ir.get("mcp", {}).get("renderTool") or f"open_{ident}"
    agent_tools = [tool for tool in (ir.get("mcp", {}).get("agentTools") or []) if isinstance(tool, str) and tool.strip()]
    app_only_tools = [tool for tool in (ir.get("mcp", {}).get("appOnlyTools") or []) if isinstance(tool, str) and tool.strip()]
    get_state_tool = f"get_{ident}_state"
    get_request_tool = next(
        (tool for tool in agent_tools if tool.startswith("get_") and tool != get_state_tool),
        f"get_{ident}_request",
    )
    apply_result_tool = next((tool for tool in agent_tools if tool.startswith("apply_")), f"apply_{ident}_result")
    create_request_tool = next((tool for tool in app_only_tools if tool.startswith("create_")), f"create_{ident}_request")
    registered_tools = [render_tool, get_request_tool, apply_result_tool, get_state_tool]
    if form in ("mcp-app", "hybrid"):
        registered_tools.insert(1, create_request_tool)
    duplicate_tools = sorted({name for name in registered_tools if registered_tools.count(name) > 1})
    if duplicate_tools:
        parser.error(f"派生工具名冲突：{duplicate_tools}；请在 plugin.yaml 的 mcp 工具清单里改名避免重名")
    widget_uri = f"ui://{plugin_id}/widget.html"
    state_dir = ir.get("state", {}).get("directory") or f".{plugin_id}"
    if not isinstance(state_dir, str) or not re.fullmatch(r"\.[a-z0-9][a-z0-9._-]*", state_dir):
        parser.error("plugin.yaml state.directory must be a project-local dot directory such as .my-plugin")
    if state_dir in {".git", ".codex", ".agents", ".claude"}:
        parser.error("plugin.yaml state.directory must not use a reserved host directory name")
    skill_name = f"{plugin_id}-open"

    author = plugin.get("author")
    if not isinstance(author, str) or not author.strip() or author.strip().startswith("["):
        author = getpass.getuser()
    manifest = {
        "name": plugin_id,
        "displayName": title,
        "version": plugin.get("version", "0.1.0"),
        "description": description,
        "author": {"name": author},
    }
    write(output / ".claude-plugin" / "plugin.json", json.dumps(manifest, ensure_ascii=False, indent=2), args.force)

    mcp_config = {
        "mcpServers": {
            f"{ident}_mcp": {
                "command": "node",
                "args": ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"],
            }
        }
    }
    write(output / ".mcp.json", json.dumps(mcp_config, ensure_ascii=False, indent=2), args.force)

    check_files = ["server/index.mjs", "server/storage.mjs"]
    if has_web:
        check_files.append("ui/app.js")
    check_files.append("scripts/probe-mcp.mjs")
    if has_widget:
        check_files.append("scripts/dev-preview.mjs")
    check_command = " && ".join(f"node --check {name}" for name in check_files) + " && node --test tests/*.test.mjs"
    scripts = {"check": check_command, "probe:mcp": "node scripts/probe-mcp.mjs"}
    if has_widget:
        scripts["build:ui"] = "vite build --config scripts/vite.widget.config.mjs && vite build --config scripts/vite.preview.config.mjs"
        scripts["preview"] = "node scripts/dev-preview.mjs"
        scripts["quality"] = "npm run build:ui && npm run check && npm run probe:mcp"
    else:
        scripts["quality"] = "npm run check && npm run probe:mcp"
    dependencies = {
        "@modelcontextprotocol/sdk": "^1.29.0",
        "zod": "^4.4.3",
    }
    if has_widget:
        dependencies["@modelcontextprotocol/ext-apps"] = "^1.7.5"
    package_json = {
        "name": plugin_id,
        "version": plugin.get("version", "0.1.0"),
        "private": True,
        "type": "module",
        "engines": {"node": ">=22"},
        "scripts": scripts,
        "dependencies": dict(sorted(dependencies.items())),
    }
    if has_widget:
        package_json["devDependencies"] = {"vite": "^8.2.0", "vite-plugin-singlefile": "^2.3.3"}
    write(output / "package.json", json.dumps(package_json, ensure_ascii=False, indent=2), args.force)

    request_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["operation", "userIntent"],
        "properties": {
            "operation": {"type": "string", "pattern": "^[a-z][a-z0-9-]{0,63}$"},
            "userIntent": {"type": "string", "minLength": 1, "maxLength": 10000},
            "selection": {"type": "object"},
            "assetRefs": {"type": "array", "maxItems": 100, "items": {"type": "string"}},
        },
    }
    result_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["requestId", "basedOnProjectVersion", "summary", "payload"],
        "properties": {
            "requestId": {"type": "string", "pattern": "^req-\\d+-[a-f0-9]{8}$"},
            "basedOnProjectVersion": {"type": "integer", "minimum": 0},
            "summary": {"type": "string", "minLength": 1},
            "payload": {"type": "object"},
        },
    }
    state_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["schemaVersion", "projectVersion", "createdAt"],
        "properties": {
            "schemaVersion": {"const": 1},
            "projectVersion": {"type": "integer", "minimum": 0},
            "createdAt": {"type": "string", "format": "date-time"},
            "updatedAt": {"type": "string", "format": "date-time"},
        },
    }
    evidence_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": True,
        "description": "Project-specific evidence contract; refine during Plugin Design.",
    }
    contract_payloads = {
        "requestSchema": request_schema,
        "resultSchema": result_schema,
        "stateSchema": state_schema,
        "evidenceSchema": evidence_schema,
    }
    for contract_key, payload in contract_payloads.items():
        relative = ir.get("contracts", {}).get(contract_key)
        if not isinstance(relative, str):
            parser.error(f"plugin.yaml contracts.{contract_key} is required")
        target = (root / relative.removeprefix("./")).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            parser.error(f"contracts.{contract_key} must resolve inside the project root")
        serialized = json.dumps(payload, ensure_ascii=False, indent=2)
        if not target.exists():
            write(target, serialized, args.force)
        package_contract = output / "contracts" / target.name
        if not package_contract.exists():
            write(package_contract, serialized, args.force)

    if form == "mcp-app":
        open_step = f"    1. 调用 `{render_tool}`，传当前用户项目绝对路径作为 projectDir。支持 MCP Apps 的宿主会把 widget 界面嵌进对话；其余宿主直接读取返回的结构化状态，在对话里继续。"
        surface_note = "    - widget 只在支持 MCP Apps 的宿主渲染；无嵌入面时全部工具照常可用（tool-only），不因此中断任务。"
    elif form == "hybrid":
        open_step = f"    1. 调用 `{render_tool}`，传当前用户项目绝对路径作为 projectDir。返回本地 UI 的 URL；支持 MCP Apps 的宿主还会把轻量 widget 嵌进对话。"
        surface_note = "    - 完整界面走返回的 URL；对话内 widget 只做轻量提交与预览，两层共享同一项目状态。"
    else:
        open_step = f"    1. 调用 `{render_tool}`，传当前用户项目绝对路径作为 projectDir。"
        surface_note = ""
    open_url_step = "    2. 把返回的 URL 提供给用户在 Claude Code Browser / Preview 或系统浏览器打开。\n" if has_web else ""
    step_offset = 3 if has_web else 2
    surface_line = f"\n{surface_note}" if surface_note else ""
    skill_description = (
        f"当用户要打开、使用或处理 {title} 的交互式工作区与待办请求时使用。"
        f"打开插件工作区，使用 {get_request_tool} 领取用户从界面提交的结构化请求，完成任务后通过 {apply_result_tool} 写回结果。"
    )
    open_skill = f'''---
name: {skill_name}
description: {json.dumps(skill_description, ensure_ascii=False)}
---

[任务]
    打开并操作 {title} Plugin。

[启动]
{open_step}
{open_url_step}    {step_offset}. 用户在 UI 提交后，调用 `{get_request_tool}` 领取 pending request。
    {step_offset + 1}. 按 request 的 userIntent、selection 和 assetRefs 执行任务。
    {step_offset + 2}. 完成后调用 `{apply_result_tool}`，带 requestId、basedOnProjectVersion（用领取到的 request.projectVersion）、summary 和结构化 payload。

[请求处理]
    - 没有 pending request 时，不编造任务。
    - 大文件只按路径和引用读取，不把完整内容塞入对话。
    - 结果必须通过 Tool 写回，不只在聊天里回复。
    - VERSION_CONFLICT 时不覆盖，先告诉用户结果已过期并按 UI 提示处理。{surface_line}

[完成标准]
    - UI 已显示新结果。
    - projectVersion 已更新。
    - 用户能从界面确认本次请求已完成。

[禁止]
    - 把 Plugin 安装目录当用户状态目录。
    - 直接手写 requests / results 文件绕过 Tool。
    - 没有真实 request 就猜用户要做什么。
'''
    write(output / "skills" / skill_name / "SKILL.md", open_skill, args.force)

    storage_mjs = f'''import {{ mkdir, readFile, readdir, rename, writeFile }} from "node:fs/promises";
import {{ dirname, join, resolve }} from "node:path";
import {{ randomUUID }} from "node:crypto";

const STATE_DIR_NAME = {json.dumps(state_dir)};

export function pathsFor(projectDir) {{
  const root = resolve(projectDir, STATE_DIR_NAME);
  return {{
    root,
    projectFile: join(root, "project.json"),
    requestsDir: join(root, "requests"),
    resultsDir: join(root, "results"),
  }};
}}

async function atomicJson(path, payload) {{
  await mkdir(dirname(path), {{ recursive: true }});
  const temp = `${{path}}.${{process.pid}}.${{Date.now()}}.${{randomUUID()}}.tmp`;
  await writeFile(temp, `${{JSON.stringify(payload, null, 2)}}\\n`, "utf8");
  await rename(temp, path);
}}

async function readJson(path, fallback = null) {{
  try {{
    return JSON.parse(await readFile(path, "utf8"));
  }} catch (error) {{
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }}
}}

export async function ensureProject(projectDir) {{
  const paths = pathsFor(projectDir);
  await mkdir(paths.requestsDir, {{ recursive: true }});
  await mkdir(paths.resultsDir, {{ recursive: true }});
  let project = await readJson(paths.projectFile);
  if (!project) {{
    project = {{ schemaVersion: 1, projectVersion: 0, createdAt: new Date().toISOString() }};
    await atomicJson(paths.projectFile, project);
  }}
  return {{ paths, project }};
}}

export async function createRequest(projectDir, input) {{
  const {{ paths, project }} = await ensureProject(projectDir);
  const requestId = `req-${{Date.now()}}-${{randomUUID().slice(0, 8)}}`;
  const operation = String(input.operation || "user-request").trim();
  const userIntent = String(input.userIntent || "").trim();
  const assetRefs = Array.isArray(input.assetRefs) ? input.assetRefs.slice(0, 100) : [];
  if (!/^[a-z][a-z0-9-]{{0,63}}$/.test(operation)) throw new Error("operation must be lowercase kebab-case");
  if (!userIntent || userIntent.length > 10000) throw new Error("userIntent must contain 1-10000 characters");
  const request = {{
    schemaVersion: 1,
    requestId,
    status: "pending",
    projectVersion: project.projectVersion,
    operation,
    userIntent,
    selection: input.selection && typeof input.selection === "object" && !Array.isArray(input.selection) ? input.selection : {{}},
    assetRefs,
    createdAt: new Date().toISOString(),
  }};
  await atomicJson(join(paths.requestsDir, `${{requestId}}.json`), request);
  return request;
}}

export async function claimNextRequest(projectDir) {{
  const {{ paths, project }} = await ensureProject(projectDir);
  const files = (await readdir(paths.requestsDir)).filter((name) => name.endsWith(".json")).sort();
  for (const file of files) {{
    const path = join(paths.requestsDir, file);
    const request = await readJson(path);
    if (request?.status !== "pending") continue;
    request.status = "processing";
    request.claimedAt = new Date().toISOString();
    request.projectVersion = project.projectVersion;
    await atomicJson(path, request);
    return request;
  }}
  return null;
}}

export async function applyResult(projectDir, input) {{
  const {{ paths, project }} = await ensureProject(projectDir);
  const requestId = String(input.requestId || "");
  if (!/^req-\\d+-[a-f0-9]{{8}}$/.test(requestId)) throw Object.assign(new Error("Invalid requestId"), {{ code: "INVALID_REQUEST" }});
  const requestPath = join(paths.requestsDir, `${{requestId}}.json`);
  const resultPath = join(paths.resultsDir, `${{requestId}}.json`);
  const existingResult = await readJson(resultPath);
  if (existingResult) return existingResult;
  const request = await readJson(requestPath);
  if (!request) throw Object.assign(new Error("Request not found"), {{ code: "NOT_FOUND" }});
  if (request.status !== "processing") throw Object.assign(new Error("Request must be claimed before applying a result"), {{ code: "INVALID_STATE" }});
  if (
    Number(input.basedOnProjectVersion) !== Number(request.projectVersion) ||
    Number(input.basedOnProjectVersion) !== Number(project.projectVersion)
  ) {{
    throw Object.assign(new Error("Project version changed; result is stale"), {{ code: "VERSION_CONFLICT" }});
  }}
  const nextProject = {{ ...project, projectVersion: project.projectVersion + 1, updatedAt: new Date().toISOString() }};
  const result = {{
    schemaVersion: 1,
    requestId,
    basedOnProjectVersion: input.basedOnProjectVersion,
    projectVersion: nextProject.projectVersion,
    status: "succeeded",
    summary: String(input.summary || "Completed"),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {{}},
    createdAt: new Date().toISOString(),
  }};
  await atomicJson(paths.projectFile, nextProject);
  await atomicJson(resultPath, result);
  request.status = "succeeded";
  request.completedAt = result.createdAt;
  await atomicJson(requestPath, request);
  return result;
}}

export async function getState(projectDir) {{
  const {{ paths, project }} = await ensureProject(projectDir);
  const requests = [];
  for (const file of (await readdir(paths.requestsDir)).filter((name) => name.endsWith(".json")).sort()) {{
    requests.push(await readJson(join(paths.requestsDir, file)));
  }}
  const results = [];
  for (const file of (await readdir(paths.resultsDir)).filter((name) => name.endsWith(".json")).sort()) {{
    results.push(await readJson(join(paths.resultsDir, file)));
  }}
  return {{ project, requests, results }};
}}
'''
    write(output / "server" / "storage.mjs", storage_mjs, args.force)

    server_instructions = (
        f"{title_escape(title)} interactive workspace plugin. Use when the user wants to open or work in "
        f"{title_escape(title)}, or asks to process its pending UI requests. Open the UI with {render_tool} "
        f"(pass the user's absolute project directory as projectDir); claim UI-submitted requests with "
        f"{get_request_tool}; write outcomes back with {apply_result_tool}; inspect current state with {get_state_tool}."
    )

    if form == "mcp-app":
        server_mjs = fill(WIDGET_SERVER_MJS, {
            "__WIDGET_URI__": widget_uri,
            "__PLUGIN_ID_JSON__": json.dumps(plugin_id),
            "__VERSION_JSON__": json.dumps(plugin.get("version", "0.1.0")),
            "__INSTRUCTIONS_JSON__": json.dumps(server_instructions),
            "__RESOURCE_NAME_JSON__": json.dumps(f"{title} Widget"),
            "__RENDER_TOOL_JSON__": json.dumps(render_tool),
            "__OPEN_TITLE_JSON__": json.dumps("Open " + title),
            "__CREATE_REQUEST_TOOL_JSON__": json.dumps(create_request_tool),
            "__GET_REQUEST_TOOL_JSON__": json.dumps(get_request_tool),
            "__APPLY_RESULT_TOOL_JSON__": json.dumps(apply_result_tool),
            "__GET_STATE_TOOL_JSON__": json.dumps(get_state_tool),
        })
        write(output / "server" / "index.mjs", server_mjs, args.force)
    else:
        open_text_prefix = json.dumps(f"Open {title}: ", ensure_ascii=False)
        if form == "hybrid":
            ext_apps_import = 'import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";\n'
            widget_const_block = f'''const WIDGET_HTML = join(ROOT, "dist", "ui", "widget.html");
const WIDGET_URI = {json.dumps(widget_uri)};
'''
            resource_block = f'''registerAppResource(
  server,
  {json.dumps(f"{title} Widget")},
  WIDGET_URI,
  {{ mimeType: RESOURCE_MIME_TYPE }},
  async () => {{
    let text;
    try {{
      text = await readFile(WIDGET_HTML, "utf8");
    }} catch {{
      throw new Error("Widget bundle missing. Run: npm run build:ui");
    }}
    return {{ contents: [{{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text }}] }};
  }},
);

'''
            open_registration = f'''registerAppTool(
  server,
  {json.dumps(render_tool)},
  {{
    title: {json.dumps('Open ' + title)},
    description: {json.dumps('Open the interactive workspace. Returns the full editor URL; hosts that support MCP Apps also embed the light widget.')},
    inputSchema: {{ projectDir: z.string().min(1) }},
    annotations: {{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }},
    _meta: {{ ui: {{ resourceUri: WIDGET_URI }} }},
  }},
  async ({{ projectDir }}) => {{
    const resolvedProjectDir = resolve(projectDir);
    await ensureProject(resolvedProjectDir);
    const baseUrl = await ensureWebServer();
    const token = randomUUID();
    sessions.set(token, {{ projectDir: resolvedProjectDir, createdAt: Date.now() }});
    const url = `${{baseUrl}}/?token=${{encodeURIComponent(token)}}`;
    const state = await getState(resolvedProjectDir);
    return {{
      content: [{{ type: "text", text: {open_text_prefix} + url }}],
      structuredContent: {{ url, projectDir: resolvedProjectDir, mode: "browser-request-queue", ...state }},
    }};
  }},
);

server.registerTool(
  {json.dumps(create_request_tool)},
  {{
    title: "Create request",
    description: "Create a pending request from the widget UI.",
    inputSchema: {{ projectDir: z.string().min(1), userIntent: z.string().min(1) }},
    annotations: {{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }},
  }},
  async ({{ projectDir, userIntent }}) => {{
    const request = await createRequest(resolve(projectDir), {{ userIntent }});
    return {{ content: [{{ type: "text", text: `Created ${{request.requestId}}` }}], structuredContent: {{ request }} }};
  }},
);

'''
        else:
            ext_apps_import = ""
            widget_const_block = ""
            resource_block = ""
            open_registration = f'''server.registerTool(
  {json.dumps(render_tool)},
  {{
    title: {json.dumps('Open ' + title)},
    description: {json.dumps('Open the interactive Browser workspace for the active Claude Code project.')},
    inputSchema: {{ projectDir: z.string().min(1) }},
    annotations: {{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }},
  }},
  async ({{ projectDir }}) => {{
    const resolvedProjectDir = resolve(projectDir);
    await ensureProject(resolvedProjectDir);
    const baseUrl = await ensureWebServer();
    const token = randomUUID();
    sessions.set(token, {{ projectDir: resolvedProjectDir, createdAt: Date.now() }});
    const url = `${{baseUrl}}/?token=${{encodeURIComponent(token)}}`;
    return {{
      content: [{{ type: "text", text: {open_text_prefix} + url }}],
      structuredContent: {{ url, projectDir: resolvedProjectDir, mode: "browser-request-queue" }},
    }};
  }},
);

'''
        storage_imports = "applyResult, claimNextRequest, createRequest, ensureProject, getState"
        server_mjs = f'''import {{ createReadStream }} from "node:fs";
import {{ readFile, stat }} from "node:fs/promises";
import http from "node:http";
import {{ extname, isAbsolute, join, relative, resolve }} from "node:path";
import {{ fileURLToPath }} from "node:url";
import {{ randomUUID }} from "node:crypto";

import {{ McpServer }} from "@modelcontextprotocol/sdk/server/mcp.js";
import {{ StdioServerTransport }} from "@modelcontextprotocol/sdk/server/stdio.js";
{ext_apps_import}import {{ z }} from "zod";

import {{ {storage_imports} }} from "./storage.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_DIR = join(ROOT, "ui");
{widget_const_block}const sessions = new Map();
let webServer = null;
let webBaseUrl = null;

function jsonResponse(response, status, payload) {{
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {{
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  }});
  response.end(body);
}}

async function readBody(request, maxBytes = 1024 * 1024) {{
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {{
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("Payload too large"), {{ status: 413 }});
    chunks.push(chunk);
  }}
  if (!chunks.length) return {{}};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}}

function mimeFor(path) {{
  return {{ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }}[extname(path)] || "application/octet-stream";
}}

async function serveStatic(requestPath, response) {{
  const requested = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  const filePath = resolve(UI_DIR, requested);
  const relativePath = relative(UI_DIR, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return jsonResponse(response, 403, {{ error: "Forbidden" }});
  try {{
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not file");
    response.writeHead(200, {{
      "content-type": `${{mimeFor(filePath)}}; charset=utf-8`,
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    }});
    createReadStream(filePath).pipe(response);
  }} catch {{
    jsonResponse(response, 404, {{ error: "Not found" }});
  }}
}}

async function handleHttp(request, response) {{
  try {{
    const url = new URL(request.url, "http://127.0.0.1");
    const token = url.searchParams.get("token") || request.headers["x-plugin-session"];
    const session = token ? sessions.get(token) : null;
    if (session && Date.now() - session.createdAt > 8 * 60 * 60 * 1000) {{
      sessions.delete(token);
    }}
    const activeSession = token ? sessions.get(token) : null;

    if (url.pathname.startsWith("/api/")) {{
      if (!activeSession) return jsonResponse(response, 401, {{ error: "Invalid or expired session" }});
      if (request.method === "GET" && url.pathname === "/api/state") {{
        return jsonResponse(response, 200, await getState(activeSession.projectDir));
      }}
      if (request.method === "POST" && url.pathname === "/api/requests") {{
        const body = await readBody(request);
        return jsonResponse(response, 201, await createRequest(activeSession.projectDir, body));
      }}
      return jsonResponse(response, 404, {{ error: "Unknown API" }});
    }}

    return serveStatic(url.pathname, response);
  }} catch (error) {{
    jsonResponse(response, error?.status || 500, {{ error: error instanceof Error ? error.message : String(error) }});
  }}
}}

async function ensureWebServer() {{
  if (webBaseUrl) return webBaseUrl;
  webServer = http.createServer((request, response) => void handleHttp(request, response));
  await new Promise((resolveListen, reject) => {{
    webServer.once("error", reject);
    webServer.listen(0, "127.0.0.1", resolveListen);
  }});
  const address = webServer.address();
  webBaseUrl = `http://127.0.0.1:${{address.port}}`;
  return webBaseUrl;
}}

const server = new McpServer(
  {{ name: {json.dumps(plugin_id)}, version: {json.dumps(plugin.get('version', '0.1.0'))} }},
  {{ instructions: {json.dumps(server_instructions)} }},
);

{resource_block}{open_registration}server.registerTool(
  {json.dumps(get_request_tool)},
  {{
    title: "Get next pending request",
    description: "Claim the oldest pending request submitted from the plugin UI for this project.",
    inputSchema: {{ projectDir: z.string().min(1) }},
    annotations: {{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }},
  }},
  async ({{ projectDir }}) => {{
    const request = await claimNextRequest(resolve(projectDir));
    return {{
      content: [{{ type: "text", text: request ? `Claimed request ${{request.requestId}}` : "No pending request." }}],
      structuredContent: {{ request }},
    }};
  }},
);

server.registerTool(
  {json.dumps(apply_result_tool)},
  {{
    title: "Apply plugin result",
    description: "Write a structured Agent result for a claimed UI request with version protection.",
    inputSchema: {{
      projectDir: z.string().min(1),
      requestId: z.string().regex(/^req-[A-Za-z0-9-]+$/),
      basedOnProjectVersion: z.number().int().nonnegative(),
      summary: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    }},
    annotations: {{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }},
  }},
  async (input) => {{
    try {{
      const result = await applyResult(resolve(input.projectDir), input);
      return {{ content: [{{ type: "text", text: `Applied result for ${{input.requestId}}` }}], structuredContent: result }};
    }} catch (error) {{
      return {{
        isError: true,
        content: [{{ type: "text", text: error instanceof Error ? error.message : String(error) }}],
        structuredContent: {{ code: error?.code || "INTERNAL_ERROR", retryable: false }},
      }};
    }}
  }},
);

server.registerTool(
  {json.dumps(get_state_tool)},
  {{
    title: "Get plugin project state",
    description: "Read project version, requests, and results for diagnostics.",
    inputSchema: {{ projectDir: z.string().min(1) }},
    annotations: {{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }},
  }},
  async ({{ projectDir }}) => {{
    const state = await getState(resolve(projectDir));
    return {{ content: [{{ type: "text", text: `Project version ${{state.project.projectVersion}}` }}], structuredContent: state }};
  }},
);

await server.connect(new StdioServerTransport());
'''
        write(output / "server" / "index.mjs", server_mjs, args.force)

    escaped_title = title_escape(title)
    kit_id = (ir.get("ui") or {}).get("kit") or "neural-pro"
    KIT_UI = {
        "neural-pro": {
            "body": "pk",
            "eyebrow": "pk-label",
            "title": "pk-display",
            "desc": "pk-muted",
            "version": "pk-pill pk-pill--line",
            "card": "pk-card",
            "sectionTitle": "pk-title",
            "label": "pk-label",
            "field": "pk-field",
            "btnPrimary": "pk-btn pk-btn--primary",
            "btnQuiet": "pk-btn pk-btn--quiet",
            "msg": "pk-muted",
            "item": "pk-panel",
            "itemId": "pk-mono",
            "status": "pk-pill pk-pill--line",
            "empty": "pk-muted",
            "footer": "pk-muted",
        },
        "ink-on-paper": {
            "body": "",
            "eyebrow": "ink-label",
            "title": "ink-h1",
            "desc": "ink-note",
            "version": "ink-badge",
            "card": "ink-card",
            "sectionTitle": "ink-h2",
            "label": "ink-label",
            "field": "ink-field",
            "btnPrimary": "ink-btn ink-btn--solid",
            "btnQuiet": "ink-btn ink-btn--quiet",
            "msg": "ink-note",
            "item": "ink-panel",
            "itemId": "ink-code",
            "status": "ink-badge ink-badge--dash",
            "empty": "ink-quiet",
            "footer": "ink-note",
        },
    }
    ui_map = KIT_UI.get(kit_id, KIT_UI["neural-pro"])

    kit_source = Path(__file__).resolve().parent.parent / "assets" / "ui-kits" / kit_id
    if not kit_source.is_dir():
        parser.error(f"unknown ui.kit '{kit_id}': no matching directory under assets/ui-kits")
    for kit_file in ("tokens.css", "components.css", "components.js"):
        write(output / "ui" / "kit" / kit_file, (kit_source / kit_file).read_text(encoding="utf-8"), args.force)

    if has_web:
        index_html = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{escaped_title}</title>
  <link rel="stylesheet" href="/kit/tokens.css">
  <link rel="stylesheet" href="/kit/components.css">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="{ui_map["body"]}">
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="{ui_map["eyebrow"]}">Claude Code Plugin</p>
        <h1 class="{ui_map["title"]}">{escaped_title}</h1>
        <p class="{ui_map["desc"]}">{title_escape(description or '')}</p>
      </div>
      <span id="version" class="{ui_map["version"]}">Loading state</span>
    </header>

    <section class="{ui_map["card"]}">
      <label class="{ui_map["label"]}" for="intent">提交给当前 Agent 的请求</label>
      <textarea id="intent" class="{ui_map["field"]}" rows="5" placeholder="描述要让 Agent 完成的任务"></textarea>
      <div class="actions">
        <button id="submit" class="{ui_map["btnPrimary"]}" type="button">提交请求</button>
        <button id="refresh" class="{ui_map["btnQuiet"]}" type="button">刷新结果</button>
      </div>
      <p id="message" class="{ui_map["msg"]}" role="status"></p>
    </section>

    <section class="grid">
      <article class="{ui_map["card"]}">
        <h2 class="{ui_map["sectionTitle"]}">Requests</h2>
        <div id="requests" class="list"></div>
      </article>
      <article class="{ui_map["card"]}">
        <h2 class="{ui_map["sectionTitle"]}">Results</h2>
        <div id="results" class="list"></div>
      </article>
    </section>

    <footer class="{ui_map["footer"]}">
      提交后回到 Claude Code，告诉 Agent“处理 Plugin 待办请求”。这是稳定 request-queue fallback；后续可按 Design 接入已验证的主动 Channel。
    </footer>
  </main>
  <script src="/kit/components.js"></script>
  <script type="module" src="/app.js"></script>
</body>
</html>'''

        write(output / "ui" / "index.html", index_html, args.force)

        app_js = '''const params = new URLSearchParams(location.search);
const token = params.get("token");
const message = document.querySelector("#message");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const intent = document.querySelector("#intent");
const requests = document.querySelector("#requests");
const results = document.querySelector("#results");
const version = document.querySelector("#version");

function escapeHtml(value) {
  return String(value).replace(/[&<>\\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function api(path, options = {}) {
  if (!token) throw new Error("Missing plugin session token. Open the UI through the MCP render tool.");
  const response = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function renderItems(container, items, formatter) {
  container.innerHTML = items.length ? items.map(formatter).join("") : '<p class="__EMPTY__">暂无</p>';
}

async function load() {
  try {
    const state = await api("/api/state");
    version.textContent = `Project v${state.project.projectVersion}`;
    renderItems(requests, state.requests, (item) => `<div class="__ITEM__"><strong class="__ITEMID__">${escapeHtml(item.requestId)}</strong> <span class="__STATUS__">${escapeHtml(item.status)}</span><p>${escapeHtml(item.userIntent)}</p></div>`);
    renderItems(results, state.results, (item) => `<div class="__ITEM__"><strong class="__ITEMID__">${escapeHtml(item.requestId)}</strong> <span class="__STATUS__">v${item.projectVersion}</span><p>${escapeHtml(item.summary)}</p><pre>${escapeHtml(JSON.stringify(item.payload, null, 2))}</pre></div>`);
  } catch (error) {
    message.textContent = error.message;
    message.dataset.kind = "error";
  }
}

submit.addEventListener("click", async () => {
  const userIntent = intent.value.trim();
  if (!userIntent) return;
  submit.disabled = true;
  try {
    const request = await api("/api/requests", { method: "POST", body: JSON.stringify({ operation: "user-request", userIntent, selection: {}, assetRefs: [] }) });
    message.textContent = `已提交 ${request.requestId}。回到 Claude Code 让 Agent 处理待办请求。`;
    message.dataset.kind = "success";
    intent.value = "";
    await load();
  } catch (error) {
    message.textContent = error.message;
    message.dataset.kind = "error";
  } finally {
    submit.disabled = false;
  }
});

refresh.addEventListener("click", load);
setInterval(load, 2000);
load();
'''
        write(
            output / "ui" / "app.js",
            app_js.replace("__ITEMID__", ui_map["itemId"]).replace("__ITEM__", ui_map["item"]).replace("__STATUS__", ui_map["status"]).replace("__EMPTY__", ui_map["empty"]),
            args.force,
        )

        styles_css = '''.shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 24px 56px;
  display: grid;
  gap: 20px;
}
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.masthead h1 { margin: 6px 0; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
section, article { display: grid; gap: 12px; align-content: start; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.list { display: grid; gap: 10px; }
.list p { margin: 4px 0 0; }
.list pre { margin: 6px 0 0; overflow-x: auto; font-size: 12px; }
footer { font-size: 12px; }
'''
        write(output / "ui" / "styles.css", styles_css, args.force)

    if has_widget:
        widget_html = fill(WIDGET_HTML_TEMPLATE, {
            "__TITLE__": escaped_title,
            "__HOST_LABEL__": "Claude Code Plugin",
            "__BODY_CLASS__": ui_map["body"],
            "__EYEBROW__": ui_map["eyebrow"],
            "__TITLE_CLASS__": ui_map["title"],
            "__VERSION_CLASS__": ui_map["version"],
            "__CARD__": ui_map["card"],
            "__LABEL__": ui_map["label"],
            "__FIELD__": ui_map["field"],
            "__BTN_PRIMARY__": ui_map["btnPrimary"],
            "__BTN_QUIET__": ui_map["btnQuiet"],
            "__MSG__": ui_map["msg"],
            "__SECTION_TITLE__": ui_map["sectionTitle"],
        })
        write(output / "ui" / "widget.html", widget_html, args.force)

        widget_js = fill(WIDGET_JS_TEMPLATE, {
            "__TITLE_JSON__": json.dumps(title),
            "__VERSION_JSON__": json.dumps(plugin.get("version", "0.1.0")),
            "__GET_STATE_TOOL__": get_state_tool,
            "__CREATE_REQUEST_TOOL__": create_request_tool,
            "__ITEM__": ui_map["item"],
            "__ITEMID__": ui_map["itemId"],
            "__STATUS__": ui_map["status"],
            "__EMPTY__": ui_map["empty"],
        })
        write(output / "ui" / "widget.js", widget_js, args.force)
        write(output / "ui" / "preview-host.html", PREVIEW_HOST_HTML, args.force)
        write(output / "ui" / "preview-host.js", PREVIEW_HOST_JS, args.force)
        write(output / "scripts" / "vite.widget.config.mjs", VITE_WIDGET_CONFIG, args.force)
        write(output / "scripts" / "vite.preview.config.mjs", VITE_PREVIEW_CONFIG, args.force)
        write(output / "scripts" / "dev-preview.mjs", fill(DEV_PREVIEW_MJS, {"__RENDER_TOOL__": render_tool}), args.force)

    if has_widget:
        required_tools = [render_tool, create_request_tool, get_request_tool, apply_result_tool, get_state_tool]
        probe_mjs = fill(WIDGET_PROBE_MJS, {
            "__PLUGIN_ID__": plugin_id,
            "__REQUIRED_TOOLS_JSON__": json.dumps(required_tools),
            "__RENDER_TOOL__": render_tool,
            "__WIDGET_URI__": widget_uri,
            "__GET_STATE_TOOL__": get_state_tool,
        })
    else:
        probe_mjs = f'''import {{ fileURLToPath }} from "node:url";
import {{ Client }} from "@modelcontextprotocol/sdk/client/index.js";
import {{ StdioClientTransport }} from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../server/index.mjs", import.meta.url));
const transport = new StdioClientTransport({{ command: process.execPath, args: [serverPath] }});
const client = new Client({{ name: "{plugin_id}-probe", version: "0.1.0" }});
await client.connect(transport);
const tools = await client.listTools();
const names = tools.tools.map((tool) => tool.name);
for (const required of {json.dumps([render_tool, get_request_tool, apply_result_tool, get_state_tool])}) {{
  if (!names.includes(required)) throw new Error(`Missing tool: ${{required}}`);
}}
console.log(JSON.stringify({{ ok: true, tools: names }}, null, 2));
await client.close();
'''
    write(output / "scripts" / "probe-mcp.mjs", probe_mjs, args.force)

    storage_test = f'''import assert from "node:assert/strict";
import {{ mkdtemp, rm }} from "node:fs/promises";
import {{ tmpdir }} from "node:os";
import {{ join }} from "node:path";
import test from "node:test";

import {{ applyResult, claimNextRequest, createRequest, getState }} from "../server/storage.mjs";

test("request and result round-trip is versioned and persisted", async () => {{
  const root = await mkdtemp(join(tmpdir(), "{plugin_id}-"));
  try {{
    const request = await createRequest(root, {{ userIntent: "test request" }});
    const claimed = await claimNextRequest(root);
    assert.equal(claimed.requestId, request.requestId);
    const result = await applyResult(root, {{ requestId: request.requestId, basedOnProjectVersion: 0, summary: "done", payload: {{ ok: true }} }});
    assert.equal(result.projectVersion, 1);
    const repeated = await applyResult(root, {{ requestId: request.requestId, basedOnProjectVersion: 0, summary: "done", payload: {{ ok: true }} }});
    assert.deepEqual(repeated, result);
    const state = await getState(root);
    assert.equal(state.results.length, 1);
    assert.equal(state.requests[0].status, "succeeded");
  }} finally {{
    await rm(root, {{ recursive: true, force: true }});
  }}
}});

test("queued request completes after an earlier apply bumps the version", async () => {{
  const root = await mkdtemp(join(tmpdir(), "{plugin_id}-q-"));
  try {{
    const first = await createRequest(root, {{ userIntent: "first request" }});
    const second = await createRequest(root, {{ userIntent: "second request" }});
    const claimedFirst = await claimNextRequest(root);
    await applyResult(root, {{ requestId: claimedFirst.requestId, basedOnProjectVersion: claimedFirst.projectVersion, summary: "done", payload: {{ ok: true }} }});
    const claimedSecond = await claimNextRequest(root);
    assert.deepEqual([claimedFirst.requestId, claimedSecond.requestId].sort(), [first.requestId, second.requestId].sort());
    assert.equal(claimedSecond.projectVersion, 1);
    const result = await applyResult(root, {{ requestId: claimedSecond.requestId, basedOnProjectVersion: claimedSecond.projectVersion, summary: "done", payload: {{ ok: true }} }});
    assert.equal(result.projectVersion, 2);
    const state = await getState(root);
    assert.equal(state.requests.filter((item) => item.status === "succeeded").length, 2);
  }} finally {{
    await rm(root, {{ recursive: true, force: true }});
  }}
}});
'''
    write(output / "tests" / "storage.test.mjs", storage_test, args.force)

    if form == "mcp-app":
        proves = '''- Claude Code Plugin package structure
- stdio MCP Server with a `ui://` widget resource (MCP Apps, `_meta.ui.resourceUri`)
- kit-styled single-file widget (official `@modelcontextprotocol/ext-apps` App class)
- project-local request queue driven through MCP tools (tool-only works everywhere)
- Agent domain result Tool with projectVersion and stale-result protection
- local dev preview host (official AppBridge) for the widget round-trip'''
        develop_section = f'''## Build the widget bundles

```bash
npm install
npm run build:ui
npm run quality
```

## Preview the widget locally

Renders the widget in a local AppBridge host page and proxies tool calls to the real stdio server:

```bash
npm run preview -- /absolute/path/to/a/project
```

Open the printed URL, submit a request from the widget, then ask the Agent to process pending requests.

Hosts that support MCP Apps embed this widget in the conversation when `{render_tool}` runs; Claude Code and other tool-only hosts use the same tools conversationally.'''
    elif form == "hybrid":
        proves = '''- Claude Code Plugin package structure
- stdio MCP Server serving both surfaces: local Browser UI and a `ui://` widget resource
- kit-styled full editor page plus a light conversation widget over the same project state
- project-local request queue, Agent domain result Tool, projectVersion protection
- local dev preview host (official AppBridge) for the widget round-trip'''
        develop_section = f'''## Build the widget bundles

```bash
npm install
npm run build:ui
npm run quality
```

## Develop in Claude Code

Development-mode loading only. It does not count as a real install.

```bash
claude --plugin-dir .
```

Then invoke `/{plugin_id}:{skill_name}` or ask Claude to open {title}. The full editor opens from the returned URL; hosts that support MCP Apps also embed the light widget (`npm run preview` renders it locally).'''
    else:
        proves = '''- Claude Code Plugin package structure
- stdio MCP Server
- local Browser UI
- project-local request queue
- Agent domain result Tool
- projectVersion and stale-result protection
- reopen persistence'''
        develop_section = f'''## Install dependencies

```bash
npm install
npm run quality
```

## Develop in Claude Code

Development-mode loading only. It does not count as a real install.

```bash
claude --plugin-dir .
```

Then invoke `/{plugin_id}:{skill_name}` or ask Claude to open {title}.'''

    readme = f'''# {title}

Scaffold generated by Interactive Plugin Builder (form: {form}).

## What this baseline proves

{proves}

It does **not** prove the final Plugin Spec. Continue with PLUGIN-DEV-PLAN.md.

{develop_section}

## Install for real use (personal marketplace)

Fastest path, does every step below in one command:

```bash
sh install.sh
```

Manual path:

1. Put this plugin in a marketplace directory, for example `~/claude-plugins/plugins/{plugin_id}`,
   then install its runtime dependencies inside that copy (the install snapshot
   must already contain `node_modules/` for the MCP server to start):

```bash
cd ~/claude-plugins/plugins/{plugin_id}
npm install
```

2. Create `~/claude-plugins/.claude-plugin/marketplace.json` listing this plugin:

```json
{{
  "name": "personal",
  "owner": {{ "name": "you" }},
  "plugins": [
    {{ "name": "{plugin_id}", "source": "./plugins/{plugin_id}" }}
  ]
}}
```

3. Register the marketplace and install the plugin:

```bash
claude plugin validate ~/claude-plugins
claude plugin marketplace add ~/claude-plugins
claude plugin install {plugin_id}@personal
```

4. Run `/reload-plugins` in the current session, or start a new session.
   The install copies this plugin into `~/.claude/plugins/cache`, so it must not
   reference files outside the plugin directory.

## One-click install

Paste this to Claude Code and let it run the steps above:

```text
请把 {plugin_id} 安装到我的 personal marketplace：
1. 把本插件文件夹复制到 ~/claude-plugins/plugins/{plugin_id}，并在该目录运行 npm install{'（含 npm run build:ui）' if has_widget else ''}
2. 在 ~/claude-plugins/.claude-plugin/marketplace.json 登记 {plugin_id}
3. 运行 claude plugin marketplace add ~/claude-plugins
4. 运行 claude plugin install {plugin_id}@personal
5. 提醒我 /reload-plugins 或开新会话，并确认 /{plugin_id}:{skill_name} 可用
```

## Share

Push this folder to GitHub or send it as-is (`node_modules/` is intentionally
excluded by `.gitignore`). Whoever receives it installs the same way: copy into
their marketplace directory, run `npm install` inside that copy, then register
and install.
'''
    write(output / "README.md", readme, args.force)
    write(output / "install.sh", INSTALL_SH.replace("__PLUGIN_ID__", plugin_id), args.force)
    write(output / ".gitignore", "node_modules/\ndist/\n.DS_Store\n", args.force)

    print(f"Scaffolded Claude Code plugin baseline ({form}): {output}")
    print("Next:")
    print(f"  cd {output}")
    print("  npm install")
    if has_widget:
        print("  npm run build:ui")
    print("  npm run quality")
    print("  claude --plugin-dir .")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
