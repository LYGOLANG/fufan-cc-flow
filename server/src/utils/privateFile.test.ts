import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writePrivateFile } from "./privateFile.js";

const permissionBits = (mode: number) => mode & 0o777;

test("creates and re-tightens private config permissions", { skip: process.platform === "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-private-file-"));
  const directory = path.join(root, "config");
  const filePath = path.join(directory, "secrets.json");
  try {
    await writePrivateFile(filePath, "first");
    assert.equal(permissionBits((await fs.stat(directory)).mode), 0o700);
    assert.equal(permissionBits((await fs.stat(filePath)).mode), 0o600);

    await fs.chmod(directory, 0o755);
    await fs.chmod(filePath, 0o644);
    await writePrivateFile(filePath, "second");
    assert.equal(permissionBits((await fs.stat(directory)).mode), 0o700);
    assert.equal(permissionBits((await fs.stat(filePath)).mode), 0o600);
    assert.equal(await fs.readFile(filePath, "utf-8"), "second");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
