import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

function usageExit(message) {
  console.error(message);
  console.error("用法：node audit-ui.mjs <url|ui目录> [--themes light,dark] [--widths 1280,900] [--out evidence/check/ui-audit] [--strict]");
  process.exit(2);
}

async function resolveModule(pkg) {
  try {
    return await import(pkg);
  } catch {}
  const require = createRequire(join(process.cwd(), "noop.js"));
  const entry = require.resolve(pkg);
  const mod = await import(pathToFileURL(entry).href);
  return mod.chromium ? mod : mod.default ?? mod;
}

async function loadBrowser() {
  for (const pkg of ["playwright-core", "playwright"]) {
    try {
      const mod = await resolveModule(pkg);
      try {
        return { browser: await mod.chromium.launch({ headless: true }), engine: pkg + ":chromium" };
      } catch {
        return { browser: await mod.chromium.launch({ headless: true, channel: "chrome" }), engine: pkg + ":chrome" };
      }
    } catch {}
  }
  return null;
}

async function serveDir(dir) {
  const server = createServer(async (req, res) => {
    const path = join(dir, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

const PAGE_AUDIT = () => {
  const issues = { overflows: [], wrapped: [], contrastFails: [] };
  const doc = document.documentElement;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > doc.clientWidth + 2) {
      let clipped = false;
      let a = el.parentElement;
      while (a && a !== document.body) {
        const cs = getComputedStyle(a);
        if (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowX === "auto" || cs.overflowX === "scroll") { clipped = true; break; }
        a = a.parentElement;
      }
      if (!clipped && issues.overflows.length < 12) {
        issues.overflows.push({ cls: String(el.className).slice(0, 50), over: Math.round(r.right - doc.clientWidth) });
      }
    }
  }
  for (const el of document.querySelectorAll('button, [class*="btn"], [class*="tab"], [class*="seg"] > *, [class*="chip"], [class*="pill"]')) {
    const text = (el.textContent || "").trim();
    if (el.offsetHeight > 44 && text.length > 0 && text.length <= 8 && issues.wrapped.length < 8) {
      issues.wrapped.push({ cls: String(el.className).slice(0, 50), h: el.offsetHeight, text: text.slice(0, 10) });
    }
  }
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  let sampled = 0;
  for (const el of document.querySelectorAll("p, span, li, td, th, label, h1, h2, h3, button, a, div")) {
    if (sampled >= 200 || issues.contrastFails.length >= 10) break;
    if (!el.childNodes.length || el.children.length) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 2) continue;
    sampled += 1;
    const cs = getComputedStyle(el);
    const fg = lum(cs.color);
    const bg = lum(bgOf(el));
    if (fg === null || bg === null) continue;
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 600;
    const threshold = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < threshold) {
      issues.contrastFails.push({ cls: String(el.className).slice(0, 40), text: text.slice(0, 14), ratio: Math.round(ratio * 100) / 100 });
    }
  }
  const classed = document.querySelectorAll("body [class]");
  let kitCount = 0;
  for (const el of classed) {
    if (/(^|\s)(pk|ink)-/.test(String(el.className))) kitCount += 1;
  }
  return {
    ...issues,
    elementCount: document.querySelectorAll("body *").length,
    textLength: (document.body.innerText || "").length,
    kitRatio: classed.length ? Math.round((kitCount / classed.length) * 100) / 100 : 0,
  };
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      themes: { type: "string", default: "light,dark" },
      widths: { type: "string", default: "1280,900" },
      out: { type: "string", default: "evidence/check/ui-audit" },
      strict: { type: "boolean", default: false },
    },
  });
  const target = positionals[0];
  if (!target) usageExit("缺少目标：URL 或 ui 目录");
  const themes = values.themes.split(",").map((s) => s.trim()).filter(Boolean);
  const widths = values.widths.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const outDir = resolve(values.out);
  await mkdir(outDir, { recursive: true });

  let staticServer = null;
  let url = target;
  if (!/^https?:/.test(target)) {
    const dir = resolve(target);
    const info = await stat(dir).catch(() => null);
    if (!info || !info.isDirectory()) usageExit(`目标既不是 URL 也不是目录：${target}`);
    staticServer = await serveDir(dir);
    url = staticServer.url;
  }

  const engine = await loadBrowser();
  if (!engine) {
    console.error("未找到可用浏览器引擎：安装 playwright-core 并具备本机 Chrome，或一次性安装 playwright；本次 UI 审计缺席，请在报告注明。");
    if (staticServer) staticServer.server.close();
    process.exit(3);
  }

  const combos = [];
  const shots = [];
  const page = await engine.browser.newPage();
  for (const width of widths) {
    for (const theme of themes) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(400);
      const audit = await page.evaluate(PAGE_AUDIT);
      const shot = join(outDir, `${theme}-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      shots.push(shot);
      const blank = audit.elementCount < 5 || audit.textLength < 10;
      combos.push({ theme, width, blank, ...audit });
      const flags = [];
      if (blank) flags.push("空白渲染");
      if (audit.overflows.length) flags.push(`溢出×${audit.overflows.length}`);
      if (audit.wrapped.length) flags.push(`折行×${audit.wrapped.length}`);
      if (audit.contrastFails.length) flags.push(`对比度×${audit.contrastFails.length}`);
      console.log(`[${theme} ${width}px] ${flags.length ? flags.join(" · ") : "干净"} · kit 占比 ${Math.round(audit.kitRatio * 100)}%`);
    }
  }
  await engine.browser.close();
  if (staticServer) staticServer.server.close();

  const pass = combos.every((c) => !c.blank && !c.overflows.length && !c.wrapped.length);
  const report = { target, engine: engine.engine, themes, widths, combos, screenshots: shots, pass };
  const reportPath = join(outDir, "ui-audit.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`报告：${reportPath}（截图 ${shots.length} 张）`);
  if (values.strict && !pass) {
    console.error("UI 审计未通过：存在空白渲染 / 溢出 / 折行。");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(2);
});
