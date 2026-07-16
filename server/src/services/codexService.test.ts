import assert from "node:assert/strict";
import test from "node:test";
import { classifyCodexAuthProbe, parseCodexLoginStatus } from "./codexAuthProbe.js";

test("maps Codex ChatGPT terminal login", () => {
  assert.equal(parseCodexLoginStatus("Logged in using ChatGPT"), "chatgpt");
});

test("maps Codex API-key login", () => {
  assert.equal(parseCodexLoginStatus("Logged in using an API key"), "apikey");
});

test("maps explicit logout and rejects unknown output", () => {
  assert.equal(parseCodexLoginStatus("Not logged in"), "none");
  assert.equal(parseCodexLoginStatus("unexpected status"), null);
  assert.equal(parseCodexLoginStatus("Error: failed to query ChatGPT authentication status"), null);
  assert.equal(parseCodexLoginStatus(""), null);
});

test("does not turn command failures into login or stale-file fallbacks", () => {
  assert.deepEqual(classifyCodexAuthProbe("Logged in using ChatGPT", 1), { kind: "failed" });
  assert.deepEqual(classifyCodexAuthProbe("Error: failed to query ChatGPT authentication status", 1), { kind: "failed" });
  assert.deepEqual(classifyCodexAuthProbe("unknown command 'status'", 1), { kind: "unsupported" });
  assert.deepEqual(classifyCodexAuthProbe("Not logged in", 1), { kind: "status", method: "none" });
});
