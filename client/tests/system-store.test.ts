import assert from "node:assert/strict";
import test from "node:test";
import { assertCodexLogoutSucceeded } from "../src/stores/systemStore";

test("Codex logout accepts only an explicit success response", () => {
  assert.doesNotThrow(() => assertCodexLogoutSucceeded({ success: true }));
});

test("Codex logout rejects an HTTP 200 failure response", () => {
  assert.throws(
    () => assertCodexLogoutSucceeded({ success: false }),
    /Codex CLI 未能退出登录/
  );
});

test("Codex logout surfaces a backend failure reason", () => {
  assert.throws(
    () => assertCodexLogoutSucceeded({ success: false, error: "process timed out" }),
    /process timed out/
  );
});
