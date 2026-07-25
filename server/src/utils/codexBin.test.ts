import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { resolveCodexBin, selectPathCandidate } from "./codexBin.js";

test("Windows resolver preserves PATH directory priority for spawnable candidates", () => {
  const selected = selectPathCandidate(
    [
      "C:\\Users\\me\\AppData\\Roaming\\npm\\codex",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe",
    ],
    true,
  );

  assert.equal(selected, "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
});

test("Windows resolver accepts the first executable candidate", () => {
  assert.equal(
    selectPathCandidate(
      ["C:\\tools\\codex.exe", "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd"],
      true,
    ),
    "C:\\tools\\codex.exe",
  );
});

test("Windows resolver keeps a PATH-prioritized .com executable", () => {
  assert.equal(
    selectPathCandidate(["C:\\current\\codex.com", "C:\\stale\\codex.exe"], true),
    "C:\\current\\codex.com",
  );
});

test("Windows resolver rejects an unspawnable extensionless-only shim", () => {
  assert.equal(selectPathCandidate(["C:\\broken\\codex"], true), undefined);
});

test("POSIX resolver uses the first PATH result", () => {
  assert.equal(selectPathCandidate(["/opt/bin/codex", "/usr/bin/codex"], false), "/opt/bin/codex");
});

test("production resolver honors override, PATH, then known-directory order", () => {
  const override = "C:\\override\\codex.exe";
  const onPath = "C:\\path\\codex.cmd";
  const knownDirectory = process.platform === "win32" ? "C:\\known" : "/known";
  const known = join(knownDirectory, process.platform === "win32" ? "codex.exe" : "codex");
  const existing = new Set([override, known]);

  assert.equal(
    resolveCodexBin({
      env: { CODEX_BIN: override },
      exists: (candidate) => existing.has(candidate),
      pathResolver: () => onPath,
      directories: [knownDirectory],
    }),
    override,
  );

  assert.equal(
    resolveCodexBin({
      env: {},
      exists: (candidate) => existing.has(candidate),
      pathResolver: () => onPath,
      directories: [knownDirectory],
    }),
    onPath,
  );

  assert.equal(
    resolveCodexBin({
      env: {},
      exists: (candidate) => existing.has(candidate),
      pathResolver: () => undefined,
      directories: [knownDirectory],
    }),
    known,
  );
});
