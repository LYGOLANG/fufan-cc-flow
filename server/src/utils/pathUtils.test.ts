import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { getClaudeHome } from "./pathUtils.js";

test("uses CLAUDE_CONFIG_DIR as the Claude settings and legacy credential home", () => {
  const previous = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = "~/.claude-work";
    assert.equal(getClaudeHome(), path.join(os.homedir(), ".claude-work"));
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});
