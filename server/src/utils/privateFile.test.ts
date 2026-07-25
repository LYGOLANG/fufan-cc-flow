import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { writePrivateFile } from "./privateFile.js";

const execFileAsync = promisify(execFile);
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

// Windows 上 mode/chmod 是 no-op,真正的控制是 ACL。这条测试专测那条路径——
// 此前唯一的测试在 win32 直接 skip,等于本项目主平台零覆盖。
test("tightens ACL on Windows so other users cannot read", { skip: process.platform !== "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-flow-private-acl-"));
  const filePath = path.join(root, "config", "secrets.json");
  try {
    await writePrivateFile(filePath, "sk-secret-value");
    assert.equal(await fs.readFile(filePath, "utf-8"), "sk-secret-value");

    const { stdout } = await execFileAsync("icacls", [filePath], { windowsHide: true });
    // 继承已移除:不应再出现继承标记 (I)
    assert.ok(!/\(I\)/.test(stdout), `ACL still inherited:\n${stdout}`);
    // 当前用户仍可完全控制(否则应用自己都读不了)
    const user = process.env.USERNAME ?? "";
    assert.ok(user.length > 0, "USERNAME must be set on Windows");
    assert.ok(
      stdout.includes(user),
      `current user ${user} missing from ACL:\n${stdout}`
    );
    // 宽泛主体不应再有授权(这正是修复要杜绝的:明文 API Key 被同机他人读到)
    assert.ok(
      !/\b(Everyone|BUILTIN\\Users|Authenticated Users)\b/i.test(stdout),
      `broad principal still granted:\n${stdout}`
    );

    // 幂等:重复写入不破坏已收紧的 ACL
    await writePrivateFile(filePath, "sk-second");
    const { stdout: second } = await execFileAsync("icacls", [filePath], { windowsHide: true });
    assert.ok(!/\(I\)/.test(second), `ACL re-inherited after rewrite:\n${second}`);
    assert.equal(await fs.readFile(filePath, "utf-8"), "sk-second");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
